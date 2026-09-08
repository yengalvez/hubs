import test from "ava";
import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3 } from "three";
import { captureAvatarBind } from "../../../src/utils/avatar-animation-retarget";
import { compensateOmittedAnimationParents } from "../../../src/utils/avatar-animation-parent-compensation";

const rotation = (axis, angle) => new Quaternion().setFromAxisAngle(new Vector3(...axis), angle);
const track = (name, start, end) => new QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [...start, ...end]);

test("omitted animated hip and spine rotations survive at the retained limb boundary", t => {
  const root = new Group();
  const hips = new Bone();
  const spine = new Bone();
  const arm = new Bone();
  hips.name = "Hips";
  spine.name = "Spine";
  arm.name = "LeftShoulder";
  root.add(hips);
  hips.add(spine);
  spine.add(arm);
  const bind = captureAvatarBind(root);
  const hipRotation = rotation([0, 1, 0], 0.7);
  const spineRotation = rotation([1, 0, 0], 0.3);
  const identity = [0, 0, 0, 1];
  const source = new AnimationClip("source", 1, [
    track("mixamorig:Hips", identity, hipRotation.toArray()),
    track("mixamorigSpine", identity, spineRotation.toArray()),
    track("LeftShoulder", identity, identity)
  ]);
  const filtered = new AnimationClip("filtered", 1, [source.tracks[2]]);
  const result = compensateOmittedAnimationParents(filtered, source, bind);
  t.deepEqual(
    result.tracks.map(x => x.name),
    ["LeftShoulder.quaternion"]
  );
  const interpolant = result.tracks[0].createInterpolant();
  for (const time of [0, 0.25, 0.5, 0.75, 1]) {
    const expected = new Quaternion().slerp(hipRotation, time).multiply(new Quaternion().slerp(spineRotation, time));
    t.true(new Quaternion().fromArray(interpolant.evaluate(time)).angleTo(expected) < 0.001);
  }
  t.deepEqual(Array.from(filtered.tracks[0].values), [...identity, ...identity]);
});

test("retaining the parent does not apply its animation twice", t => {
  const root = new Group();
  const hips = new Bone();
  const leg = new Bone();
  hips.name = "Hips";
  leg.name = "LeftUpLeg";
  root.add(hips);
  hips.add(leg);
  const identity = [0, 0, 0, 1];
  const source = new AnimationClip("sit", 1, [
    track("Hips", identity, rotation([0, 1, 0], 0.6).toArray()),
    track("LeftUpLeg", identity, rotation([1, 0, 0], -1).toArray())
  ]);
  const result = compensateOmittedAnimationParents(source, source, captureAvatarBind(root));
  result.tracks.forEach((value, i) => t.deepEqual(Array.from(value.values), Array.from(source.tracks[i].values)));
});
