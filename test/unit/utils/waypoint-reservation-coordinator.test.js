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
    active: [],
    current: null,
    ...overrides
  };
}

function correlatedResponse(payload, overrides = {}) {
  return {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    operation_id: payload.operation_id,
    reservation_id: payload.reservation_id,
    request_seq: payload.request_seq,
    waypoint_id: payload.waypoint_id,
    expires_at: new Date(NOW + 15000).toISOString(),
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

function createHarness(responder) {
  const timers = [];
  const stateChanges = [];
  const lost = [];
  let uuidNumber = 0;
  const coordinator = new WaypointReservationCoordinator({
    uuidFn: () => `00000000-0000-4000-8000-${String(++uuidNumber).padStart(12, "0")}`,
    now: () => NOW,
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
    expires_at: new Date(NOW + 500).toISOString()
  });
  t.true(coordinator.isReserved("scene.seat-a"));

  now += 501;
  t.false(coordinator.isReserved("scene.seat-a"));
  t.true(stateChanges.some(change => change.type === "state" && change.waypointId === "scene.seat-a"));
});

test("restores only the caller's private current reservation after migration", t => {
  const { coordinator, timers } = createHarness(() => ({ status: "error", payload: {} }));
  const current = {
    waypoint_id: "scene.seat-a",
    operation_id: "00000000-0000-4000-8000-000000000010",
    reservation_id: "00000000-0000-4000-8000-000000000011",
    expires_at: new Date(NOW + 15000).toISOString()
  };
  coordinator.configure(
    capability({
      active: [{ waypoint_id: "scene.seat-a", expires_at: current.expires_at }],
      current,
      request_seq: 41
    })
  );

  t.is(coordinator.currentWaypointId, "scene.seat-a");
  t.true(coordinator.isReserved("scene.seat-a"));
  t.is(timers.length, 1);
  t.is(timers[0].delay, 5000);
  t.is(coordinator.requestSeq, 41);
});

test("bounds server expiries to the local lease when the wall clock is skewed", t => {
  const ahead = createHarness(() => ({ status: "error", payload: {} }));
  ahead.coordinator.configure(
    capability({
      active: [{ waypoint_id: "seat-a", expires_at: new Date(NOW - 60_000).toISOString() }]
    })
  );
  t.true(ahead.coordinator.isReserved("seat-a"));
  t.is(ahead.coordinator.active.get("seat-a"), NOW + 15_000);

  const behind = createHarness(() => ({ status: "error", payload: {} }));
  behind.coordinator.configure(
    capability({
      active: [{ waypoint_id: "seat-b", expires_at: new Date(NOW + 60_000).toISOString() }]
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

test("diagnostic state is an immutable local-only copy", t => {
  const { coordinator } = createHarness(() => ({ status: "deferred" }));
  coordinator.configure(
    capability({
      active: [
        { waypoint_id: "seat-b", expires_at: new Date(NOW + 15000).toISOString() },
        { waypoint_id: "seat-a", expires_at: new Date(NOW + 15000).toISOString() }
      ],
      current: {
        waypoint_id: "seat-a",
        operation_id: "operation-a",
        reservation_id: "reservation-a",
        expires_at: new Date(NOW + 15000).toISOString()
      }
    })
  );

  const state = coordinator.getDiagnosticState();
  t.deepEqual(state, {
    protocol: WAYPOINT_RESERVATION_PROTOCOL,
    supported: true,
    activeWaypointIds: ["seat-a", "seat-b"],
    current: { waypointId: "seat-a", reservationId: "reservation-a" }
  });
  t.true(Object.isFrozen(state));
  t.true(Object.isFrozen(state.activeWaypointIds));
  t.true(Object.isFrozen(state.current));
  t.not(state.activeWaypointIds, coordinator.activeWaypointIds());
  t.false("operationId" in state.current);
  t.false("claimId" in state.current);
});
