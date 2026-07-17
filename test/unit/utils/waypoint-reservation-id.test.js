import test from "ava";

import { stableWaypointReservationId } from "../../../src/utils/waypoint-reservation-id";

test("uses the Spoke networked id as the loader-independent reservation identity", t => {
  const components = {
    networked: { id: "e76a53f0-7b69-4c83-b40e-36d56849e6ad" },
    waypoint: { canBeOccupied: true }
  };

  t.is(stableWaypointReservationId(components), components.networked.id);
  t.is(stableWaypointReservationId({ waypoint: { canBeOccupied: true } }), null);
  t.is(stableWaypointReservationId({ networked: { id: "" } }), null);
});
