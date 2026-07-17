import { defineQuery, entityExists, hasComponent } from "bitecs";
import { Matrix4, Mesh, MeshStandardMaterial, Object3D } from "three";
import { HubsWorld } from "../app";
import {
  HoveredRemoteLeft,
  HoveredRemoteRight,
  Interacted,
  NetworkedWaypoint,
  SceneRoot,
  Waypoint,
  WaypointPreview
} from "../bit-components";
import { CharacterControllerSystem } from "../systems/character-controller-system";
import { anyEntityWith, findAncestorWithComponent } from "../utils/bit-utils";
import { coroutine } from "../utils/coroutine";
import { EntityID } from "../utils/networking-types";
import { takeOwnership } from "../utils/take-ownership";
import { setMatrixWorld } from "../utils/three-utils";
import {
  captureWaypointEntityIdentity,
  isCurrentWaypointEntityIdentity,
  PendingWaypointEntityMoves
} from "../utils/waypoint-entity-identity";

export enum WaypointFlags {
  canBeSpawnPoint = 1 << 0,
  canBeOccupied = 1 << 1,
  canBeClicked = 1 << 2,
  willDisableMotion = 1 << 3,
  willDisableTeleporting = 1 << 4,
  willMaintainInitialOrientation = 1 << 5,
  snapToNavMesh = 1 << 6
}

const waypointQuery = defineQuery([Waypoint]);

let myOccupiedWaypoint = 0;
let myOccupiedWaypointObject: Object3D | null = null;
const pendingWaypointMoves = new PendingWaypointEntityMoves();

export function waypointReservationId(world: HubsWorld, eid: EntityID) {
  if (!entityExists(world, eid) || !hasComponent(world, Waypoint, eid)) return null;
  const waypointId = APP.getString(Waypoint.reservationId[eid]);
  return typeof waypointId === "string" && waypointId.length > 0 ? waypointId : null;
}

function clearLocalOccupiedWaypoint(world: HubsWorld | null = window.APP?.world || null) {
  if (myOccupiedWaypoint) {
    if (!world || world.eid2obj.get(myOccupiedWaypoint) === myOccupiedWaypointObject) {
      NetworkedWaypoint.occupied[myOccupiedWaypoint] = 0;
    }
    myOccupiedWaypoint = 0;
    myOccupiedWaypointObject = null;
  }
}

export function releaseOccupiedWaypoint() {
  clearLocalOccupiedWaypoint();
  return window.APP.hubChannel ? window.APP.hubChannel.releaseWaypointReservation() : Promise.resolve(false);
}

export async function tryOccupyWaypoint(world: HubsWorld, eid: EntityID) {
  if (
    !entityExists(world, eid) ||
    !hasComponent(world, NetworkedWaypoint, eid) ||
    !(Waypoint.flags[eid] & WaypointFlags.canBeOccupied)
  ) {
    return false;
  }

  const waypointId = waypointReservationId(world, eid);
  const hubChannel = window.APP.hubChannel;
  if (!waypointId || !hubChannel) return false;
  const waypointIdentity = captureWaypointEntityIdentity(world, eid, waypointId);
  if (!waypointIdentity) return false;
  if (hubChannel.isWaypointReserved(waypointId) && hubChannel.currentWaypointReservationId !== waypointId) {
    return false;
  }

  const reservation = await hubChannel.reserveWaypoint(waypointId);
  if (!reservation) return false;
  if (
    !entityExists(world, eid) ||
    !hasComponent(world, NetworkedWaypoint, eid) ||
    !isCurrentWaypointEntityIdentity(world, waypointIdentity, waypointReservationId(world, eid))
  ) {
    hubChannel.releaseWaypointReservation(reservation);
    return false;
  }

  clearLocalOccupiedWaypoint(world);
  takeOwnership(world, eid);
  occupyWaypoint(world, eid);
  return true;
}

function occupyWaypoint(world: HubsWorld, eid: EntityID) {
  NetworkedWaypoint.occupied[eid] = 1;
  myOccupiedWaypoint = eid;
  myOccupiedWaypointObject = world.eid2obj.get(eid) || null;
}

function nonOccupiableSpawnPoints(world: HubsWorld) {
  return waypointQuery(world).filter(eid => {
    const canBeSpawnPoint = Waypoint.flags[eid] & WaypointFlags.canBeSpawnPoint;
    const canBeOccupied = Waypoint.flags[eid] & WaypointFlags.canBeOccupied;
    return canBeSpawnPoint && !canBeOccupied && findAncestorWithComponent(world, SceneRoot, eid);
  });
}

function occupiableSpawnPoints(world: HubsWorld) {
  return waypointQuery(world).filter(eid => {
    const canBeSpawnPoint = Waypoint.flags[eid] & WaypointFlags.canBeSpawnPoint;
    const canBeOccupied = Waypoint.flags[eid] & WaypointFlags.canBeOccupied;
    const waypointId = waypointReservationId(world, eid);
    return !!(
      canBeSpawnPoint &&
      canBeOccupied &&
      waypointId &&
      !window.APP.hubChannel?.isWaypointReserved(waypointId) &&
      findAncestorWithComponent(world, SceneRoot, eid)
    );
  });
}

function* tryOccupyAndSpawn(
  world: HubsWorld,
  characterController: CharacterControllerSystem,
  spawnPoint: EntityID
): Generator<Promise<boolean>, boolean, boolean> {
  const identity = captureWaypointEntityIdentity(world, spawnPoint, waypointReservationId(world, spawnPoint));
  if (!identity) return false;
  const didOccupy = yield tryOccupyWaypoint(world, spawnPoint);
  if (!didOccupy) return false;
  if (!isCurrentWaypointEntityIdentity(world, identity, waypointReservationId(world, spawnPoint))) {
    if (myOccupiedWaypointObject === identity.object3D) releaseOccupiedWaypoint();
    return false;
  }
  moveToWaypoint(world, spawnPoint, characterController, true, true);
  return true;
}

function* trySpawnIntoOccupiable(world: HubsWorld, characterController: CharacterControllerSystem) {
  for (let i = 0; i < 3; i++) {
    const spawnPoints = occupiableSpawnPoints(world);
    if (!spawnPoints.length) return false;

    const waypoint = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
    if (yield* tryOccupyAndSpawn(world, characterController, waypoint)) {
      initialSpawnHappened = true;
      return true;
    }
  }

  return false;
}

function* moveToSpawnPointJob(world: HubsWorld, characterController: CharacterControllerSystem) {
  if (yield* trySpawnIntoOccupiable(world, characterController)) return;

  moveToUnoccupiableSpawnPoint(world, characterController);
  initialSpawnHappened = true;
}

let spawnJob: Coroutine | null = null;
export function moveToSpawnPoint(world: HubsWorld, characterController: CharacterControllerSystem) {
  spawnJob = coroutine(moveToSpawnPointJob(world, characterController));
}

export function moveToUnoccupiableSpawnPoint(world: HubsWorld, characterController: CharacterControllerSystem) {
  releaseOccupiedWaypoint();
  const spawnPoints = nonOccupiableSpawnPoints(world);
  if (spawnPoints.length) {
    const waypoint = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
    moveToWaypoint(world, waypoint, characterController, true, true);
    return waypoint;
  }

  console.warn("Could not find an unoccupied spawn point, spawning at the origin.");
  characterController.enqueueWaypointTravelTo(new Matrix4().identity(), true, {
    willDisableMotion: false,
    willDisableTeleporting: false,
    snapToNavMesh: true,
    willMaintainInitialOrientation: false
  });
  return null;
}

function moveToWaypoint(
  world: HubsWorld,
  eid: number,
  characterController: CharacterControllerSystem,
  instant: boolean,
  preserveReservation = false
) {
  if (!preserveReservation) releaseOccupiedWaypoint();
  const obj = world.eid2obj.get(eid)!;
  obj.updateMatrices();

  characterController.enqueueWaypointTravelTo(
    obj.matrixWorld,
    instant || !window.APP.store.state.preferences.animateWaypointTransitions, // TODO: Use store-instance
    {
      willDisableMotion: !!(Waypoint.flags[eid] & WaypointFlags.willDisableMotion),
      willDisableTeleporting: !!(Waypoint.flags[eid] & WaypointFlags.willDisableTeleporting),
      snapToNavMesh: !!(Waypoint.flags[eid] & WaypointFlags.snapToNavMesh),
      willMaintainInitialOrientation: !!(Waypoint.flags[eid] & WaypointFlags.willMaintainInitialOrientation)
    }
  );
}

const hoveredLeftWaypointQuery = defineQuery([Waypoint, HoveredRemoteLeft]);
const hoveredRightWaypointQuery = defineQuery([Waypoint, HoveredRemoteRight]);

// Todo: Find a better place for this system state variables, maybe in a scene component?
let preview: Object3D | null;
let initialSpawnHappened: boolean = false;
let previousWaypointHash: string | null = null;
export function waypointSystem(
  world: HubsWorld,
  characterController: CharacterControllerSystem,
  sceneIsFrozen: boolean
) {
  if (myOccupiedWaypoint) {
    const occupiedWaypointId = waypointReservationId(world, myOccupiedWaypoint);
    const occupiedWaypointIsCurrent =
      world.eid2obj.get(myOccupiedWaypoint) === myOccupiedWaypointObject &&
      occupiedWaypointId &&
      window.APP.hubChannel?.currentWaypointReservationId === occupiedWaypointId;
    if (!occupiedWaypointIsCurrent) {
      clearLocalOccupiedWaypoint(world);
      characterController.setSittingState(false);
      characterController.cancelWaypointTravel();
      moveToUnoccupiableSpawnPoint(world, characterController);
    }
  }

  const beginReservedMove = (eid: EntityID, instant: boolean) => {
    const identity = captureWaypointEntityIdentity(world, eid, waypointReservationId(world, eid));
    if (!pendingWaypointMoves.begin(identity)) return;
    tryOccupyWaypoint(world, eid)
      .then(didOccupy => {
        if (
          didOccupy &&
          entityExists(world, eid) &&
          isCurrentWaypointEntityIdentity(world, identity, waypointReservationId(world, eid))
        ) {
          moveToWaypoint(world, eid, characterController, instant, true);
        }
      })
      .finally(() => pendingWaypointMoves.end(identity));
  };

  // When a scene is opened with a named waypoint we have to make sure that the scene default waypoint
  // doesn't override it and that we correctly spawn in the named waypoint from the url.
  // We use initialSpawnHappened to check if the player has already spawned in the default spawn point.
  // In that case initialSpawnHappened will be set to true and then we can get the hash named point and move to that one,
  // this way we don't override the player position with the default spawn point position.
  // We use previousWaypointHash to make sure that if we have already moved to a named waypoint we don't move again.
  // See https://github.com/Hubs-Foundation/hubs/issues/2833 and https://github.com/Hubs-Foundation/hubs/pull/2837/files#r468103137
  const hashUpdated = window.location.hash !== "" && previousWaypointHash !== window.location.hash;
  const waypointName = window.location.hash.replace("#", "");
  if (hashUpdated && initialSpawnHappened) {
    waypointQuery(world).forEach(eid => {
      const waypointObj = world.eid2obj.get(eid)!;
      if (waypointObj.name === waypointName) {
        if (Waypoint.flags[eid] & WaypointFlags.canBeOccupied) {
          beginReservedMove(eid, previousWaypointHash === null);
        } else {
          moveToWaypoint(world, eid, characterController, previousWaypointHash === null);
        }
        window.history.replaceState(null, "", window.location.href.split("#")[0]); // Reset so you can re-activate the same waypoint
        previousWaypointHash = window.location.hash;
      }
    });
  }

  waypointQuery(world).forEach(eid => {
    if (hasComponent(world, NetworkedWaypoint, eid)) {
      const waypointId = waypointReservationId(world, eid);
      NetworkedWaypoint.occupied[eid] = waypointId && window.APP.hubChannel?.isWaypointReserved(waypointId) ? 1 : 0;
    }

    if (hasComponent(world, Interacted, eid)) {
      if (hasComponent(world, NetworkedWaypoint, eid)) {
        beginReservedMove(eid, false);
      } else {
        moveToWaypoint(world, eid, characterController, false);
      }
    }

    const obj = world.eid2obj.get(eid)!;
    obj.visible = sceneIsFrozen;
    const isOccupied = hasComponent(world, NetworkedWaypoint, eid) && NetworkedWaypoint.occupied[eid];
    if (Waypoint.flags[eid] & WaypointFlags.canBeOccupied && obj.children.length) {
      ((obj.children[0] as Mesh).material as MeshStandardMaterial).color.setHex(isOccupied ? 0xff00aa : 0xffffff);
    }
  });

  const hovered = hoveredRightWaypointQuery(world) || hoveredLeftWaypointQuery(world);
  if (!preview) {
    preview = world.eid2obj.get(anyEntityWith(world, WaypointPreview)!)!;
  }
  preview.visible = !!hovered.length;
  if (hovered.length) {
    const eid = hovered[0];
    const obj = world.eid2obj.get(eid)!;
    obj.updateMatrices();
    setMatrixWorld(preview, obj.matrixWorld);
  }

  if (spawnJob && spawnJob().done) {
    spawnJob = null;
  }
}

// TODO: Implement named waypoints and location.hash navigation

// TODO: Don't use any. Write the correct type
type Coroutine = () => any;
