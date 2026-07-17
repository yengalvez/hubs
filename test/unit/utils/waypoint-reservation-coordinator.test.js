import test from "ava";

import {
  WAYPOINT_RESERVATION_EVENT,
  WAYPOINT_RESERVATION_PROTOCOL,
  WAYPOINT_RESERVATION_STATE_EVENT,
  WaypointReservationCoordinator
} from "../../../src/utils/waypoint-reservation-coordinator";

const NOW = Date.parse("2026-07-17T10:00:00.000Z");

function capability(overrides = {}) {
  return {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    supported: true,
    lease_ms: 15000,
    request_timeout_ms: 3000,
    request_seq: 0,
    snapshot_state_version: 1,
    active: [],
    current: null,
    ...overrides
  };
}

function correlatedResponse(payload, overrides = {}) {
  const released = payload.action === "release";
  return {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    status: "ok",
    reason: null,
    action: payload.action,
    operation_id: payload.operation_id,
    reservation_id: payload.reservation_id,
    request_seq: payload.request_seq,
    waypoint_id: payload.waypoint_id,
    state_version: payload.request_seq + 1,
    occupied: !released,
    expires_at: released ? null : new Date(NOW + 15000).toISOString(),
    ...overrides
  };
}

class FakePush {
  constructor(result) {
    this.result = result;
    this.hooks = new Map();
    this.scheduled = false;
  }

  receive(status, callback) {
    this.hooks.set(status, callback);
    if (!this.scheduled && this.result.status !== "deferred") {
      this.scheduled = true;
      Promise.resolve().then(() => {
        const hook = this.hooks.get(this.result.status);
        if (hook) hook(this.result.payload);
      });
    }
    return this;
  }

  emit(status, payload) {
    const hook = this.hooks.get(status);
    if (hook) hook(payload);
  }
}

class FakeChannel {
  constructor(responder) {
    this.responder = responder;
    this.pushes = [];
    this.bindings = new Map();
    this.pushHandles = [];
    this.nextBindingRef = 1;
  }

  push(event, payload, timeout) {
    this.pushes.push({ event, payload: { ...payload }, timeout });
    const handle = new FakePush(this.responder(payload, this.pushes.length));
    this.pushHandles.push(handle);
    return handle;
  }

  on(event, callback) {
    const ref = this.nextBindingRef++;
    this.bindings.set(ref, { event, callback });
    return ref;
  }

  off(event, ref) {
    const binding = this.bindings.get(ref);
    if (binding && binding.event === event) this.bindings.delete(ref);
  }

  emit(event, payload) {
    for (const binding of this.bindings.values()) {
      if (binding.event === event) binding.callback(payload);
    }
  }
}

function createHarness(responder, { nowFn = () => NOW } = {}) {
  const timers = [];
  const stateChanges = [];
  const lost = [];
  let uuidNumber = 0;
  const coordinator = new WaypointReservationCoordinator({
    uuidFn: () => `00000000-0000-4000-8000-${String(++uuidNumber).padStart(12, "0")}`,
    now: nowFn,
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: timer => {
      timer.cleared = true;
    },
    onStateChange: change => stateChanges.push(change),
    onReservationLost: change => lost.push(change)
  });
  const channel = new FakeChannel(responder);
  coordinator.setChannel(channel);
  return { coordinator, channel, timers, stateChanges, lost };
}

test("fails closed when the server does not advertise the protocol", async t => {
  const { coordinator, channel } = createHarness(() => {
    throw new Error("must not push");
  });
  coordinator.configure(capability({ supported: false }));

  t.false(await coordinator.reserve("scene.seat-a"));
  t.false(coordinator.isReserved("scene.seat-a"));
  t.is(channel.pushes.length, 0);
});

test("fails closed against a legacy reservation protocol during a mixed rollout", async t => {
  const { coordinator, channel } = createHarness(() => {
    throw new Error("must not push");
  });
  coordinator.configure({ ...capability(), protocol: WAYPOINT_RESERVATION_PROTOCOL - 1 });

  t.false(await coordinator.reserve("scene.seat-a"));
  t.is(channel.pushes.length, 0);
});

test("reserves and releases using correlated, monotonic requests", async t => {
  const { coordinator, channel } = createHarness(payload => ({
    status: "ok",
    payload:
      payload.action === "release" ? correlatedResponse(payload, { expires_at: null }) : correlatedResponse(payload)
  }));
  coordinator.configure(capability());

  t.true(await coordinator.reserve("scene.seat-a"));
  t.true(coordinator.isReserved("scene.seat-a"));
  t.is(coordinator.currentWaypointId, "scene.seat-a");

  t.true(await coordinator.release());
  t.false(coordinator.isReserved("scene.seat-a"));
  t.is(coordinator.currentWaypointId, null);

  t.is(channel.pushes.length, 2);
  t.is(channel.pushes[0].event, WAYPOINT_RESERVATION_EVENT);
  t.is(channel.pushes[0].timeout, 3000);
  t.is(channel.pushes[0].payload.action, "reserve");
  t.is(channel.pushes[0].payload.request_seq, 1);
  t.is(channel.pushes[1].payload.action, "release");
  t.is(channel.pushes[1].payload.request_seq, 2);
  t.is(channel.pushes[1].payload.reservation_id, channel.pushes[0].payload.reservation_id);
});

test("an occupied response does not replace the current reservation", async t => {
  const { coordinator } = createHarness(payload => {
    if (payload.waypoint_id === "scene.seat-b") {
      return {
        status: "error",
        payload: correlatedResponse(payload, { reason: "occupied", expires_at: null })
      };
    }
    return { status: "ok", payload: correlatedResponse(payload) };
  });
  coordinator.configure(capability());

  t.true(await coordinator.reserve("scene.seat-a"));
  t.false(await coordinator.reserve("scene.seat-b"));
  t.is(coordinator.currentWaypointId, "scene.seat-a");
  t.true(coordinator.isReserved("scene.seat-a"));
});

test("an atomic seat switch does not report the released previous lease as lost", async t => {
  let firstReservationId;
  const harness = createHarness(payload => {
    if (payload.waypoint_id === "scene.seat-b") {
      harness.channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
        protocol: WAYPOINT_RESERVATION_PROTOCOL,
        waypoint_id: "scene.seat-a",
        occupied: false,
        state_version: payload.request_seq + 1,
        expires_at: null
      });
    } else {
      firstReservationId = payload.reservation_id;
    }
    return { status: "ok", payload: correlatedResponse(payload) };
  });
  const { coordinator, lost } = harness;
  coordinator.configure(capability());

  t.true(await coordinator.reserve("scene.seat-a"));
  t.true(await coordinator.reserve("scene.seat-b"));
  t.is(coordinator.currentWaypointId, "scene.seat-b");
  t.not(coordinator.current.reservationId, firstReservationId);
  t.deepEqual(lost, []);
});

test("an atomic switch keeps the old marker until the new reserve reply settles", async t => {
  let reserveCount = 0;
  const harness = createHarness(payload => {
    reserveCount += 1;
    return reserveCount === 1 ? { status: "ok", payload: correlatedResponse(payload) } : { status: "deferred" };
  });
  const { coordinator, channel, lost } = harness;
  coordinator.configure(capability());
  t.true(await coordinator.reserve("scene.seat-a"));

  const switchPromise = coordinator.reserve("scene.seat-b");
  await Promise.resolve();
  channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "scene.seat-a",
    occupied: false,
    state_version: channel.pushes[1].payload.request_seq + 1,
    expires_at: null
  });

  t.is(coordinator.currentWaypointId, "scene.seat-a");
  const fallbackRelease = coordinator.currentWaypointId === null ? coordinator.release() : Promise.resolve(false);
  channel.pushHandles[1].emit("ok", correlatedResponse(channel.pushes[1].payload));

  t.true(await switchPromise);
  t.false(await fallbackRelease);
  t.is(coordinator.currentWaypointId, "scene.seat-b");
  t.deepEqual(
    channel.pushes.map(push => push.payload.action),
    ["reserve", "reserve"]
  );
  t.deepEqual(lost, []);
});

test("conditional cleanup of a stale seat cannot release a newer reservation", async t => {
  let reserveCount = 0;
  const harness = createHarness(payload => {
    if (payload.action === "reserve") {
      reserveCount += 1;
      if (reserveCount === 2) return { status: "deferred" };
    }
    return {
      status: "ok",
      payload:
        payload.action === "release" ? correlatedResponse(payload, { expires_at: null }) : correlatedResponse(payload)
    };
  });
  const { coordinator, channel } = harness;
  coordinator.configure(capability());
  const reservationA = await coordinator.reserveWithHandle("scene.seat-a");
  t.truthy(reservationA);

  const reserveB = coordinator.reserve("scene.seat-b");
  await Promise.resolve();
  const cleanupA = coordinator.release(reservationA);
  channel.pushHandles[1].emit("ok", correlatedResponse(channel.pushes[1].payload));

  t.true(await reserveB);
  t.false(await cleanupA);
  t.is(coordinator.currentWaypointId, "scene.seat-b");
  t.deepEqual(
    channel.pushes.map(push => `${push.payload.action}:${push.payload.waypoint_id}`),
    ["reserve:scene.seat-a", "reserve:scene.seat-b"]
  );
});

test("conditional cleanup releases the old seat when a queued switch fails", async t => {
  const harness = createHarness(payload => {
    if (payload.waypoint_id === "scene.seat-b") {
      return {
        status: "error",
        payload: correlatedResponse(payload, { reason: "occupied", expires_at: null })
      };
    }
    return {
      status: "ok",
      payload:
        payload.action === "release" ? correlatedResponse(payload, { expires_at: null }) : correlatedResponse(payload)
    };
  });
  const { coordinator, channel } = harness;
  coordinator.configure(capability());
  const reservationA = await coordinator.reserveWithHandle("scene.seat-a");
  t.truthy(reservationA);

  const reserveB = coordinator.reserve("scene.seat-b");
  const cleanupA = coordinator.release(reservationA);

  t.false(await reserveB);
  t.true(await cleanupA);
  t.is(coordinator.currentWaypointId, null);
  t.deepEqual(
    channel.pushes.map(push => `${push.payload.action}:${push.payload.waypoint_id}`),
    ["reserve:scene.seat-a", "reserve:scene.seat-b", "release:scene.seat-a"]
  );
});

test("a queued renewal cannot extend a lease after synchronous release intent", async t => {
  const harness = createHarness(payload => {
    if (payload.waypoint_id === "scene.seat-b") {
      return {
        status: "error",
        payload: correlatedResponse(payload, { reason: "occupied", expires_at: null })
      };
    }
    return {
      status: "ok",
      payload:
        payload.action === "release" ? correlatedResponse(payload, { expires_at: null }) : correlatedResponse(payload)
    };
  });
  const { coordinator, channel, timers } = harness;
  coordinator.configure(capability());
  const reservationA = await coordinator.reserveWithHandle("scene.seat-a");
  t.truthy(reservationA);

  const renewTimer = timers.find(timer => !timer.cleared);
  t.truthy(renewTimer);
  const reserveB = coordinator.reserve("scene.seat-b");
  renewTimer.callback();
  const cleanupA = coordinator.release(reservationA);

  t.false(await reserveB);
  t.true(await cleanupA);
  await coordinator.operationChain;
  t.is(coordinator.currentWaypointId, null);
  t.deepEqual(
    channel.pushes.map(push => `${push.payload.action}:${push.payload.waypoint_id}`),
    ["reserve:scene.seat-a", "reserve:scene.seat-b", "release:scene.seat-a"]
  );
});

test("a stale token cannot release a reacquired reservation for the same waypoint", async t => {
  const { coordinator, channel } = createHarness(payload => ({
    status: "ok",
    payload:
      payload.action === "release" ? correlatedResponse(payload, { expires_at: null }) : correlatedResponse(payload)
  }));
  coordinator.configure(capability());

  const firstA = await coordinator.reserveWithHandle("scene.seat-a");
  t.truthy(firstA);
  const reserveB = coordinator.reserve("scene.seat-b");
  const secondA = coordinator.reserveWithHandle("scene.seat-a");
  const staleCleanup = coordinator.release(firstA);

  t.true(await reserveB);
  const reacquired = await secondA;
  t.truthy(reacquired);
  t.not(reacquired.reservationId, firstA.reservationId);
  t.false(await staleCleanup);
  t.is(coordinator.currentWaypointId, "scene.seat-a");
  t.deepEqual(
    channel.pushes.map(push => `${push.payload.action}:${push.payload.waypoint_id}`),
    ["reserve:scene.seat-a", "reserve:scene.seat-b", "reserve:scene.seat-a"]
  );
});

test("a stale same-waypoint claimant cannot release the newer claimant", async t => {
  const { coordinator, channel } = createHarness(payload => ({
    status: "ok",
    payload:
      payload.action === "release" ? correlatedResponse(payload, { expires_at: null }) : correlatedResponse(payload)
  }));
  coordinator.configure(capability());

  const firstA = coordinator.reserveWithHandle("scene.seat-a");
  const secondA = coordinator.reserveWithHandle("scene.seat-a");
  const firstHandle = await firstA;
  const secondHandle = await secondA;
  t.truthy(firstHandle);
  t.truthy(secondHandle);
  t.is(secondHandle.reservationId, firstHandle.reservationId);
  t.not(secondHandle.claimId, firstHandle.claimId);

  t.false(await coordinator.release(firstHandle));
  t.is(coordinator.currentWaypointId, "scene.seat-a");
  t.deepEqual(
    channel.pushes.map(push => `${push.payload.action}:${push.payload.waypoint_id}`),
    ["reserve:scene.seat-a"]
  );
});

test("a timeout retries the exact same idempotent request", async t => {
  const { coordinator, channel } = createHarness(payload => {
    if (channel.pushes.length === 1) return { status: "timeout" };
    return { status: "ok", payload: correlatedResponse(payload) };
  });
  coordinator.configure(capability());

  t.true(await coordinator.reserve("scene.seat-a"));
  t.is(channel.pushes.length, 2);
  t.deepEqual(channel.pushes[0].payload, channel.pushes[1].payload);
});

test("two lost reserve replies trigger a one-shot conditional cleanup", async t => {
  const { coordinator, channel } = createHarness(payload => ({
    status: payload.action === "reserve" ? "timeout" : "error",
    payload: correlatedResponse(payload, { reason: "stale_request", expires_at: null })
  }));
  coordinator.configure(capability());

  t.false(await coordinator.reserve("scene.seat-a"));
  t.is(channel.pushes.length, 3);
  t.deepEqual(channel.pushes[0].payload, channel.pushes[1].payload);
  t.is(channel.pushes[2].payload.action, "release");
  t.is(channel.pushes[2].payload.waypoint_id, channel.pushes[0].payload.waypoint_id);
  t.is(channel.pushes[2].payload.reservation_id, channel.pushes[0].payload.reservation_id);
  t.is(channel.pushes[2].payload.request_seq, channel.pushes[0].payload.request_seq + 1);
});

test("state broadcasts contain no owner requirement and expire locally", t => {
  let now = NOW;
  const stateChanges = [];
  const coordinator = new WaypointReservationCoordinator({
    now: () => now,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
    onStateChange: change => stateChanges.push(change)
  });
  const channel = new FakeChannel(() => ({ status: "error", payload: {} }));
  coordinator.setChannel(channel);
  coordinator.configure(capability());

  channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "scene.seat-a",
    occupied: true,
    state_version: 2,
    expires_at: new Date(NOW + 500).toISOString()
  });
  t.true(coordinator.isReserved("scene.seat-a"));

  now += 501;
  t.false(coordinator.isReserved("scene.seat-a"));
  t.true(stateChanges.some(change => change.type === "state" && change.waypointId === "scene.seat-a"));
});

test("ignores reordered and duplicate state broadcasts by PostgreSQL version", t => {
  const { coordinator, channel } = createHarness(() => ({ status: "error", payload: {} }));
  coordinator.configure(capability());

  channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "scene.seat-a",
    occupied: true,
    state_version: 3,
    expires_at: new Date(NOW + 15_000).toISOString()
  });
  channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "scene.seat-a",
    occupied: false,
    state_version: 2,
    expires_at: null
  });
  channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "scene.seat-a",
    occupied: false,
    state_version: 3,
    expires_at: null
  });

  t.true(coordinator.isReserved("scene.seat-a"));

  channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "scene.seat-a",
    occupied: false,
    state_version: 4,
    expires_at: null
  });
  t.false(coordinator.isReserved("scene.seat-a"));
});

test("an empty snapshot barrier rejects pre-join state for unknown waypoints", t => {
  const { coordinator, channel } = createHarness(() => ({ status: "error", payload: {} }));
  coordinator.configure(capability({ snapshot_state_version: 10 }));

  for (const stateVersion of [9, 10]) {
    channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
      protocol: WAYPOINT_RESERVATION_PROTOCOL,
      waypoint_id: "scene.seat-a",
      occupied: true,
      state_version: stateVersion,
      expires_at: new Date(NOW + 15_000).toISOString()
    });
  }
  t.false(coordinator.isReserved("scene.seat-a"));

  channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "scene.seat-a",
    occupied: true,
    state_version: 11,
    expires_at: new Date(NOW + 15_000).toISOString()
  });
  t.true(coordinator.isReserved("scene.seat-a"));
});

test("a reordered release cannot revoke the current reservation after its reply", async t => {
  const { coordinator, channel, lost } = createHarness(payload => ({
    status: "ok",
    payload: correlatedResponse(payload, { state_version: 7 })
  }));
  coordinator.configure(capability());

  t.true(await coordinator.reserve("scene.seat-a"));
  channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "scene.seat-a",
    occupied: false,
    state_version: 6,
    expires_at: null
  });

  t.is(coordinator.currentWaypointId, "scene.seat-a");
  t.deepEqual(lost, []);
});

test("malformed versioned snapshots fail the capability closed", async t => {
  const { coordinator, channel } = createHarness(() => {
    throw new Error("must not push");
  });
  coordinator.configure(
    capability({
      active: [{ waypoint_id: "scene.seat-a", expires_at: new Date(NOW + 15_000).toISOString() }]
    })
  );

  t.false(coordinator.supported);
  t.false(coordinator.isReserved("scene.seat-a"));
  t.false(await coordinator.reserve("scene.seat-a"));
  t.is(channel.pushes.length, 0);
});

test("malformed supported capability parameters fail closed instead of using defaults", async t => {
  for (const overrides of [
    { lease_ms: 0 },
    { request_timeout_ms: "3000" },
    { request_seq: -1 },
    { snapshot_state_version: null },
    { active: {} },
    { current: [] }
  ]) {
    const { coordinator, channel } = createHarness(() => {
      throw new Error("must not push");
    });
    coordinator.configure(capability(overrides));

    t.false(coordinator.supported);
    t.false(await coordinator.reserve("scene.seat-a"));
    t.is(channel.pushes.length, 0);
  }
});

test("preserves only a live local claim across an identical private snapshot", async t => {
  const old = createHarness(payload => ({ status: "ok", payload: correlatedResponse(payload) }));
  old.coordinator.configure(capability());
  const handle = await old.coordinator.reserveWithHandle("scene.seat-a");
  const previousClaimId = old.coordinator.currentClaimId;
  const current = {
    waypoint_id: handle.waypointId,
    operation_id: old.coordinator.current.operationId,
    reservation_id: handle.reservationId,
    state_version: old.coordinator.current.stateVersion,
    expires_at: new Date(NOW + 15000).toISOString()
  };
  const newChannel = new FakeChannel(() => ({ status: "error", payload: {} }));
  old.coordinator.setChannel(newChannel);
  old.coordinator.configure(
    capability({
      active: [
        { waypoint_id: current.waypoint_id, state_version: current.state_version, expires_at: current.expires_at }
      ],
      current,
      request_seq: 41,
      snapshot_state_version: 41
    })
  );

  t.is(old.coordinator.currentWaypointId, "scene.seat-a");
  t.is(old.coordinator.currentClaimId, previousClaimId);
  t.true(old.coordinator.isReserved("scene.seat-a"));
  t.is(newChannel.pushes.length, 0);
  t.is(old.coordinator.requestSeq, 41);
});

test("releases a private snapshot that has no live local claimant", async t => {
  const harness = createHarness(payload => ({
    status: "ok",
    payload: correlatedResponse(payload, { state_version: 42 })
  }));
  const current = {
    waypoint_id: "scene.seat-a",
    operation_id: "00000000-0000-4000-8000-000000000010",
    reservation_id: "00000000-0000-4000-8000-000000000011",
    state_version: 41,
    expires_at: new Date(NOW + 15000).toISOString()
  };
  harness.coordinator.configure(
    capability({
      active: [{ waypoint_id: current.waypoint_id, state_version: 41, expires_at: current.expires_at }],
      current,
      request_seq: 41,
      snapshot_state_version: 41
    })
  );

  t.is(harness.coordinator.currentWaypointId, null);
  t.true(harness.coordinator.isReserved("scene.seat-a"));
  t.is(harness.timers.length, 0);
  await harness.coordinator.operationChain;
  t.deepEqual(
    harness.channel.pushes.map(push => `${push.payload.action}:${push.payload.reservation_id}`),
    [`release:${current.reservation_id}`]
  );
  t.false(harness.coordinator.isReserved("scene.seat-a"));
});

test("bounds server expiries to the local lease when the wall clock is skewed", t => {
  const ahead = createHarness(() => ({ status: "error", payload: {} }));
  ahead.coordinator.configure(
    capability({
      active: [{ waypoint_id: "seat-a", state_version: 1, expires_at: new Date(NOW - 60_000).toISOString() }]
    })
  );
  t.true(ahead.coordinator.isReserved("seat-a"));
  t.is(ahead.coordinator.active.get("seat-a"), NOW + 15_000);

  const behind = createHarness(() => ({ status: "error", payload: {} }));
  behind.coordinator.configure(
    capability({
      active: [{ waypoint_id: "seat-b", state_version: 1, expires_at: new Date(NOW + 60_000).toISOString() }]
    })
  );
  t.true(behind.coordinator.isReserved("seat-b"));
  t.is(behind.coordinator.active.get("seat-b"), NOW + 15_000);
});

test("an intentional release broadcast is not reported as lease loss", async t => {
  const harness = createHarness(payload => {
    if (payload.action === "release") {
      harness.channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
        protocol: WAYPOINT_RESERVATION_PROTOCOL,
        waypoint_id: payload.waypoint_id,
        occupied: false,
        state_version: payload.request_seq + 1,
        expires_at: null
      });
      return { status: "ok", payload: correlatedResponse(payload, { expires_at: null }) };
    }
    return { status: "ok", payload: correlatedResponse(payload) };
  });
  const { coordinator, lost } = harness;
  coordinator.configure(capability());
  await coordinator.reserve("scene.seat-a");

  t.true(await coordinator.release());
  t.deepEqual(lost, []);
});

test("a release broadcast received before queued Stand is expected completion", async t => {
  const harness = createHarness(payload => ({
    status: "ok",
    payload: correlatedResponse(payload)
  }));
  harness.coordinator.configure(capability());
  const handle = await harness.coordinator.reserveWithHandle("scene.seat-a");

  const release = harness.coordinator.release(handle);
  harness.channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "scene.seat-a",
    occupied: false,
    state_version: 3,
    expires_at: null
  });

  t.true(await release);
  t.is(harness.coordinator.currentWaypointId, null);
  t.deepEqual(harness.lost, []);
  t.deepEqual(
    harness.channel.pushes.map(push => push.payload.action),
    ["reserve"]
  );
});

test("a server release of the current lease reports reservation loss", async t => {
  const { coordinator, channel, lost } = createHarness(payload => ({
    status: "ok",
    payload: correlatedResponse(payload)
  }));
  coordinator.configure(capability());
  await coordinator.reserve("scene.seat-a");

  channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "scene.seat-a",
    occupied: false,
    state_version: 3,
    expires_at: null
  });

  t.is(coordinator.currentWaypointId, null);
  t.deepEqual(lost, [{ waypointId: "scene.seat-a", reason: "reservation_released" }]);
});

test("rejects a successful reply whose correlation fields do not match", async t => {
  const { coordinator } = createHarness(payload => ({
    status: "ok",
    payload: correlatedResponse(payload, { request_seq: payload.request_seq + 1 })
  }));
  coordinator.configure(capability());

  t.false(await coordinator.reserve("scene.seat-a"));
  t.is(coordinator.currentWaypointId, null);
});

test("rejects semantically contradictory successful replies", async t => {
  for (const overrides of [
    { status: "error" },
    { reason: "occupied" },
    { occupied: false },
    { expires_at: null },
    { expires_at: "not-a-date" }
  ]) {
    const { coordinator, channel } = createHarness(payload => ({
      status: "ok",
      payload: correlatedResponse(payload, overrides)
    }));
    coordinator.configure(capability());
    t.false(await coordinator.reserve("scene.seat-a"));
    t.is(coordinator.currentWaypointId, null);
    t.deepEqual(
      channel.pushes.map(push => push.payload.action),
      ["reserve", "release"]
    );
  }

  for (const overrides of [
    { status: "error" },
    { reason: "stale_request" },
    { occupied: true },
    { expires_at: new Date(NOW + 15000).toISOString() }
  ]) {
    const { coordinator, channel } = createHarness(payload => ({
      status: "ok",
      payload: correlatedResponse(payload, payload.action === "release" ? overrides : {})
    }));
    coordinator.configure(capability());
    t.true(await coordinator.reserve("scene.seat-a"));
    t.false(await coordinator.release());
    t.deepEqual(
      channel.pushes.map(push => push.payload.action),
      ["reserve", "release", "release"]
    );
    t.is(channel.pushes[2].payload.reservation_id, channel.pushes[0].payload.reservation_id);
  }
});

test("a contradictory renew success triggers conditional cleanup instead of an orphan", async t => {
  const { coordinator, channel, timers } = createHarness(payload => ({
    status: "ok",
    payload: payload.action === "renew" ? correlatedResponse(payload, { occupied: false }) : correlatedResponse(payload)
  }));
  coordinator.configure(capability());
  t.true(await coordinator.reserve("scene.seat-a"));

  const renewTimer = timers.find(timer => !timer.cleared);
  t.truthy(renewTimer);
  renewTimer.callback();
  await coordinator.operationChain;

  t.is(coordinator.currentWaypointId, null);
  t.deepEqual(
    channel.pushes.map(push => push.payload.action),
    ["reserve", "renew", "release"]
  );
  t.is(channel.pushes[2].payload.reservation_id, channel.pushes[0].payload.reservation_id);
});

test("final lost renew replies trigger a conditional release before lease loss", async t => {
  let now = NOW;
  const { coordinator, channel, timers } = createHarness(
    payload => ({
      status: payload.action === "reserve" ? "ok" : "timeout",
      payload: correlatedResponse(payload)
    }),
    { nowFn: () => now }
  );
  coordinator.configure(capability());
  t.true(await coordinator.reserve("scene.seat-a"));

  now = NOW + 14500;
  const renewTimer = timers.find(timer => !timer.cleared);
  t.truthy(renewTimer);
  renewTimer.callback();
  await coordinator.operationChain;

  t.is(coordinator.currentWaypointId, null);
  t.deepEqual(
    channel.pushes.map(push => push.payload.action),
    ["reserve", "renew", "renew", "release"]
  );
  t.is(channel.pushes[3].payload.reservation_id, channel.pushes[0].payload.reservation_id);
});

test("channel migration cancels an orphaned request and unblocks the operation queue", async t => {
  const { coordinator, channel: oldChannel } = createHarness(() => ({ status: "deferred" }));
  coordinator.configure(capability());

  const oldReserve = coordinator.reserve("stable-seat-a");
  await Promise.resolve();
  t.is(oldChannel.pushes.length, 1);

  const newChannel = new FakeChannel(payload => ({ status: "ok", payload: correlatedResponse(payload) }));
  coordinator.setChannel(newChannel);
  coordinator.configure(capability());

  t.false(await oldReserve);
  t.true(await coordinator.reserve("stable-seat-b"));
  t.is(coordinator.currentWaypointId, "stable-seat-b");
  t.is(newChannel.pushes.length, 1);

  oldChannel.pushHandles[0].emit("ok", correlatedResponse(oldChannel.pushes[0].payload));
  await Promise.resolve();
  t.is(coordinator.currentWaypointId, "stable-seat-b");
});

test("channel migration releases a reserve accepted after its local caller was cancelled", async t => {
  const { coordinator, channel: oldChannel } = createHarness(() => ({ status: "deferred" }));
  coordinator.configure(capability());
  const oldReserve = coordinator.reserve("stable-seat-a");
  await Promise.resolve();
  const reservePayload = oldChannel.pushes[0].payload;

  const newChannel = new FakeChannel(payload => ({
    status: "ok",
    payload: correlatedResponse(payload, { state_version: 4 })
  }));
  coordinator.setChannel(newChannel);
  coordinator.configure(
    capability({
      request_seq: reservePayload.request_seq,
      snapshot_state_version: 3,
      active: [
        {
          waypoint_id: reservePayload.waypoint_id,
          state_version: 2,
          expires_at: new Date(NOW + 15000).toISOString()
        }
      ],
      current: {
        waypoint_id: reservePayload.waypoint_id,
        operation_id: reservePayload.operation_id,
        reservation_id: reservePayload.reservation_id,
        state_version: 2,
        expires_at: new Date(NOW + 15000).toISOString()
      }
    })
  );

  t.false(await oldReserve);
  t.is(coordinator.currentWaypointId, null);
  await coordinator.operationChain;
  t.deepEqual(
    newChannel.pushes.map(push => push.payload.action),
    ["release"]
  );
  t.is(newChannel.pushes[0].payload.reservation_id, reservePayload.reservation_id);
  t.false(coordinator.isReserved("stable-seat-a"));
});

test("release intent recorded before the queue survives channel migration", async t => {
  const harness = createHarness(payload => ({ status: "ok", payload: correlatedResponse(payload) }));
  harness.coordinator.configure(capability());
  const handle = await harness.coordinator.reserveWithHandle("stable-seat-a");
  const current = { ...harness.coordinator.current };

  const oldRelease = harness.coordinator.release(handle);
  const newChannel = new FakeChannel(payload => ({
    status: "ok",
    payload: correlatedResponse(payload, { state_version: 4 })
  }));
  harness.coordinator.setChannel(newChannel);
  harness.coordinator.configure(
    capability({
      request_seq: 1,
      snapshot_state_version: 3,
      active: [
        {
          waypoint_id: current.waypointId,
          state_version: 2,
          expires_at: new Date(NOW + 15000).toISOString()
        }
      ],
      current: {
        waypoint_id: current.waypointId,
        operation_id: current.operationId,
        reservation_id: current.reservationId,
        state_version: 2,
        expires_at: new Date(NOW + 15000).toISOString()
      }
    })
  );

  t.false(await oldRelease);
  t.is(harness.coordinator.currentWaypointId, null);
  await harness.coordinator.operationChain;
  t.deepEqual(
    newChannel.pushes.map(push => push.payload.action),
    ["release"]
  );
  t.is(newChannel.pushes[0].payload.reservation_id, current.reservationId);
  t.false(harness.coordinator.isReserved("stable-seat-a"));
});

test("an occupied broadcast cannot cancel conditional cleanup of an abandoned orphan", async t => {
  const harness = createHarness(payload =>
    payload.action === "renew" ? { status: "deferred" } : { status: "ok", payload: correlatedResponse(payload) }
  );
  harness.coordinator.configure(capability());
  const handle = await harness.coordinator.reserveWithHandle("stable-seat-a");
  const renewTimer = harness.timers.find(timer => !timer.cleared);
  t.truthy(renewTimer);
  renewTimer.callback();
  await Promise.resolve();
  t.is(harness.channel.pushes.at(-1).payload.action, "renew");

  const release = harness.coordinator.release(handle);
  const newChannel = new FakeChannel(payload => ({
    status: "ok",
    payload: correlatedResponse(payload, { state_version: 5 })
  }));
  harness.coordinator.setChannel(newChannel);
  newChannel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "stable-seat-a",
    occupied: true,
    state_version: 4,
    expires_at: new Date(NOW + 15000).toISOString()
  });

  t.false(await release);
  await harness.coordinator.operationChain;
  t.deepEqual(
    newChannel.pushes.map(push => push.payload.action),
    ["release"]
  );
  t.is(newChannel.pushes[0].payload.reservation_id, handle.reservationId);
  t.is(harness.coordinator.abandoningReservationId, null);
});

test("an unsupported reconfiguration invalidates an in-flight success", async t => {
  const { coordinator, channel } = createHarness(() => ({ status: "deferred" }));
  coordinator.configure(capability());

  const reserve = coordinator.reserve("stable-seat-a");
  await Promise.resolve();
  coordinator.configure(capability({ supported: false }));

  t.false(await reserve);
  channel.pushHandles[0].emit("ok", correlatedResponse(channel.pushes[0].payload));
  await Promise.resolve();
  t.is(coordinator.currentWaypointId, null);
  t.false(coordinator.isReserved("stable-seat-a"));
});

test("diagnostic state is an immutable local-only copy", async t => {
  const { coordinator, channel } = createHarness(payload => ({
    status: "ok",
    payload: correlatedResponse(payload)
  }));
  coordinator.configure(capability());
  await coordinator.reserve("seat-a");
  channel.emit(WAYPOINT_RESERVATION_STATE_EVENT, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    waypoint_id: "seat-b",
    occupied: true,
    state_version: 3,
    expires_at: new Date(NOW + 15000).toISOString()
  });

  const state = coordinator.getDiagnosticState();
  t.deepEqual(state, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    supported: true,
    activeWaypointIds: ["seat-a", "seat-b"],
    current: { waypointId: "seat-a", reservationId: coordinator.current.reservationId }
  });
  t.true(Object.isFrozen(state));
  t.true(Object.isFrozen(state.activeWaypointIds));
  t.true(Object.isFrozen(state.current));
  t.not(state.activeWaypointIds, coordinator.activeWaypointIds());
  t.false("operationId" in state.current);
  t.false("claimId" in state.current);
});
