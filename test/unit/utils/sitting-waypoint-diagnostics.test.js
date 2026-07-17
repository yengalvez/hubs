import test from "ava";
import { addComponent, addEntity, createWorld } from "bitecs";
import { Object3D } from "three";

import { Networked, NetworkedWaypoint, SceneRoot, Waypoint } from "../../../src/bit-components";
import {
  collectBitECSWaypointDiagnostics,
  collectClassicWaypointDiagnostics,
  getSittingWaypointDiagnosticsForTests
} from "../../../src/utils/sitting-waypoint-diagnostics";

function makeWaypointObject(name, position) {
  const object3D = new Object3D();
  object3D.name = name;
  object3D.position.fromArray(position);
  return object3D;
}

test("classic diagnostics expose a deterministic, immutable public waypoint snapshot", t => {
  const seatObject = makeWaypointObject("Seat B", [2, 1, 3]);
  const standingObject = makeWaypointObject("Standing A", [-1, 0, 0]);
  const seatElement = {
    object3D: seatObject,
    components: { networked: { data: { networkId: "scene.seat-b" } } }
  };
  const standingElement = { object3D: standingObject, components: {} };
  const waypointSystem = {
    ready: [
      {
        el: seatElement,
        data: {
          canBeSpawnPoint: false,
          canBeOccupied: true,
          canBeClicked: true,
          willDisableMotion: true,
          willDisableTeleporting: true,
          willMaintainInitialOrientation: false,
          snapToNavMesh: true,
          isOccupied: true
        }
      },
      {
        el: standingElement,
        data: {
          canBeSpawnPoint: true,
          canBeOccupied: false,
          canBeClicked: false,
          willDisableMotion: false,
          willDisableTeleporting: false,
          willMaintainInitialOrientation: true,
          snapToNavMesh: false,
          isOccupied: false
        }
      }
    ]
  };

  const result = getSittingWaypointDiagnosticsForTests({
    useBitECS: false,
    waypointSystem,
    getNetworkOwner: element => (element === seatElement ? "client-b" : null)
  });

  t.is(result.loader, "classic");
  t.deepEqual(
    result.waypoints.map(waypoint => waypoint.name),
    ["Standing A", "Seat B"]
  );
  t.like(result.waypoints[1], {
    reservationId: "scene.seat-b",
    occupied: true,
    owner: "client-b",
    position: [2, 1, 3],
    flags: {
      canBeOccupied: true,
      canBeClicked: true,
      willDisableMotion: true,
      willDisableTeleporting: true,
      snapToNavMesh: true
    }
  });
  t.true(Object.isFrozen(result));
  t.true(Object.isFrozen(result.waypoints));
  t.true(Object.isFrozen(result.waypoints[1].flags));
  t.deepEqual(
    collectClassicWaypointDiagnostics(waypointSystem, element => (element === seatElement ? "client-b" : null)),
    result.waypoints
  );
});

test("bitECS diagnostics read the active scene components and omit detached waypoints", t => {
  const world = createWorld();
  world.eid2obj = new Map();
  const strings = new Map([
    [1, "scene.seat-a"],
    [2, "client-a"],
    [3, "detached.seat"]
  ]);

  const sceneEid = addEntity(world);
  const seatEid = addEntity(world);
  const detachedEid = addEntity(world);
  addComponent(world, SceneRoot, sceneEid);
  addComponent(world, Waypoint, seatEid);
  addComponent(world, NetworkedWaypoint, seatEid);
  addComponent(world, Networked, seatEid);
  addComponent(world, Waypoint, detachedEid);

  const sceneObject = makeWaypointObject("Scene", [10, 0, 0]);
  const seatObject = makeWaypointObject("Seat A", [0.5, 1, 2]);
  const detachedObject = makeWaypointObject("Detached", [99, 0, 0]);
  sceneObject.eid = sceneEid;
  seatObject.eid = seatEid;
  detachedObject.eid = detachedEid;
  sceneObject.add(seatObject);
  world.eid2obj.set(sceneEid, sceneObject);
  world.eid2obj.set(seatEid, seatObject);
  world.eid2obj.set(detachedEid, detachedObject);

  Waypoint.flags[seatEid] = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 6);
  Waypoint.reservationId[seatEid] = 1;
  NetworkedWaypoint.occupied[seatEid] = 1;
  Networked.owner[seatEid] = 2;
  Waypoint.flags[detachedEid] = 1 << 3;
  Waypoint.reservationId[detachedEid] = 3;

  const waypoints = collectBitECSWaypointDiagnostics(world, sid => strings.get(sid));

  t.is(waypoints.length, 1);
  t.like(waypoints[0], {
    name: "Seat A",
    position: [10.5, 1, 2],
    reservationId: "scene.seat-a",
    occupied: true,
    owner: "client-a",
    flags: {
      canBeSpawnPoint: false,
      canBeOccupied: true,
      canBeClicked: true,
      willDisableMotion: true,
      willDisableTeleporting: false,
      willMaintainInitialOrientation: false,
      snapToNavMesh: true
    }
  });
  t.true(Object.isFrozen(waypoints[0].position));
});

test("bitECS diagnostics reject a waypoint below a stale SceneRoot object", t => {
  const world = createWorld();
  world.eid2obj = new Map();

  const sceneEid = addEntity(world);
  const seatEid = addEntity(world);
  addComponent(world, SceneRoot, sceneEid);
  addComponent(world, Waypoint, seatEid);

  const staleSceneObject = makeWaypointObject("Stale scene", [0, 0, 0]);
  const activeSceneObject = makeWaypointObject("Active scene", [0, 0, 0]);
  const seatObject = makeWaypointObject("Stale seat", [1, 0, 0]);
  staleSceneObject.eid = sceneEid;
  activeSceneObject.eid = sceneEid;
  seatObject.eid = seatEid;
  staleSceneObject.add(seatObject);

  world.eid2obj.set(sceneEid, activeSceneObject);
  world.eid2obj.set(seatEid, seatObject);

  t.deepEqual(
    collectBitECSWaypointDiagnostics(world, () => null),
    []
  );
});
