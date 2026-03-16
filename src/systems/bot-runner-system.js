import * as THREE from "three";
import configs from "../utils/configs";
import { fetchReticulumAuthenticated } from "../utils/phoenix-utils";
import qsTruthy from "../utils/qs_truthy";

const CONFIG_REFRESH_INTERVAL_MS = 3000;
const FEATURED_AVATARS_REFRESH_INTERVAL_MS = 60000;
const BOT_COMMAND_TYPE = "bot_command";
const WAYPOINT_RAYCAST_HEIGHT_M = 0.2;
const WAYPOINT_RAYCAST_ENDPOINT_EPSILON_M = 0.1;

// Path movement is time-based so it stays smooth even if the headless runner hitches.
const PATH_START_DELAY_MS = 450;
const MIN_WALK_DURATION_MS = 600;
const OCCUPANT_SYNC_INTERVAL_MS = 500;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngleDeg(deg) {
  const n = Number(deg) || 0;
  return ((n % 360) + 360) % 360;
}

function normalizeBotsConfig(config) {
  const normalized = {
    enabled: !!(config && config.enabled),
    count: clamp(Number((config && config.count) || 0) || 0, 0, 10),
    mobility: (config && config.mobility) || "medium",
    chatEnabled: !!(config && config.chat_enabled)
  };

  if (!["low", "medium", "high"].includes(normalized.mobility)) {
    normalized.mobility = "medium";
  }

  return normalized;
}

const MOBILITY_BEHAVIOR = {
  low: {
    speedMps: 0.45,
    idleMinMs: 8000,
    idleMaxMs: 22000
  },
  medium: {
    speedMps: 0.75,
    idleMinMs: 4500,
    idleMaxMs: 14000
  },
  high: {
    speedMps: 1.05,
    idleMinMs: 2500,
    idleMaxMs: 8000
  }
};

AFRAME.registerSystem("bot-runner-system", {
  init() {
    this.enabled = !!configs.feature("enable_room_bots") && qsTruthy("bot_runner");
    this.debug = this.enabled && qsTruthy("bot_debug");
    this.bots = new Map();
    this.reservedTargets = new Map();
    this.avatarRefs = [];
    this.fullbodyAvatarRefs = [];
    this.avatarRotationOffset = Math.floor(Math.random() * 1000);
    this.spawnPoints = [];
    this.patrolPoints = [];
    this.allWaypoints = [];
    this.spawnFlagPoints = [];
    this.namedSpawbots = [];
    this.lastConfigRefreshAt = 0;
    this.lastFeaturedAvatarRefreshAt = 0;
    this._wasConnected = false;
    this._tmpDir = new THREE.Vector3();
    this._tmpSpawnOffset = new THREE.Vector3();
    this._tmpPathPos = new THREE.Vector3();
    this._tmpPathStart = new THREE.Vector3();
    this._tmpPathEnd = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._raycastRoots = null;
    this._tmpRayOrigin = new THREE.Vector3();
    this._tmpRayTarget = new THREE.Vector3();
    this._tmpRayDir = new THREE.Vector3();
    this._knownOccupants = new Set();
    this._lastOccupantScanAt = 0;

    this.onHubUpdated = this.onHubUpdated.bind(this);
    this.onMessage = this.onMessage.bind(this);

    if (!this.enabled) return;

    this.el.sceneEl.addEventListener("hub_updated", this.onHubUpdated);

    if (window.APP && window.APP.messageDispatch) {
      window.APP.messageDispatch.addEventListener("message", this.onMessage);
    }

    this.refreshFeaturedAvatarIds();
  },

  remove() {
    this.el.sceneEl.removeEventListener("hub_updated", this.onHubUpdated);

    if (window.APP && window.APP.messageDispatch) {
      window.APP.messageDispatch.removeEventListener("message", this.onMessage);
    }

    this.clearBots();
  },

  onHubUpdated() {
    this.refreshPatrolPoints();
    this.reconcileBots(true);
  },

  onMessage(e) {
    if (!this.enabled) return;

    const message = e && e.detail;
    if (!message || message.type !== BOT_COMMAND_TYPE) return;

    const body = message.body;
    if (!body || typeof body !== "object") return;

    this.handleBotCommand(body);
  },

  getRoomBotsConfig() {
    const userData = (window.APP && window.APP.hub && window.APP.hub.user_data) || {};
    return normalizeBotsConfig(userData.bots || {});
  },

  getServerNowMs() {
    const connection = window.NAF && window.NAF.connection;
    const adapter = connection && connection.adapter;
    if (adapter && typeof adapter.getServerTime === "function") {
      try {
        return adapter.getServerTime();
      } catch (e) {
        console.warn("bot-runner-system: adapter.getServerTime failed, falling back to performance.now", e);
      }
    }

    if (connection && typeof connection.getServerTime === "function") {
      try {
        return connection.getServerTime();
      } catch (e) {
        console.warn("bot-runner-system: connection.getServerTime failed, falling back to performance.now", e);
      }
    }

    return performance.now();
  },

  async refreshFeaturedAvatarIds() {
    try {
      const res = await fetchReticulumAuthenticated("/api/v1/media/search?source=avatar_listings&filter=featured");
      const allRefs = [];
      const fullbodyRefs = [];

      for (const entry of (res && res.entries) || []) {
        const ref = (entry && entry.gltfs && entry.gltfs.avatar) || null;
        if (!ref) continue;

        allRefs.push(ref);

        const tags = ((entry && entry.tags && entry.tags.tags) || []).map(t => String(t).toLowerCase());
        const isFullbody = tags.includes("fullbody") || tags.includes("rpm");
        if (isFullbody) {
          fullbodyRefs.push(ref);
        }
      }

      this.avatarRefs = Array.from(new Set(allRefs));
      this.fullbodyAvatarRefs = Array.from(new Set(fullbodyRefs));
      this.avatarRotationOffset = Math.floor(Math.random() * 1000);
      this.reseedBotAvatars();
    } catch (e) {
      console.warn("Failed to fetch featured avatars for bots", e);
      this.avatarRefs = [];
      this.fullbodyAvatarRefs = [];
    }
  },

  refreshPatrolPoints() {
    const allPoints = [];
    const spawnFlagPoints = [];
    const namedSpawbots = [];

    const scene = this.el && this.el.sceneEl;
    const waypointEls = scene
      ? Array.from(scene.querySelectorAll("[waypoint]")).filter(el => !el.closest("a-assets"))
      : [];

    for (let i = 0; i < waypointEls.length; i++) {
      const waypointEl = waypointEls[i];
      const waypointComponent = waypointEl.components && waypointEl.components.waypoint;
      const data = (waypointComponent && waypointComponent.data) || null;

      const obj = waypointEl.object3D;
      if (!obj) continue;

      // Ensure world transforms are up to date before sampling positions.
      if (typeof obj.updateMatrices === "function") {
        obj.updateMatrices();
      } else if (typeof obj.updateMatrixWorld === "function") {
        obj.updateMatrixWorld(true);
      }

      const rawName = (obj.name || waypointEl.id || `waypoint-${i}`).trim();
      const pointName = rawName || `waypoint-${i}`;
      const lowerName = pointName.toLowerCase();
      const isNamedSpawbot = lowerName.startsWith("spawbot-");
      const isSpawnFlag = !!(data && data.canBeSpawnPoint);

      const pos = obj.getWorldPosition(new THREE.Vector3());
      const point = {
        name: pointName,
        position: pos,
        flags: data
      };

      allPoints.push(point);
      if (isSpawnFlag) spawnFlagPoints.push(point);
      if (isNamedSpawbot) namedSpawbots.push(point);
    }

    this.allWaypoints = allPoints;
    this.spawnFlagPoints = spawnFlagPoints;
    this.namedSpawbots = namedSpawbots;

    // Spawn priority:
    // 1) named "spawbot-*" waypoints
    // 2) waypoints marked as spawn points
    // 3) any waypoint in the scene (so bots never default to origin when waypoints exist)
    this.spawnPoints = namedSpawbots.length ? namedSpawbots : spawnFlagPoints.length ? spawnFlagPoints : allPoints;

    // Patrol priority:
    // 1) named "spawbot-*" waypoints (only when there are at least 2 so movement is possible)
    // 2) any waypoint in the scene
    // 3) spawn-flagged waypoints
    this.patrolPoints =
      namedSpawbots.length >= 2
        ? namedSpawbots
        : allPoints.length >= 2
          ? allPoints
          : spawnFlagPoints.length >= 2
            ? spawnFlagPoints
            : [];

    if (this.debug) {
      console.log(
        `[bot-runner] Waypoints: all=${allPoints.length} spawnFlag=${spawnFlagPoints.length} spawbot=${namedSpawbots.length} spawnPoints=${this.spawnPoints.length} patrolPoints=${this.patrolPoints.length}`
      );
      if (namedSpawbots.length) {
        console.log(
          "[bot-runner] spawbot-*:",
          namedSpawbots.map(p => p.name)
        );
      }
    }
  },

  getPreferredAvatarRefs() {
    return this.fullbodyAvatarRefs.length ? this.fullbodyAvatarRefs : this.avatarRefs;
  },

  pickAvatarId(botId = null) {
    const refs = this.getPreferredAvatarRefs();
    if (refs.length) {
      if (botId) {
        const index = (this.botIndex(botId) + this.avatarRotationOffset) % refs.length;
        return refs[index];
      }

      return refs[Math.floor(Math.random() * refs.length)];
    }

    const fallbackProfileAvatarId = window.APP?.store?.state?.profile?.avatarId;
    return fallbackProfileAvatarId || "";
  },

  reseedBotAvatars() {
    const refs = this.getPreferredAvatarRefs();
    if (!refs.length) return;

    this.bots.forEach(record => {
      const currentAvatarId = record.el?.components?.["bot-info"]?.data?.avatarId;
      if (currentAvatarId && refs.includes(currentAvatarId)) return;

      record.el.setAttribute("bot-info", "avatarId", this.pickAvatarId(record.id));
    });
  },

  pickSpawnPoint(botId) {
    const points = this.spawnPoints.length ? this.spawnPoints : this.patrolPoints;
    if (!points.length) return null;

    const index = this.botIndex(botId);
    return points[index % points.length];
  },

  botIndex(botId) {
    return Math.max(Number(String(botId).replace("bot-", "")) - 1, 0);
  },

  separateNearbyPosition(position, botId, radius = 0.8) {
    const adjusted = position.clone();
    const index = this.botIndex(botId);
    if (index === 0) return adjusted;

    const minDistanceSq = 0.36;
    let conflicts = 0;

    this.bots.forEach(record => {
      if (!record || record.id === botId) return;
      if (record.position.distanceToSquared(adjusted) < minDistanceSq) {
        conflicts += 1;
      }
    });

    if (!conflicts) return adjusted;

    const angle = index * ((Math.PI * 2) / 6);
    const spreadRadius = radius + Math.min(conflicts, 2) * 0.2;
    this._tmpSpawnOffset.set(Math.cos(angle) * spreadRadius, 0, Math.sin(angle) * spreadRadius);
    adjusted.add(this._tmpSpawnOffset);

    return adjusted;
  },

  positionForSpawnPoint(point, botId) {
    return this.separateNearbyPosition(point.position, botId, 0.8);
  },

  randomNearbyDestination(record) {
    const origin = record.homePosition || record.position;
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.8 + Math.random() * 1.2;
    return new THREE.Vector3(
      origin.x + Math.cos(angle) * radius,
      record.position.y,
      origin.z + Math.sin(angle) * radius
    );
  },

  ensureRaycastRoots() {
    if (this._raycastRoots) return this._raycastRoots;

    const env = this.el.sceneEl && this.el.sceneEl.querySelector("#environment-root");
    const objects = this.el.sceneEl && this.el.sceneEl.querySelector("#objects-root");

    const roots = [];
    if (env && env.object3D) roots.push(env.object3D);
    if (objects && objects.object3D) roots.push(objects.object3D);

    this._raycastRoots = roots;
    return roots;
  },

  isPathClear(fromPosition, toPosition) {
    if (!fromPosition || !toPosition) return true;

    const roots = this.ensureRaycastRoots();
    if (!roots || roots.length === 0) return true;

    this._tmpRayOrigin.copy(fromPosition);
    this._tmpRayTarget.copy(toPosition);
    this._tmpRayOrigin.y += WAYPOINT_RAYCAST_HEIGHT_M;
    this._tmpRayTarget.y += WAYPOINT_RAYCAST_HEIGHT_M;

    this._tmpRayDir.copy(this._tmpRayTarget).sub(this._tmpRayOrigin);
    const distance = this._tmpRayDir.length();
    if (distance <= WAYPOINT_RAYCAST_ENDPOINT_EPSILON_M * 2) return true;

    this._tmpRayDir.normalize();
    this._raycaster.set(this._tmpRayOrigin, this._tmpRayDir);
    this._raycaster.far = distance;

    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const hits = this._raycaster.intersectObject(root, true);
      if (!hits || hits.length === 0) continue;

      const hit = hits[0];
      const d = hit.distance;
      if (d > WAYPOINT_RAYCAST_ENDPOINT_EPSILON_M && d < distance - WAYPOINT_RAYCAST_ENDPOINT_EPSILON_M) {
        return false;
      }
    }

    return true;
  },

  reserveTarget(record, targetName) {
    if (!record || !targetName || targetName === "__wander__") return;

    // Release previous reservation (if any).
    this.releaseReservation(record);

    record.reservedTargetName = targetName;
    this.reservedTargets.set(targetName, record.id);
  },

  releaseReservation(record) {
    if (!record) return;
    const name = record.reservedTargetName;
    if (!name) return;
    if (this.reservedTargets.get(name) === record.id) {
      this.reservedTargets.delete(name);
    }
    record.reservedTargetName = null;
  },

  pickPatrolPoint(botId, excludeName, fromPosition) {
    if (!this.patrolPoints.length) return null;

    const isReservedByOther = point => {
      const owner = this.reservedTargets.get(point.name);
      return owner && owner !== botId;
    };

    const candidates = this.patrolPoints.filter(point => {
      if (point.name === excludeName) return false;
      if (isReservedByOther(point)) return false;
      if (!fromPosition) return true;
      return point.position.distanceToSquared(fromPosition) > 0.04;
    });
    const source = candidates.length
      ? candidates
      : // If every waypoint is reserved, allow selecting reserved ones rather than getting stuck.
        this.patrolPoints.filter(point => point.name !== excludeName);

    if (!source.length) return null;

    if (!fromPosition) {
      return source[Math.floor(Math.random() * source.length)];
    }

    // Prefer a reachable target (line of sight at ~0.20m above ground).
    const indices = Array.from({ length: source.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = indices[i];
      indices[i] = indices[j];
      indices[j] = tmp;
    }

    const maxAttempts = Math.min(8, indices.length);
    for (let i = 0; i < maxAttempts; i++) {
      const point = source[indices[i]];
      if (!point) continue;
      if (this.isPathClear(fromPosition, point.position)) return point;
      if (this.debug) {
        console.log(`[bot-runner] Path blocked: ${excludeName || "(none)"} -> ${point.name}`);
      }
    }

    return null;
  },

  createBot(botId, config) {
    const startPoint = this.pickSpawnPoint(botId);
    const startPos = startPoint ? this.positionForSpawnPoint(startPoint, botId) : new THREE.Vector3();
    const avatarId = this.pickAvatarId(botId);
    const startYaw = Math.random() * 360;
    const now = this.getServerNowMs();

    const el = document.createElement("a-entity");
    el.setAttribute("networked", "template: #remote-bot-avatar; attachTemplateToLocal: false;");
    el.setAttribute("bot-path", {
      sx: startPos.x,
      sy: startPos.y,
      sz: startPos.z,
      ex: startPos.x,
      ey: startPos.y,
      ez: startPos.z,
      t0: now,
      dur: 0,
      yaw0: startYaw,
      yaw1: startYaw
    });
    el.setAttribute("bot-info", {
      botId,
      avatarId,
      displayName: botId
    });
    this.el.sceneEl.appendChild(el);

    // Best-effort immediate full sync once networked is initialized (periodic-full-syncs will keep retrying).
    const trySyncOnce = () => {
      const networked = el.components && el.components.networked;
      if (!networked || typeof networked.syncAll !== "function") return false;
      try {
        networked.syncAll(null, true);
      } catch {
        // Best-effort only. periodic-full-syncs will retry.
      }
      return true;
    };
    if (!trySyncOnce()) {
      const onInit = e => {
        if (e && e.detail && e.detail.name === "networked") {
          el.removeEventListener("componentinitialized", onInit);
          trySyncOnce();
        }
      };
      el.addEventListener("componentinitialized", onInit);
      setTimeout(() => {
        el.removeEventListener("componentinitialized", onInit);
        trySyncOnce();
      }, 2000);
    }

    const idleDuration = this.initialIdleDurationMs(config.mobility);

    this.bots.set(botId, {
      id: botId,
      el,
      state: "idle",
      position: startPos,
      homePosition: startPos.clone(),
      yawDeg: normalizeAngleDeg(startYaw),
      destination: null,
      path: null,
      reservedTargetName: null,
      stateEndsAt: now + idleDuration,
      mobility: config.mobility
    });
  },

  removeBot(botId) {
    const record = this.bots.get(botId);
    if (!record) return;

    this.releaseReservation(record);

    if (record.el && record.el.parentNode) {
      record.el.parentNode.removeChild(record.el);
    }

    this.bots.delete(botId);
  },

  clearBots() {
    Array.from(this.bots.keys()).forEach(botId => this.removeBot(botId));
  },

  randomIdleDurationMs(mobility) {
    const behavior = MOBILITY_BEHAVIOR[mobility] || MOBILITY_BEHAVIOR.medium;
    const range = behavior.idleMaxMs - behavior.idleMinMs;
    return behavior.idleMinMs + Math.floor(Math.random() * Math.max(range, 1));
  },

  initialIdleDurationMs(mobility) {
    if (mobility === "low") {
      return 2000 + Math.floor(Math.random() * 3000);
    }

    if (mobility === "high") {
      return 800 + Math.floor(Math.random() * 1000);
    }

    return 1200 + Math.floor(Math.random() * 1300);
  },

  reconcileBots(force = false) {
    if (!this.enabled) return;

    const config = this.getRoomBotsConfig();
    if (!config.enabled || config.count === 0) {
      this.clearBots();
      return;
    }

    if (!this.patrolPoints.length || force) {
      this.refreshPatrolPoints();
    }

    for (let i = 0; i < config.count; i++) {
      const botId = `bot-${i + 1}`;
      if (!this.bots.has(botId)) {
        this.createBot(botId, config);
      }
    }

    Array.from(this.bots.keys()).forEach(botId => {
      const index = Number(botId.replace("bot-", ""));
      if (index > config.count) {
        this.removeBot(botId);
      }
    });

    this.bots.forEach(record => {
      if (record.mobility !== config.mobility) {
        record.mobility = config.mobility;
      }
    });
  },

  updateRecordPositionFromPath(record, nowMs) {
    const path = record && record.path;
    if (!path) return;

    const dur = Math.max(0, Number(path.dur) || 0);
    const t0 = Number(path.t0) || 0;

    let alpha = 1;
    if (dur > 0) {
      if (nowMs <= t0) {
        alpha = 0;
      } else {
        alpha = (nowMs - t0) / dur;
      }
      alpha = clamp(alpha, 0, 1);
    }

    record.position.lerpVectors(path.startPos, path.endPos, alpha);
  },

  startWalking(record, waypointName, nowMs = this.getServerNowMs()) {
    this.updateRecordPositionFromPath(record, nowMs);

    let target = null;

    if (waypointName) {
      const desired = String(waypointName).trim().toLowerCase();
      target = this.allWaypoints.find(point => (point.name || "").trim().toLowerCase() === desired);

      if (target && !this.isPathClear(record.position, target.position)) {
        if (this.debug) {
          console.log(`[bot-runner] Commanded waypoint blocked, skipping: ${desired}`);
        }
        target = null;
      }
    }

    if (!target) {
      target = this.pickPatrolPoint(record.id, record.destination?.name, record.position);
    }

    if (!target) {
      target = {
        name: "__wander__",
        position: this.randomNearbyDestination(record)
      };
    } else if (target.position.distanceTo(record.position) <= 0.08) {
      // If we accidentally picked a point right on top of us, try another patrol point before falling back to wander.
      const alt = this.pickPatrolPoint(record.id, target.name, record.position);
      target = alt || {
        name: "__wander__",
        position: this.randomNearbyDestination(record)
      };
    }

    if (target.name && target.name !== "__wander__") {
      this.reserveTarget(record, target.name);
    } else {
      this.releaseReservation(record);
    }

    const behavior = MOBILITY_BEHAVIOR[record.mobility] || MOBILITY_BEHAVIOR.medium;
    const startPos = record.position.clone();
    const destination = this.separateNearbyPosition(target.position, record.id, 0.45);
    const endPos = destination.clone();

    this._tmpDir.copy(endPos).sub(startPos);
    const distance = this._tmpDir.length();
    if (distance <= 0.08) {
      // No meaningful movement possible; return to idle quickly.
      this.setIdle(record, nowMs);
      return;
    }

    const speedMps = Math.max(0.05, Number(behavior.speedMps) || 0.75);
    const durMs = Math.max(MIN_WALK_DURATION_MS, (distance / speedMps) * 1000);
    const t0 = nowMs + PATH_START_DELAY_MS;

    // Face the direction of travel. For most glTF avatars, +Z is "forward".
    const desiredYaw = normalizeAngleDeg(THREE.MathUtils.radToDeg(Math.atan2(this._tmpDir.x, this._tmpDir.z)));
    const yaw0 = normalizeAngleDeg(record.yawDeg);
    const yaw1 = desiredYaw;

    record.state = "walk";
    record.destination = { name: target.name, position: endPos };
    record.path = { startPos, endPos, t0, dur: durMs, yaw0, yaw1 };
    record.stateEndsAt = t0 + durMs;
    record.yawDeg = yaw1;

    record.el.setAttribute("bot-path", {
      sx: startPos.x,
      sy: startPos.y,
      sz: startPos.z,
      ex: endPos.x,
      ey: endPos.y,
      ez: endPos.z,
      t0,
      dur: durMs,
      yaw0,
      yaw1
    });
  },

  setIdle(record, nowMs = this.getServerNowMs()) {
    this.updateRecordPositionFromPath(record, nowMs);

    record.state = "idle";
    record.destination = null;
    this.releaseReservation(record);
    record.path = null;
    record.stateEndsAt = nowMs + this.randomIdleDurationMs(record.mobility);

    // Freeze the bot at its current location for late joiners.
    record.el.setAttribute("bot-path", {
      sx: record.position.x,
      sy: record.position.y,
      sz: record.position.z,
      ex: record.position.x,
      ey: record.position.y,
      ez: record.position.z,
      t0: nowMs,
      dur: 0,
      yaw0: record.yawDeg,
      yaw1: record.yawDeg
    });
  },

  handleBotCommand(command) {
    const botId = command.bot_id || command.botId;
    if (!botId) return;

    const record = this.bots.get(botId);
    if (!record) return;

    if (command.type === "go_to_waypoint" && command.waypoint) {
      this.startWalking(record, String(command.waypoint), this.getServerNowMs());
    }
  },

  tick(t) {
    if (!this.enabled) return;
    if (!this.el.sceneEl.is("entered")) return;

    const connection = window.NAF && window.NAF.connection;
    const isConnected =
      !!connection && typeof connection.isConnected === "function" ? !!connection.isConnected() : false;

    // If the runner creates networked entities before the NAF connection is fully established,
    // those spawns may never replicate to other clients. Gate bot spawning on `isConnected`,
    // and respawn when reconnecting.
    if (!isConnected) {
      if (this._wasConnected) {
        this._wasConnected = false;
        this.clearBots();
      }
      return;
    }

    if (!this._wasConnected) {
      this._wasConnected = true;
      this.clearBots();
      this._knownOccupants.clear();
      this._lastOccupantScanAt = 0;
      this.lastConfigRefreshAt = 0;
    }

    // Directed first-syncs to mitigate missed instantiation messages on late joiners without resending
    // full sync broadcasts periodically (which can cause visible snapping at segment boundaries).
    if (t - this._lastOccupantScanAt >= OCCUPANT_SYNC_INTERVAL_MS) {
      this._lastOccupantScanAt = t;

      const adapter = window.NAF?.connection?.adapter;
      const occupants = adapter && adapter.occupants ? Object.keys(adapter.occupants) : [];
      for (let i = 0; i < occupants.length; i++) {
        const clientId = occupants[i];
        if (!clientId || this._knownOccupants.has(clientId)) continue;
        this._knownOccupants.add(clientId);

        this.bots.forEach(record => {
          const net = record?.el?.components?.networked;
          if (!net || typeof net.syncAll !== "function") return;
          try {
            net.syncAll(clientId, true);
          } catch {
            // Best-effort: the next scan will retry if needed.
          }
        });
      }
    }

    if (t - this.lastConfigRefreshAt > CONFIG_REFRESH_INTERVAL_MS) {
      this.lastConfigRefreshAt = t;
      this.reconcileBots();
    }

    if (t - this.lastFeaturedAvatarRefreshAt > FEATURED_AVATARS_REFRESH_INTERVAL_MS) {
      this.lastFeaturedAvatarRefreshAt = t;
      this.refreshFeaturedAvatarIds();
    }

    const now = this.getServerNowMs();

    this.bots.forEach(record => {
      // Keep the runner's idea of the bot position in sync with time-based motion.
      this.updateRecordPositionFromPath(record, now);

      if (record.state === "idle") {
        if (now >= record.stateEndsAt) {
          this.startWalking(record, null, now);
        }
      } else if (record.state === "walk") {
        if (now >= record.stateEndsAt) {
          this.setIdle(record, now);
        }
      }
    });
  }
});
