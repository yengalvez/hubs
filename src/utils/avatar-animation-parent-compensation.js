import { Quaternion, QuaternionKeyframeTrack } from "three";

const normalized = name => name.replace(/^.*[|:]/, "").replace(/^mixamorig[_-]?/i, "");

// A local limb rotation depends on its animated ancestors. When IK owns those
// ancestors, preserve their rotational contribution in the first retained joint
// instead of dropping it or animating the torso a second time.
export function compensateOmittedAnimationParents(filtered, source, bind) {
  const retained = new Set(filtered.tracks.filter(t => t.name.endsWith(".quaternion")).map(t => t.name.slice(0, -11)));
  const sourceTracks = new Map();
  for (const track of source.tracks) {
    if (track.name.endsWith(".quaternion")) sourceTracks.set(normalized(track.name.slice(0, -11)), track);
  }
  const result = filtered.clone();
  result.tracks = filtered.tracks.map(track => {
    if (!track.name.endsWith(".quaternion")) return track.clone();
    const name = track.name.slice(0, -11);
    const joint = bind.get(name);
    if (!joint) throw new Error(`Missing animation bind bone: ${name}`);
    const chain = [];
    let parent = joint.parentName;
    while (bind.has(parent) && !retained.has(parent)) {
      chain.unshift(parent);
      parent = bind.get(parent).parentName;
    }
    if (!chain.some(n => sourceTracks.has(n))) return track.clone();

    const samples = new Set(track.times);
    for (const n of chain) for (const time of sourceTracks.get(n)?.times || []) samples.add(time);
    // Products of interpolated rotations are not exactly a single SLERP.
    // Sample also at 60 Hz to bound error between original keys.
    for (let frame = 0; frame <= Math.ceil(filtered.duration * 60); frame++) {
      samples.add(Math.min(frame / 60, filtered.duration));
    }
    const times = Array.from(samples).sort((a, b) => a - b);
    const values = new Float32Array(times.length * 4);
    const interpolants = chain.map(n => sourceTracks.get(n)?.createInterpolant());
    const localBinds = chain.map(n => bind.get(n).parentWorld.clone().invert().multiply(bind.get(n).world));
    const localTrack = track.createInterpolant();
    const boundaryBind = bind.get(parent)?.world || new Quaternion();
    const inverseParentBind = joint.parentWorld.clone().invert();
    const world = new Quaternion();
    const q = new Quaternion();
    const previous = new Quaternion();
    times.forEach((time, index) => {
      world.copy(boundaryBind);
      chain.forEach((n, i) => {
        q.copy(localBinds[i]);
        if (interpolants[i]) q.fromArray(interpolants[i].evaluate(time));
        world.multiply(q);
      });
      q.fromArray(localTrack.evaluate(time));
      world.multiply(q).premultiply(inverseParentBind).normalize();
      if (index && world.dot(previous) < 0) world.set(-world.x, -world.y, -world.z, -world.w);
      world.toArray(values, index * 4);
      previous.copy(world);
    });
    return new QuaternionKeyframeTrack(track.name, times, values);
  });
  return result;
}
