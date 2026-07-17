export function captureWaypointEntityIdentity(world, eid, waypointId) {
  if (!world || !world.eid2obj || typeof waypointId !== "string" || waypointId.length === 0) return null;
  const object3D = world.eid2obj.get(eid);
  return object3D ? { eid, object3D, waypointId } : null;
}

export function isCurrentWaypointEntityIdentity(world, identity, waypointId) {
  return !!(
    world &&
    identity &&
    world.eid2obj &&
    world.eid2obj.get(identity.eid) === identity.object3D &&
    waypointId === identity.waypointId
  );
}

export class PendingWaypointEntityMoves {
  constructor() {
    this.pendingObjects = new Set();
  }

  begin(identity) {
    if (!identity || this.pendingObjects.has(identity.object3D)) return false;
    this.pendingObjects.add(identity.object3D);
    return true;
  }

  end(identity) {
    if (identity) this.pendingObjects.delete(identity.object3D);
  }

  has(identity) {
    return !!identity && this.pendingObjects.has(identity.object3D);
  }
}
