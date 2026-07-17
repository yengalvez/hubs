import { v4 as uuid } from "uuid";

export const WAYPOINT_RESERVATION_PROTOCOL = 2;
export const WAYPOINT_RESERVATION_EVENT = "waypoint_reservation:request";
export const WAYPOINT_RESERVATION_STATE_EVENT = "waypoint_reservation:state";

const DEFAULT_LEASE_MS = 15000;
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const MAX_REQUEST_ATTEMPTS = 2;

function expiresAtMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return Number.NaN;
  return Date.parse(value);
}

function boundedLeaseExpiry(value, now, leaseMs) {
  const absoluteExpiry = expiresAtMillis(value);
  if (!Number.isFinite(absoluteExpiry)) return Number.NaN;
  const maximumLocalExpiry = now + leaseMs;
  return absoluteExpiry <= now || absoluteExpiry > maximumLocalExpiry ? maximumLocalExpiry : absoluteExpiry;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isObjectRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStateVersion(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export class WaypointReservationTimeoutError extends Error {
  constructor() {
    super("Waypoint reservation request timed out.");
    this.name = "WaypointReservationTimeoutError";
  }
}

export class WaypointReservationCoordinator {
  constructor({
    uuidFn = uuid,
    now = () => Date.now(),
    setTimeoutFn = (callback, delay) => setTimeout(callback, delay),
    clearTimeoutFn = handle => clearTimeout(handle),
    onStateChange = () => {},
    onReservationLost = () => {}
  } = {}) {
    this.uuid = uuidFn;
    this.now = now;
    this.setTimeout = setTimeoutFn;
    this.clearTimeout = clearTimeoutFn;
    this.onStateChange = onStateChange;
    this.onReservationLost = onReservationLost;

    this.channel = null;
    this.stateBindingRef = null;
    this.supported = false;
    this.leaseMs = DEFAULT_LEASE_MS;
    this.requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
    this.requestSeq = 0;
    this.active = new Map();
    this.snapshotStateVersion = 0;
    this.lastStateVersionByWaypoint = new Map();
    this.current = null;
    this.currentClaimId = null;
    this.abandoningReservationId = null;
    this.pendingOrphan = null;
    this.releasingReservationId = null;
    this.switchingReservationId = null;
    this.switchingPreviousReleased = false;
    this.renewTimer = null;
    this.epoch = 0;
    this.pendingRequests = new Set();
    this.operationChain = Promise.resolve();
    this.handleState = this.handleState.bind(this);
  }

  setChannel(channel) {
    this.cancelPendingRequests();
    if (this.channel && this.stateBindingRef !== null) {
      this.channel.off(WAYPOINT_RESERVATION_STATE_EVENT, this.stateBindingRef);
    }

    // Phoenix copies bindings during socket/hub migration. Remove the copied
    // binding before installing the one owned by this coordinator.
    if (channel && this.stateBindingRef !== null) {
      channel.off(WAYPOINT_RESERVATION_STATE_EVENT, this.stateBindingRef);
    }

    this.channel = channel;
    this.stateBindingRef = channel ? channel.on(WAYPOINT_RESERVATION_STATE_EVENT, this.handleState) : null;
    this.epoch += 1;
    // Record abandonment at the public release boundary, not only when its
    // queued request starts. A channel migration can otherwise cancel the
    // caller and keep renewing the server lease without a seated consumer.
    if (
      this.current &&
      (this.abandoningReservationId === this.current.reservationId ||
        this.releasingReservationId === this.current.reservationId ||
        this.switchingReservationId === this.current.reservationId)
    ) {
      this.pendingOrphan = { ...this.current };
      this.clearCurrent(false);
      this.releasingReservationId = null;
      this.switchingReservationId = null;
      this.switchingPreviousReleased = false;
    }
    if (this.pendingOrphan) this.scheduleOrphanRelease();
    else this.scheduleRenew();
  }

  configure(capability) {
    const previousCurrent = this.current && { ...this.current };
    const previousClaimId = this.currentClaimId;
    const previousWasAbandoned = previousCurrent && this.abandoningReservationId === previousCurrent.reservationId;
    this.cancelPendingRequests();
    this.epoch += 1;
    this.pendingOrphan = null;
    this.releasingReservationId = null;
    this.switchingReservationId = null;
    this.switchingPreviousReleased = false;
    this.supported = !!(
      isObjectRecord(capability) &&
      capability.protocol === WAYPOINT_RESERVATION_PROTOCOL &&
      capability.supported === true &&
      Number.isInteger(capability.lease_ms) &&
      capability.lease_ms > 0 &&
      Number.isInteger(capability.request_timeout_ms) &&
      capability.request_timeout_ms > 0 &&
      Number.isSafeInteger(capability.request_seq) &&
      capability.request_seq >= 0 &&
      isStateVersion(capability.snapshot_state_version) &&
      Array.isArray(capability.active) &&
      (capability.current === null || isObjectRecord(capability.current))
    );
    this.leaseMs = this.supported ? capability.lease_ms : DEFAULT_LEASE_MS;
    this.requestTimeoutMs = this.supported ? capability.request_timeout_ms : DEFAULT_REQUEST_TIMEOUT_MS;
    this.requestSeq = this.supported ? capability.request_seq : this.requestSeq;
    this.snapshotStateVersion = this.supported ? capability.snapshot_state_version : 0;

    this.active.clear();
    this.lastStateVersionByWaypoint.clear();
    const active = this.supported ? capability.active : [];
    const activeWaypointIds = new Set();
    for (const reservation of active) {
      const expiry = boundedLeaseExpiry(reservation && reservation.expires_at, this.now(), this.leaseMs);
      if (
        !isNonEmptyString(reservation && reservation.waypoint_id) ||
        !isStateVersion(reservation && reservation.state_version) ||
        reservation.state_version > this.snapshotStateVersion ||
        !(expiry > this.now()) ||
        activeWaypointIds.has(reservation.waypoint_id)
      ) {
        this.supported = false;
        break;
      }
      if (this.supported) {
        activeWaypointIds.add(reservation.waypoint_id);
        this.active.set(reservation.waypoint_id, expiry);
        this.lastStateVersionByWaypoint.set(reservation.waypoint_id, reservation.state_version);
      }
    }

    const current = capability && capability.current;
    const currentExpiry = boundedLeaseExpiry(current && current.expires_at, this.now(), this.leaseMs);
    if (
      this.supported &&
      isNonEmptyString(current && current.waypoint_id) &&
      isNonEmptyString(current && current.operation_id) &&
      isNonEmptyString(current && current.reservation_id) &&
      isStateVersion(current && current.state_version) &&
      current.state_version <= this.snapshotStateVersion &&
      this.lastStateVersionByWaypoint.get(current.waypoint_id) === current.state_version &&
      currentExpiry > this.now()
    ) {
      const snapshotCurrent = {
        waypointId: current.waypoint_id,
        operationId: current.operation_id,
        reservationId: current.reservation_id,
        stateVersion: current.state_version,
        expiresAt: currentExpiry
      };
      const canAdoptSnapshot = !!(
        previousCurrent &&
        previousClaimId &&
        !previousWasAbandoned &&
        previousCurrent.waypointId === snapshotCurrent.waypointId &&
        previousCurrent.reservationId === snapshotCurrent.reservationId
      );
      if (canAdoptSnapshot) {
        this.current = snapshotCurrent;
        this.currentClaimId = previousClaimId;
        this.abandoningReservationId = null;
        this.active.set(this.current.waypointId, currentExpiry);
        this.scheduleRenew();
      } else {
        // A private lease returned by the server is not proof that this page
        // still has a seated consumer. Unknown, changed and intentionally
        // abandoned leases are released conditionally and never renewed.
        this.clearCurrent(false);
        this.abandoningReservationId = null;
        this.pendingOrphan = snapshotCurrent;
      }
    } else {
      if (current !== null && current !== undefined) this.supported = false;
      this.clearCurrent(false);
      this.abandoningReservationId = null;
    }

    if (!this.supported) {
      this.active.clear();
      this.snapshotStateVersion = 0;
      this.lastStateVersionByWaypoint.clear();
      this.clearCurrent(false);
      this.abandoningReservationId = null;
      this.pendingOrphan = null;
    }

    this.onStateChange({ type: "snapshot", active: this.activeWaypointIds() });
    if (this.pendingOrphan) this.scheduleOrphanRelease();
  }

  activeWaypointIds() {
    this.pruneExpired();
    return Array.from(this.active.keys());
  }

  isReserved(waypointId) {
    if (!isNonEmptyString(waypointId)) return false;
    this.pruneExpired();
    return this.active.has(waypointId);
  }

  get currentWaypointId() {
    this.pruneExpired();
    return this.current && this.current.waypointId;
  }

  getDiagnosticState() {
    this.pruneExpired();
    const activeWaypointIds = Object.freeze(this.activeWaypointIds().sort());
    const current = this.current
      ? Object.freeze({
          waypointId: this.current.waypointId,
          reservationId: this.current.reservationId
        })
      : null;

    return Object.freeze({
      protocol: WAYPOINT_RESERVATION_PROTOCOL,
      supported: this.supported,
      activeWaypointIds,
      current
    });
  }

  reserve(waypointId) {
    return this.reserveWithHandle(waypointId).then(Boolean);
  }

  reserveWithHandle(waypointId) {
    if (!this.supported || !this.channel || !isNonEmptyString(waypointId)) return Promise.resolve(null);
    const epoch = this.epoch;
    const claimId = this.uuid();
    return this.enqueue(() => this.performReserve(waypointId, epoch, claimId));
  }

  release(expectedReservation = null) {
    // This intent must be synchronous: the operation may still be queued when
    // a replacement channel snapshot arrives.
    if (
      this.current &&
      (!expectedReservation ||
        (this.current.reservationId === expectedReservation.reservationId &&
          this.currentClaimId === expectedReservation.claimId))
    ) {
      this.abandoningReservationId = this.current.reservationId;
    }
    const epoch = this.epoch;
    return this.enqueue(() => this.performRelease(epoch, expectedReservation));
  }

  handleState(payload) {
    if (
      !this.supported ||
      !isObjectRecord(payload) ||
      payload.protocol !== WAYPOINT_RESERVATION_PROTOCOL ||
      !isNonEmptyString(payload.waypoint_id) ||
      typeof payload.occupied !== "boolean" ||
      !isStateVersion(payload.state_version)
    ) {
      return;
    }

    const lastStateVersion = Math.max(
      this.snapshotStateVersion,
      this.lastStateVersionByWaypoint.get(payload.waypoint_id) || 0
    );
    if (payload.state_version <= lastStateVersion) return;

    const expiry = boundedLeaseExpiry(payload.expires_at, this.now(), this.leaseMs);
    const occupied = payload.occupied === true && expiry > this.now();
    if ((payload.occupied === true && !occupied) || (payload.occupied === false && payload.expires_at !== null)) return;

    this.lastStateVersionByWaypoint.set(payload.waypoint_id, payload.state_version);
    if (
      this.pendingOrphan &&
      this.pendingOrphan.waypointId === payload.waypoint_id &&
      payload.state_version > this.pendingOrphan.stateVersion &&
      payload.occupied === false
    ) {
      if (this.abandoningReservationId === this.pendingOrphan.reservationId) {
        this.abandoningReservationId = null;
      }
      this.pendingOrphan = null;
    }
    if (occupied) {
      this.active.set(payload.waypoint_id, expiry);
    } else {
      this.active.delete(payload.waypoint_id);
      if (this.current && this.current.waypointId === payload.waypoint_id) {
        if (this.current.reservationId === this.releasingReservationId) {
          if (this.abandoningReservationId === this.current.reservationId) {
            this.abandoningReservationId = null;
          }
          this.clearCurrent(false);
        } else if (this.current.reservationId === this.abandoningReservationId) {
          // The user already requested Stand. A correlated server release that
          // arrives before the queued request begins is expected completion,
          // not an involuntary reservation loss.
          this.abandoningReservationId = null;
          this.clearCurrent(false);
        } else if (this.current.reservationId === this.switchingReservationId) {
          // An atomic switch broadcasts the old seat's release before the
          // correlated reserve reply. Keep the old local marker until that
          // reply settles so movement ticks cannot queue a release of the new
          // seat behind the in-flight switch.
          this.switchingPreviousReleased = true;
        } else {
          this.loseCurrent("reservation_released");
        }
      }
    }

    this.onStateChange({
      type: "state",
      waypointId: payload.waypoint_id,
      occupied,
      expiresAt: occupied ? expiry : null
    });
  }

  enqueue(operation) {
    const result = this.operationChain.then(operation, operation);
    this.operationChain = result.catch(() => {});
    return result;
  }

  async performReserve(waypointId, epoch, claimId) {
    if (!this.isCurrentEpoch(epoch)) return null;
    this.pruneExpired();
    if (this.current && this.current.waypointId === waypointId) {
      this.currentClaimId = claimId;
      return {
        waypointId: this.current.waypointId,
        reservationId: this.current.reservationId,
        claimId
      };
    }
    const channel = this.channel;
    const requestTimeoutMs = this.requestTimeoutMs;

    const payload = {
      protocol: WAYPOINT_RESERVATION_PROTOCOL,
      action: "reserve",
      waypoint_id: waypointId,
      operation_id: this.uuid(),
      reservation_id: this.uuid(),
      request_seq: ++this.requestSeq
    };
    this.switchingReservationId = this.current && this.current.reservationId;
    this.switchingPreviousReleased = false;

    let response;
    try {
      response = await this.request(payload, epoch, channel, requestTimeoutMs);
    } catch {
      if (this.isCurrentEpoch(epoch, channel)) {
        this.releaseUnconfirmedReservation(payload, epoch, channel, requestTimeoutMs);
        this.finishFailedSwitch();
      }
      return null;
    }

    if (!this.isCurrentEpoch(epoch, channel)) return null;
    if (!response.ok || !this.validCorrelatedResponse(payload, response.payload)) {
      if (response.ok) this.releaseUnconfirmedReservation(payload, epoch, channel, requestTimeoutMs);
      this.finishFailedSwitch();
      return null;
    }
    const expiry = boundedLeaseExpiry(response.payload.expires_at, this.now(), this.leaseMs);
    const responseStateVersion = response.payload.state_version;
    const lastStateVersion = this.lastStateVersionByWaypoint.get(waypointId) || 0;
    if (
      expiry <= this.now() ||
      responseStateVersion <= this.snapshotStateVersion ||
      responseStateVersion < lastStateVersion
    ) {
      this.releaseUnconfirmedReservation(payload, epoch, channel, requestTimeoutMs);
      this.finishFailedSwitch();
      return null;
    }

    const previousWaypointId = this.current && this.current.waypointId;
    this.switchingReservationId = null;
    this.switchingPreviousReleased = false;
    this.current = {
      waypointId,
      operationId: payload.operation_id,
      reservationId: payload.reservation_id,
      stateVersion: responseStateVersion,
      expiresAt: expiry
    };
    this.currentClaimId = claimId;
    this.lastStateVersionByWaypoint.set(waypointId, responseStateVersion);
    this.active.set(waypointId, expiry);
    if (previousWaypointId && previousWaypointId !== waypointId) this.active.delete(previousWaypointId);
    this.scheduleRenew();
    this.onStateChange({ type: "current", waypointId, occupied: true, expiresAt: expiry });
    return { waypointId, reservationId: payload.reservation_id, claimId };
  }

  finishFailedSwitch() {
    const previousReservationId = this.switchingReservationId;
    const previousWasReleased = this.switchingPreviousReleased;
    this.switchingReservationId = null;
    this.switchingPreviousReleased = false;
    if (previousWasReleased && this.current && this.current.reservationId === previousReservationId) {
      this.loseCurrent("reservation_released");
    }
  }

  releaseUnconfirmedReservation(reservationPayload, epoch, channel, requestTimeoutMs) {
    if (!this.isCurrentEpoch(epoch, channel)) return;
    const releasePayload = {
      ...reservationPayload,
      action: "release",
      operation_id: this.uuid(),
      request_seq: ++this.requestSeq
    };
    this.pushOnce(releasePayload, channel, requestTimeoutMs).catch(() => {});
  }

  async performRelease(epoch, expectedReservation) {
    if (!this.isCurrentEpoch(epoch)) return false;
    this.pruneExpired();
    if (!this.current) {
      if (expectedReservation && this.abandoningReservationId === expectedReservation.reservationId) {
        this.abandoningReservationId = null;
      }
      return true;
    }
    if (
      expectedReservation &&
      (this.current.reservationId !== expectedReservation.reservationId ||
        this.currentClaimId !== expectedReservation.claimId)
    ) {
      if (this.abandoningReservationId === expectedReservation.reservationId) {
        this.abandoningReservationId = null;
      }
      return false;
    }

    const current = { ...this.current };
    const channel = this.channel;
    const requestTimeoutMs = this.requestTimeoutMs;
    this.releasingReservationId = current.reservationId;
    const payload = {
      protocol: WAYPOINT_RESERVATION_PROTOCOL,
      action: "release",
      waypoint_id: current.waypointId,
      operation_id: this.uuid(),
      reservation_id: current.reservationId,
      request_seq: ++this.requestSeq
    };

    let released = false;
    try {
      const response = await this.request(payload, epoch, channel, requestTimeoutMs);
      const lastStateVersion = this.lastStateVersionByWaypoint.get(current.waypointId) || 0;
      released =
        response.ok &&
        this.validCorrelatedResponse(payload, response.payload) &&
        response.payload.state_version > this.snapshotStateVersion &&
        response.payload.state_version >= lastStateVersion;
      if (released) {
        this.lastStateVersionByWaypoint.set(current.waypointId, response.payload.state_version);
      } else if (response.ok) {
        this.releaseUnconfirmedReservation(payload, epoch, channel, requestTimeoutMs);
      }
    } catch {
      // Either lost attempt may have reached the server. Send one final
      // idempotent conditional release before relying on lease expiry.
      this.releaseUnconfirmedReservation(payload, epoch, channel, requestTimeoutMs);
    }

    if (!this.isCurrentEpoch(epoch, channel)) return false;
    if (this.current && this.current.reservationId === current.reservationId) {
      this.active.delete(current.waypointId);
      this.clearCurrent(false);
      this.onStateChange({ type: "current", waypointId: current.waypointId, occupied: false, expiresAt: null });
    }
    if (this.abandoningReservationId === current.reservationId) this.abandoningReservationId = null;
    if (this.releasingReservationId === current.reservationId) this.releasingReservationId = null;
    return released;
  }

  scheduleOrphanRelease() {
    if (!this.supported || !this.channel || !this.pendingOrphan) return;
    const orphan = this.pendingOrphan;
    const epoch = this.epoch;
    const channel = this.channel;
    this.enqueue(() => this.performOrphanRelease(orphan, epoch, channel));
  }

  async performOrphanRelease(orphan, epoch, channel) {
    if (!this.isCurrentEpoch(epoch, channel) || this.pendingOrphan !== orphan) return false;
    if (orphan.expiresAt <= this.now()) {
      this.pendingOrphan = null;
      if (this.abandoningReservationId === orphan.reservationId) this.abandoningReservationId = null;
      this.active.delete(orphan.waypointId);
      return true;
    }

    const payload = {
      protocol: WAYPOINT_RESERVATION_PROTOCOL,
      action: "release",
      waypoint_id: orphan.waypointId,
      operation_id: this.uuid(),
      reservation_id: orphan.reservationId,
      request_seq: ++this.requestSeq
    };

    let response;
    try {
      response = await this.request(payload, epoch, channel, this.requestTimeoutMs);
    } catch {
      if (this.isCurrentEpoch(epoch, channel) && this.pendingOrphan === orphan) {
        this.pendingOrphan = null;
        if (this.abandoningReservationId === orphan.reservationId) this.abandoningReservationId = null;
      }
      return false;
    }

    if (!this.isCurrentEpoch(epoch, channel) || this.pendingOrphan !== orphan) return false;
    const lastStateVersion = this.lastStateVersionByWaypoint.get(orphan.waypointId) || 0;
    const released =
      response.ok &&
      this.validCorrelatedResponse(payload, response.payload) &&
      response.payload.state_version > this.snapshotStateVersion &&
      response.payload.state_version >= lastStateVersion;
    this.pendingOrphan = null;
    if (this.abandoningReservationId === orphan.reservationId) this.abandoningReservationId = null;
    if (released) {
      this.lastStateVersionByWaypoint.set(orphan.waypointId, response.payload.state_version);
      this.active.delete(orphan.waypointId);
      this.onStateChange({ type: "state", waypointId: orphan.waypointId, occupied: false, expiresAt: null });
    }
    return released;
  }

  async performRenew(epoch) {
    this.renewTimer = null;
    if (!this.isCurrentEpoch(epoch)) return;
    this.pruneExpired();
    if (!this.supported || !this.current) return;

    // release() records abandonment synchronously, before its queued request
    // can run. A renewal timer may already be queued behind an in-flight seat
    // switch; never extend that abandoned lease while the release waits.
    if (this.abandoningReservationId === this.current.reservationId) return;

    const current = { ...this.current };
    const channel = this.channel;
    const requestTimeoutMs = this.requestTimeoutMs;
    const payload = {
      protocol: WAYPOINT_RESERVATION_PROTOCOL,
      action: "renew",
      waypoint_id: current.waypointId,
      operation_id: this.uuid(),
      reservation_id: current.reservationId,
      request_seq: ++this.requestSeq
    };

    try {
      const response = await this.request(payload, epoch, channel, requestTimeoutMs);
      if (!this.isCurrentEpoch(epoch, channel)) return;
      if (this.abandoningReservationId === current.reservationId) return;
      if (
        response.ok &&
        this.validCorrelatedResponse(payload, response.payload) &&
        this.current &&
        this.current.reservationId === current.reservationId
      ) {
        const expiry = boundedLeaseExpiry(response.payload.expires_at, this.now(), this.leaseMs);
        const responseStateVersion = response.payload.state_version;
        const lastStateVersion = this.lastStateVersionByWaypoint.get(current.waypointId) || 0;
        if (
          expiry > this.now() &&
          responseStateVersion > this.snapshotStateVersion &&
          responseStateVersion >= lastStateVersion
        ) {
          this.current.operationId = payload.operation_id;
          this.current.stateVersion = responseStateVersion;
          this.current.expiresAt = expiry;
          this.lastStateVersionByWaypoint.set(current.waypointId, responseStateVersion);
          this.active.set(current.waypointId, expiry);
          this.scheduleRenew();
          return;
        }
      }
      if (response.ok) this.releaseUnconfirmedReservation(payload, epoch, channel, requestTimeoutMs);
    } catch {
      if (!this.isCurrentEpoch(epoch, channel)) return;
      if (this.abandoningReservationId === current.reservationId) return;
      if (
        this.current &&
        this.current.reservationId === current.reservationId &&
        this.now() < current.expiresAt - 1000
      ) {
        this.renewTimer = this.setTimeout(() => this.enqueue(() => this.performRenew(epoch)), 500);
        return;
      }
      this.releaseUnconfirmedReservation(payload, epoch, channel, requestTimeoutMs);
    }

    if (this.current && this.current.reservationId === current.reservationId) {
      this.loseCurrent("renew_failed");
    }
  }

  scheduleRenew() {
    if (this.renewTimer !== null) this.clearTimeout(this.renewTimer);
    if (!this.current) return;
    if (this.abandoningReservationId === this.current.reservationId) {
      this.renewTimer = null;
      return;
    }
    const epoch = this.epoch;
    const remaining = this.current.expiresAt - this.now();
    const delay = Math.max(250, Math.min(Math.floor(this.leaseMs / 3), remaining - 1000));
    this.renewTimer = this.setTimeout(() => this.enqueue(() => this.performRenew(epoch)), delay);
  }

  clearCurrent(notifyLost, reason) {
    if (this.renewTimer !== null) {
      this.clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
    const previous = this.current;
    this.current = null;
    this.currentClaimId = null;
    if (notifyLost && previous) this.onReservationLost({ waypointId: previous.waypointId, reason });
  }

  loseCurrent(reason) {
    if (!this.current) return;
    const reservationId = this.current.reservationId;
    const waypointId = this.current.waypointId;
    this.active.delete(waypointId);
    this.clearCurrent(true, reason);
    if (this.abandoningReservationId === reservationId) this.abandoningReservationId = null;
    this.onStateChange({ type: "current", waypointId, occupied: false, expiresAt: null });
  }

  pruneExpired() {
    const now = this.now();
    for (const [waypointId, expiry] of this.active) {
      if (expiry <= now) this.active.delete(waypointId);
    }
    if (this.pendingOrphan && this.pendingOrphan.expiresAt <= now) this.pendingOrphan = null;
    if (this.current && this.current.expiresAt <= now) this.loseCurrent("lease_expired");
  }

  isCurrentEpoch(epoch, channel = this.channel) {
    return this.supported && this.channel && this.channel === channel && this.epoch === epoch;
  }

  async request(payload, epoch, channel, requestTimeoutMs) {
    let lastError;
    for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
      if (!this.isCurrentEpoch(epoch, channel)) throw new WaypointReservationTimeoutError();
      try {
        return await this.pushOnce(payload, channel, requestTimeoutMs);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new WaypointReservationTimeoutError();
  }

  pushOnce(payload, channel, requestTimeoutMs) {
    if (!channel) return Promise.reject(new WaypointReservationTimeoutError());

    return new Promise((resolve, reject) => {
      let settled = false;
      const pendingRequest = {};
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        this.pendingRequests.delete(pendingRequest);
        callback(value);
      };
      pendingRequest.cancel = () => settle(reject, new WaypointReservationTimeoutError());
      this.pendingRequests.add(pendingRequest);

      channel
        .push(WAYPOINT_RESERVATION_EVENT, payload, requestTimeoutMs)
        .receive("ok", response => settle(resolve, { ok: true, payload: response }))
        .receive("error", response => settle(resolve, { ok: false, payload: response }))
        .receive("timeout", () => settle(reject, new WaypointReservationTimeoutError()));
    });
  }

  cancelPendingRequests() {
    for (const pendingRequest of Array.from(this.pendingRequests)) pendingRequest.cancel();
  }

  validCorrelatedResponse(request, response) {
    const successSemantics =
      request.action === "release"
        ? response && response.occupied === false && response.expires_at === null
        : response &&
          (request.action === "reserve" || request.action === "renew") &&
          response.occupied === true &&
          typeof response.expires_at === "string" &&
          Number.isFinite(expiresAtMillis(response.expires_at));
    return !!(
      response &&
      response.protocol === WAYPOINT_RESERVATION_PROTOCOL &&
      response.status === "ok" &&
      response.reason === null &&
      response.action === request.action &&
      response.operation_id === request.operation_id &&
      response.reservation_id === request.reservation_id &&
      response.request_seq === request.request_seq &&
      response.waypoint_id === request.waypoint_id &&
      isStateVersion(response.state_version) &&
      successSemantics
    );
  }
}
