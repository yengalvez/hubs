import { Quaternion, Vector3 } from "three";

export function captureAvatarBind(root) {
  root.updateMatrixWorld(true);
  const inverseRoot = root.getWorldQuaternion(new Quaternion()).invert();
  const bones = new Map();
  root.traverse(node => {
    // Animation-only glTF files have no skin, so GLTFLoader exposes their
    // skeleton nodes as Object3D rather than Bone. Keep named transforms too.
    if (!node.name) return;
    const name = node.name.replace(/^.*[|:]/, "").replace(/^mixamorig[_-]?/i, "");
    const world = node.getWorldQuaternion(new Quaternion()).premultiply(inverseRoot);
    const parentWorld = node.parent
      ? node.parent.getWorldQuaternion(new Quaternion()).premultiply(inverseRoot)
      : new Quaternion();
    const position = node.getWorldPosition(new Vector3()).sub(root.getWorldPosition(new Vector3()));
    position.applyQuaternion(inverseRoot);
    const parentName = node.parent && node.parent.name.replace(/^.*[|:]/, "").replace(/^mixamorig[_-]?/i, "");
    bones.set(name, { world, parentWorld, position, parentName });
  });
  return bones;
}

// Match the reference limb directions as well as the joint axes. Otherwise
// applying a T-pose clip to an A-pose mesh lowers the arms twice.
export function alignAvatarArmReference(sourceBind, targetBind) {
  const aligned = new Map(Array.from(targetBind, ([name, value]) => [name, { ...value, world: value.world.clone() }]));
  for (const side of ["Left", "Right"]) {
    for (const [bone, child] of [
      ["Shoulder", "Arm"],
      ["Arm", "ForeArm"],
      ["ForeArm", "Hand"]
    ]) {
      const name = side + bone;
      const childName = side + child;
      const source = sourceBind.get(name);
      const target = targetBind.get(name);
      const sourceChild = sourceBind.get(childName);
      const targetChild = targetBind.get(childName);
      if (!source?.position || !target?.position || !sourceChild?.position || !targetChild?.position) continue;
      const from = targetChild.position.clone().sub(target.position).normalize();
      const to = sourceChild.position.clone().sub(source.position).normalize();
      aligned.get(name).world.premultiply(new Quaternion().setFromUnitVectors(from, to));
    }
  }
  for (const value of aligned.values()) {
    if (aligned.has(value.parentName)) value.parentWorld = aligned.get(value.parentName).world;
  }
  return aligned;
}

// Rotation tracks contain absolute local orientations, not offsets from bind
// pose. Matching bone names alone therefore cannot retarget different rigs.
// All world rotations passed here must use the same model coordinate frame.
// The source/target parent animation cancels algebraically, leaving these two
// constant bind-space basis changes around each source local quaternion.
export function retargetQuaternionTrack(track, sourceBind, targetBind) {
  if (!track.name.endsWith(".quaternion") || track.getValueSize() !== 4) {
    throw new Error("Expected a quaternion animation track");
  }
  const before = targetBind.parentWorld.clone().invert().multiply(sourceBind.parentWorld);
  const after = sourceBind.world.clone().invert().multiply(targetBind.world);
  const output = track.clone();
  const q = new Quaternion();
  const previous = new Quaternion();
  for (let i = 0; i < output.values.length; i += 4) {
    q.fromArray(track.values, i).premultiply(before).multiply(after).normalize();
    // Keep the same quaternion hemisphere between keys for stable interpolation.
    if (i && q.dot(previous) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    q.toArray(output.values, i);
    previous.copy(q);
  }
  return output;
}

export function retargetAvatarClip(clip, sourceBind, targetBind) {
  const result = clip.clone();
  result.tracks = clip.tracks.map(track => {
    if (!track.name.endsWith(".quaternion")) return track.clone();
    const name = track.name.slice(0, -".quaternion".length);
    if (!sourceBind.has(name) || !targetBind.has(name)) {
      throw new Error(`Missing animation bind bone: ${name}`);
    }
    return retargetQuaternionTrack(track, sourceBind.get(name), targetBind.get(name));
  });
  return result;
}
