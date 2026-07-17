import test from "ava";

import {
  captureWaypointEntityIdentity,
  isCurrentWaypointEntityIdentity,
  PendingWaypointEntityMoves
} from "../../../src/utils/waypoint-entity-identity";

test("rejects a recycled EID even when the replacement has the same network id", t => {
  const oldObject = { name: "old waypoint" };
  const replacementObject = { name: "replacement waypoint" };
  const world = { eid2obj: new Map([[7, oldObject]]) };
  const identity = captureWaypointEntityIdentity(world, 7, "scene.seat-a");

  t.true(isCurrentWaypointEntityIdentity(world, identity, "scene.seat-a"));

  world.eid2obj.delete(7);
  t.false(isCurrentWaypointEntityIdentity(world, identity, "scene.seat-a"));

  world.eid2obj.set(7, replacementObject);

  t.false(isCurrentWaypointEntityIdentity(world, identity, "scene.seat-a"));
});

test("cleanup of an old object cannot remove the pending move for its EID replacement", t => {
  const oldObject = { name: "old waypoint" };
  const replacementObject = { name: "replacement waypoint" };
  const world = { eid2obj: new Map([[7, oldObject]]) };
  const oldIdentity = captureWaypointEntityIdentity(world, 7, "scene.seat-a");
  const pending = new PendingWaypointEntityMoves();

  t.true(pending.begin(oldIdentity));
  t.false(pending.begin(oldIdentity));

  world.eid2obj.set(7, replacementObject);
  const replacementIdentity = captureWaypointEntityIdentity(world, 7, "scene.seat-a");
  t.true(pending.begin(replacementIdentity));

  pending.end(oldIdentity);
  t.false(pending.has(oldIdentity));
  t.true(pending.has(replacementIdentity));

  pending.end(replacementIdentity);
  t.false(pending.has(replacementIdentity));
});

test("cancelling a pending move lets a newer move on the same object survive stale cleanup", t => {
  const object3D = { name: "seat waypoint" };
  const world = { eid2obj: new Map([[7, object3D]]) };
  const staleIdentity = captureWaypointEntityIdentity(world, 7, "scene.seat-a");
  const pending = new PendingWaypointEntityMoves();

  t.true(pending.begin(staleIdentity));
  pending.cancel();

  const currentIdentity = captureWaypointEntityIdentity(world, 7, "scene.seat-a");
  t.true(pending.begin(currentIdentity));

  pending.end(staleIdentity);
  t.true(pending.has(currentIdentity));
});

test("a newer intent can replace a stale pending move on the same object", t => {
  const object3D = { name: "seat waypoint" };
  const world = { eid2obj: new Map([[7, object3D]]) };
  const staleIdentity = captureWaypointEntityIdentity(world, 7, "scene.seat-a");
  const staleIntent = { sequence: 1 };
  const currentIntent = { sequence: 3 };
  const pending = new PendingWaypointEntityMoves();

  t.true(pending.begin(staleIdentity, staleIntent));

  const currentIdentity = captureWaypointEntityIdentity(world, 7, "scene.seat-a");
  t.true(pending.begin(currentIdentity, currentIntent));
  t.is(pending.intentFor(currentIdentity), currentIntent);

  pending.end(staleIdentity, staleIntent);
  t.true(pending.has(currentIdentity));
});
