import { Quaternion, QuaternionKeyframeTrack, Vector3 } from "three";

// Owner-requested posture adjustment, only used by the Avaturn adapter.
// Retract the clavicles eleven degrees; counter-rotate the upper arms so this
// moves the shoulder sockets back without opening the elbows or twisting palms.
export function retractAvatarShoulders(clip, bind) {
  const result = clip.clone();
  for (const [side, sign] of [
    ["Left", 1],
    ["Right", -1]
  ]) {
    const shoulderBind = bind.get(`${side}Shoulder`);
    const armBind = bind.get(`${side}Arm`);
    if (!shoulderBind || !armBind) continue;
    const shoulderName = `${shoulderBind.nodeName || side + "Shoulder"}.quaternion`;
    const armName = `${armBind.nodeName || side + "Arm"}.quaternion`;
    const si = result.tracks.findIndex(t => t.name === shoulderName);
    const ai = result.tracks.findIndex(t => t.name === armName);
    if (si < 0 || ai < 0) continue;
    const shoulder = result.tracks[si],
      arm = result.tracks[ai];
    const axis = new Vector3(0, 1, 0).applyQuaternion(shoulderBind.parentWorld.clone().invert()).normalize();
    const correction = new Quaternion().setFromAxisAngle(axis, (sign * 11 * Math.PI) / 180);
    const samples = new Set([...shoulder.times, ...arm.times]);
    // The parent/child product must also remain accurate between source keys.
    for (let frame = 0; frame <= Math.ceil(clip.duration * 60); frame++)
      samples.add(Math.min(frame / 60, clip.duration));
    const times = [...samples].sort((a, b) => a - b);
    const shoulderValues = new Float32Array(times.length * 4),
      armValues = new Float32Array(times.length * 4);
    const shoulderAt = shoulder.createInterpolant(),
      armAt = arm.createInterpolant();
    const oldShoulder = new Quaternion(),
      newShoulder = new Quaternion(),
      newArm = new Quaternion();
    const previousShoulder = new Quaternion(),
      previousArm = new Quaternion();
    times.forEach((time, i) => {
      oldShoulder.fromArray(shoulderAt.evaluate(time));
      newShoulder.copy(oldShoulder).premultiply(correction).normalize();
      newArm
        .copy(newShoulder)
        .invert()
        .multiply(oldShoulder)
        .multiply(new Quaternion().fromArray(armAt.evaluate(time)))
        .normalize();
      for (const [q, previous, values] of [
        [newShoulder, previousShoulder, shoulderValues],
        [newArm, previousArm, armValues]
      ]) {
        if (i && q.dot(previous) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        q.toArray(values, i * 4);
        previous.copy(q);
      }
    });
    result.tracks[si] = new QuaternionKeyframeTrack(shoulderName, times, shoulderValues);
    result.tracks[ai] = new QuaternionKeyframeTrack(armName, times, armValues);
  }
  return result;
}
