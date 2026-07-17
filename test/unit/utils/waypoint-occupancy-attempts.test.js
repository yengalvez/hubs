import test from "ava";

import { WaypointOccupancyAttempts } from "../../../src/utils/waypoint-occupancy-attempts";

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
