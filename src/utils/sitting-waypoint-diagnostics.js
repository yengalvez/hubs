import { defineQuery, hasComponent } from "bitecs";
import { Vector3 } from "three";
import { Networked, NetworkedWaypoint, SceneRoot, Waypoint } from "../bit-components";

// Mirrors WaypointFlags in bit-systems/waypoint.ts without importing that
// runtime system (and its mutable movement state) into this read-only bridge.
const WAYPOINT_FLAGS = Object.freeze({
  canBeSpawnPoint: 1 << 0,
  canBeOccupied: 1 << 1,
  canBeClicked: 1 << 2,
  willDisableMotion: 1 << 3,
  willDisableTeleporting: 1 << 4,
  willMaintainInitialOrientation: 1 << 5,
  snapToNavMesh: 1 << 6
});

const waypointQuery = defineQuery([Waypoint]);

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function updateWorldMatrices(object3D) {
  if (typeof object3D.updateMatrices === "function") {
    object3D.updateMatrices();
  } else {
    object3D.updateWorldMatrix(true, false);
  }
}

function worldPosition(object3D) {
  updateWorldMatrices(object3D);
  return object3D.getWorldPosition(new Vector3()).toArray();
}

function bitFlags(flags) {
  return {
    canBeSpawnPoint: !!(flags & WAYPOINT_FLAGS.canBeSpawnPoint),
    canBeOccupied: !!(flags & WAYPOINT_FLAGS.canBeOccupied),
    canBeClicked: !!(flags & WAYPOINT_FLAGS.canBeClicked),
    willDisableMotion: !!(flags & WAYPOINT_FLAGS.willDisableMotion),
    willDisableTeleporting: !!(flags & WAYPOINT_FLAGS.willDisableTeleporting),
    willMaintainInitialOrientation: !!(flags & WAYPOINT_FLAGS.willMaintainInitialOrientation),
    snapToNavMesh: !!(flags & WAYPOINT_FLAGS.snapToNavMesh)
  };
}

function classicFlags(data) {
  return {
    canBeSpawnPoint: data.canBeSpawnPoint === true,
    canBeOccupied: data.canBeOccupied === true,
    canBeClicked: data.canBeClicked === true,
    willDisableMotion: data.willDisableMotion === true,
    willDisableTeleporting: data.willDisableTeleporting === true,
    willMaintainInitialOrientation: data.willMaintainInitialOrientation === true,
    snapToNavMesh: data.snapToNavMesh === true
  };
}

function isInActiveBitScene(world, object3D) {
  let ancestor = object3D;
  while (ancestor) {
    if (
      Number.isSafeInteger(ancestor.eid) &&
      world.eid2obj.get(ancestor.eid) === ancestor &&
      hasComponent(world, SceneRoot, ancestor.eid)
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
}

function comparisonKey(waypoint) {
  return [
    waypoint.reservationId || "",
    waypoint.name,
    waypoint.position.map(value => String(value)).join(","),
    waypoint.occupied ? "1" : "0",
    waypoint.owner || "",
    Object.keys(waypoint.flags)
      .map(key => (waypoint.flags[key] ? "1" : "0"))
      .join("")
  ].join("\u0000");
}

function freezeWaypoints(waypoints) {
  waypoints.sort((a, b) => {
    const aKey = comparisonKey(a);
    const bKey = comparisonKey(b);
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });

  for (const waypoint of waypoints) {
    Object.freeze(waypoint.flags);
    Object.freeze(waypoint.position);
    Object.freeze(waypoint);
  }
  return Object.freeze(waypoints);
}

export function collectClassicWaypointDiagnostics(waypointSystem, getNetworkOwner) {
  if (!Array.isArray(waypointSystem?.ready)) return Object.freeze([]);

  const waypoints = waypointSystem.ready.flatMap(component => {
    const element = component?.el;
    const object3D = element?.object3D;
    const data = component?.data;
    if (!object3D || !data) return [];

    const owner =
      typeof getNetworkOwner === "function" && element.components?.networked
        ? stringOrNull(getNetworkOwner(element))
        : null;

    return [
      {
        name: typeof object3D.name === "string" ? object3D.name : "",
        position: worldPosition(object3D),
        reservationId: stringOrNull(element.components?.networked?.data?.networkId),
        occupied: data.isOccupied === true,
        owner,
        flags: classicFlags(data)
      }
    ];
  });

  return freezeWaypoints(waypoints);
}

export function collectBitECSWaypointDiagnostics(world, getString) {
  if (!world?.eid2obj || typeof getString !== "function") return Object.freeze([]);

  const waypoints = waypointQuery(world).flatMap(eid => {
    const object3D = world.eid2obj.get(eid);
    if (!object3D || !isInActiveBitScene(world, object3D)) return [];

    const isNetworked = hasComponent(world, Networked, eid);
    const isNetworkedWaypoint = hasComponent(world, NetworkedWaypoint, eid);
    return [
      {
        name: typeof object3D.name === "string" ? object3D.name : "",
        position: worldPosition(object3D),
        reservationId: stringOrNull(getString(Waypoint.reservationId[eid])),
        occupied: !!(isNetworkedWaypoint && NetworkedWaypoint.occupied[eid]),
        owner: isNetworked ? stringOrNull(getString(Networked.owner[eid])) : null,
        flags: bitFlags(Waypoint.flags[eid])
      }
    ];
  });

  return freezeWaypoints(waypoints);
}

export function getSittingWaypointDiagnosticsForTests({
  useBitECS,
  world,
  waypointSystem,
  getString,
  getNetworkOwner
}) {
  const loader = useBitECS ? "bitecs" : "classic";
  const waypoints = useBitECS
    ? collectBitECSWaypointDiagnostics(world, getString)
    : collectClassicWaypointDiagnostics(waypointSystem, getNetworkOwner);

  return Object.freeze({ loader, waypoints });
}
