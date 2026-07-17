import test from "ava";

import {
  WaypointMoveIntentTracker,
  WaypointOccupancyAttempts,
  WaypointSpawnJobRunner
} from "../../../src/utils/waypoint-occupancy-attempts";

test("a stale spawn retry cannot supersede a newer user movement intent", t => {
  const intents = new WaypointMoveIntentTracker();
  const spawnIntent = intents.begin();
  const userIntent = intents.begin();

  t.false(intents.isCurrent(spawnIntent));
  t.true(intents.isCurrent(userIntent));

  // Cleanup from the stale async branch must not invalidate the newer intent.
  intents.cancel(spawnIntent);
  t.true(intents.isCurrent(userIntent));
});

test("a newer spawn job does not drop an older job before its cleanup step runs", t => {
  const jobs = new WaypointSpawnJobRunner();
  let staleJobTicks = 0;
  let currentJobTicks = 0;

  jobs.add(() => ({ done: ++staleJobTicks === 2 }));
  jobs.tick();
  t.is(jobs.size, 1);

  jobs.add(() => ({ done: ++currentJobTicks === 1 }));
  jobs.tick();

  t.is(staleJobTicks, 2);
  t.is(currentJobTicks, 1);
  t.is(jobs.size, 0);
});

test("a later non-occupiable move wins in either reservation completion order", t => {
  const completionOrders = [
    ["reserve", "teleport"],
    ["teleport", "reserve"]
  ];

  for (const order of completionOrders) {
    const intents = new WaypointMoveIntentTracker();
    const seatIntent = intents.begin();
    const movements = [];

    for (const event of order) {
      if (event === "reserve") {
        if (intents.isCurrent(seatIntent)) movements.push("seat");
      } else {
        intents.cancel();
        movements.push("teleport");
      }
    }

    t.is(movements[movements.length - 1], "teleport");
    t.false(intents.isCurrent(seatIntent));
  }
});

test("an older completion cannot clear a newer attempt for the same waypoint", t => {
  const attempts = new WaypointOccupancyAttempts();
  const waypoint = { id: "seat-a" };
  const older = attempts.begin(waypoint);
  const newer = attempts.begin(waypoint);

  t.false(attempts.isCurrent(older));
  t.true(attempts.isCurrent(newer));

  attempts.clear(older);

  t.true(attempts.isCurrent(newer));
  t.true(attempts.isPending(waypoint));

  attempts.clear(newer);
  t.false(attempts.isPending(waypoint));
});

test("cancelling invalidates the current attempt", t => {
  const attempts = new WaypointOccupancyAttempts();
  const attempt = attempts.begin({ id: "seat-a" });

  attempts.cancel();

  t.false(attempts.isCurrent(attempt));
});
