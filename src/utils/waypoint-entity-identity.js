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
    this.pendingObjects = new Map();
  }

  begin(identity, intent) {
    if (!identity) return false;
    const pending = this.pendingObjects.get(identity.object3D);
    if (pending && (!intent || pending.intent === intent)) return false;
    this.pendingObjects.set(identity.object3D, { identity, intent });
    return true;
  }

  end(identity, intent) {
    const pending = identity && this.pendingObjects.get(identity.object3D);
    if (pending && pending.identity === identity && pending.intent === intent) {
      this.pendingObjects.delete(identity.object3D);
    }
  }

  has(identity) {
    const pending = identity && this.pendingObjects.get(identity.object3D);
    return !!pending && pending.identity === identity;
  }

  intentFor(identity) {
    const pending = identity && this.pendingObjects.get(identity.object3D);
    return pending ? pending.intent : null;
  }

  cancel() {
    this.pendingObjects.clear();
  }
}
