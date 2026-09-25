import test from "ava";
import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3 } from "three";
import { retractAvatarShoulders } from "../../../src/utils/avatar-shoulder-posture";

const identity = [0, 0, 0, 1];
const q = (axis, angle) => new Quaternion().setFromAxisAngle(new Vector3(...axis), angle);

test("both shoulder sockets move back without rising or changing arm/hand orientation", t => {
  const tracks = [],
    bind = new Map();
  for (const side of ["Left", "Right"])
    for (const bone of ["Shoulder", "Arm"]) {
      const name = side + bone;
      bind.set(name, { nodeName: name, parentWorld: new Quaternion() });
      tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [...identity, ...identity]));
    }
  const input = new AnimationClip("idle", 1, tracks),
    result = retractAvatarShoulders(input, bind);
  for (const [side, sign] of [
    ["Left", 1],
    ["Right", -1]
  ]) {
    const shoulder = result.tracks.find(t => t.name === `${side}Shoulder.quaternion`);
    const arm = result.tracks.find(t => t.name === `${side}Arm.quaternion`);
    const s = new Quaternion().fromArray(shoulder.values),
      a = new Quaternion().fromArray(arm.values);
    const socket = new Vector3(sign * 0.14, 0, 0).applyQuaternion(s);
    t.true(socket.z < -0.02 && socket.z > -0.03);
    t.true(Math.abs(socket.z + 0.14 * Math.sin((11 * Math.PI) / 180)) < 1e-7);
    t.is(socket.y, 0);
    t.true(s.clone().multiply(a).angleTo(new Quaternion()) < 0.001);
  }
  t.deepEqual(Array.from(input.tracks[0].values), [...identity, ...identity]);
});

test("animated shoulder compensation retains arm orientation between keys and leaves other tracks unchanged", t => {
  const source = new AnimationClip("walk", 1, [
    new QuaternionKeyframeTrack(
      "LeftShoulder.quaternion",
      [0, 0.37, 1],
      [...q([0, 0, 1], 0.2).toArray(), ...q([1, 0, 0], 0.4).toArray(), ...q([0, 0, 1], 0.2).toArray()]
    ),
    new QuaternionKeyframeTrack(
      "LeftArm.quaternion",
      [0, 0.52, 1],
      [...q([0, 1, 0], 0.1).toArray(), ...q([1, 0, 0], 0.5).toArray(), ...q([0, 1, 0], 0.1).toArray()]
    ),
    new QuaternionKeyframeTrack("LeftLeg.quaternion", [0, 1], [...identity, ...identity]),
    new QuaternionKeyframeTrack("LeftHand.quaternion", [0, 1], [...identity, ...identity])
  ]);
  const bind = new Map(
    ["LeftShoulder", "LeftArm"].map(name => [name, { nodeName: name, parentWorld: q([1, 0, 0], 0.2) }])
  );
  const out = retractAvatarShoulders(source, bind);
  const before = source.tracks.slice(0, 2).map(t => t.createInterpolant()),
    after = out.tracks.slice(0, 2).map(t => t.createInterpolant());
  for (let i = 0; i <= 240; i++) {
    const at = i / 240;
    const product = tracks =>
      new Quaternion().fromArray(tracks[0].evaluate(at)).multiply(new Quaternion().fromArray(tracks[1].evaluate(at)));
    t.true(product(before).angleTo(product(after)) < 0.001);
  }
  for (const i of [2, 3]) {
    t.deepEqual(Array.from(out.tracks[i].values), Array.from(source.tracks[i].values));
    t.deepEqual(Array.from(out.tracks[i].times), Array.from(source.tracks[i].times));
  }
});

test("a rig without both shoulder and arm tracks stays unchanged", t => {
  const clip = new AnimationClip("partial", 1, [new QuaternionKeyframeTrack("LeftShoulder.quaternion", [0], identity)]);
  const result = retractAvatarShoulders(clip, new Map());
  t.deepEqual(result.toJSON().tracks, clip.toJSON().tracks);
  t.is(result.name, clip.name);
  t.is(result.duration, clip.duration);
  t.is(result.blendMode, clip.blendMode);
});
