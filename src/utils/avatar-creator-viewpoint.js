import { Vector3 } from "three";
import { isCreatorAvatar } from "./avatar-animation-retarget";

// Optical offset from Head, calibrated against the bundled male/female actual
// eye geometry after height normalization. Camera forward is -Z (model +Z).
// This changes only the desktop viewing camera, never the tracked POV or rig.
const opticalOffset = new Vector3(0, 0.1, -0.115);

export function creatorViewpointPosition(position, quaternion, creator, target = new Vector3()) {
  if (!creator) return target.copy(position);
  return target.copy(opticalOffset).applyQuaternion(quaternion).add(position);
}

export function createCreatorViewpointClassifier() {
  const loadedMeshes = new WeakMap();
  return mesh => {
    if (!mesh) return false;
    if (loadedMeshes.has(mesh)) return loadedMeshes.get(mesh);
    const creator = isCreatorAvatar(mesh);
    // An empty pre-load root can later receive its marked hierarchy.
    if (creator || mesh.children.length) loadedMeshes.set(mesh, creator);
    return creator;
  };
}
