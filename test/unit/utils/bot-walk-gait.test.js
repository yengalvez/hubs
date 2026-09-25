import test from "ava";
import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from "three";
import {
  BOT_WALK_ARM_SWING_FACTOR,
  BOT_WALK_HIP_MOTION_FACTOR,
  BOT_WALK_SWING_FACTOR,
  BOT_WALK_STRIDE_METERS,
  addBotWalkHipMotion,
  botWalkCycleTimeScale,
  shortenBotWalkStride
} from "../../../src/utils/bot-walk-gait";

const sample = angle => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle).toArray();

test("bot gait independently softens legs and arms without changing the shared clip", t => {
  const idle = new AnimationClip("idle", 1, [
    new QuaternionKeyframeTrack("LeftUpLeg.quaternion", [0], sample(0)),
    new QuaternionKeyframeTrack("LeftArm.quaternion", [0], sample(0))
  ]);
  const walk = new AnimationClip("walk", 1, [
    new QuaternionKeyframeTrack("LeftUpLeg.quaternion", [0, 1], [...sample(0), ...sample(1)]),
    new QuaternionKeyframeTrack("LeftArm.quaternion", [0, 1], [...sample(0), ...sample(1)]),
    new QuaternionKeyframeTrack("LeftHand.quaternion", [0, 1], [...sample(0), ...sample(1)])
  ]);

  const shortened = shortenBotWalkStride(walk, idle);
  const leg = new Quaternion().fromArray(shortened.tracks[0].values, 4);
  const arm = new Quaternion().fromArray(shortened.tracks[1].values, 4);
  const hand = new Quaternion().fromArray(shortened.tracks[2].values, 4);
  const originalLeg = new Quaternion().fromArray(walk.tracks[0].values, 4);
  const originalArm = new Quaternion().fromArray(walk.tracks[1].values, 4);

  t.true(Math.abs(leg.angleTo(new Quaternion()) - BOT_WALK_SWING_FACTOR) < 1e-5);
  t.true(Math.abs(arm.angleTo(new Quaternion()) - BOT_WALK_ARM_SWING_FACTOR) < 1e-5);
  t.true(Math.abs(hand.angleTo(new Quaternion()) - 1) < 1e-5);
  t.true(Math.abs(originalLeg.angleTo(new Quaternion()) - 1) < 1e-5);
  t.true(Math.abs(originalArm.angleTo(new Quaternion()) - 1) < 1e-5);
  t.is(shortened.duration, walk.duration);
});

test("bot walk closes the arm loop without touching the player's source clip", t => {
  const root = new Group();
  const hips = new Bone();
  hips.name = "Hips";
  hips.position.y = 1;
  root.add(hips);
  const times = [0, 0.5, 1];
  const walk = new AnimationClip("walk", 1, [
    new VectorKeyframeTrack("Hips.position", times, [0, 1, 0, 0, 0.98, 0, 0, 1, 0]),
    new QuaternionKeyframeTrack("LeftArm.quaternion", times, [...sample(0), ...sample(0.5), ...sample(0.2)])
  ]);

  const corrected = addBotWalkHipMotion(walk, root);
  const values = corrected.tracks[1].values;
  const first = new Quaternion().fromArray(values, 0);
  const last = new Quaternion().fromArray(values, values.length - 4);

  t.true(first.angleTo(last) < 1e-5);
  t.true(new Quaternion().fromArray(walk.tracks[1].values, 0).angleTo(last) > 0.09);
});

test("bot walk cycle follows travelled distance without a fast minimum at low mobility", t => {
  t.is(BOT_WALK_STRIDE_METERS, 1.1);
  t.is(botWalkCycleTimeScale(0.45, 1), 0.45 / 1.1);
  t.is(botWalkCycleTimeScale(0.75, 1), 0.75 / 1.1);
  t.is(botWalkCycleTimeScale(1.05, 1), 1.05 / 1.1);
  t.is(botWalkCycleTimeScale(0, 1), 0);
  t.is(botWalkCycleTimeScale(NaN, 1), 0);
});

test("bot hip motion keeps the authored rhythm without altering foot rotations or the source clip", t => {
  const root = new Group();
  const hips = new Bone();
  hips.name = "Hips";
  hips.position.set(0.02, 1.1, 0.03);
  root.add(hips);
  const times = [0, 0.25, 0.5, 0.75, 1];
  const walk = new AnimationClip("walk", 1, [
    new VectorKeyframeTrack(
      "Hips.position",
      times,
      [1, 0.96, 1.02, 0.95, 0.99].flatMap(y => [0, y, 0])
    ),
    new QuaternionKeyframeTrack("LeftFoot.quaternion", times, [0, 0.1, 0.2, 0.1, 0].flatMap(sample))
  ]);
  const corrected = addBotWalkHipMotion(walk, root);
  const source = walk.tracks[0].values;
  const values = corrected.tracks[0].values;
  const factor = BOT_WALK_HIP_MOTION_FACTOR * 1.1;

  t.not(corrected, walk);
  t.is(corrected.duration, walk.duration);
  t.true(Math.abs(values[4] - (1.1 - 0.04 * factor)) < 1e-6);
  t.true(Math.abs(values[10] - (1.1 - 0.05 * factor)) < 1e-6);
  t.true(Math.abs(values[1] - values[13]) < 1e-6, "the hip loop closes at the same height");
  t.true(Array.from(values.filter((_, index) => index % 3 === 0)).every(x => Math.abs(x - 0.02) < 1e-6));
  t.deepEqual(Array.from(corrected.tracks[1].values), Array.from(walk.tracks[1].values));
  t.true(Math.abs(source[4] - 0.96) < 1e-6, "the shared clip is unchanged");
  t.is(hips.position.y, 1.1, "the live rig is unchanged");
});

test("bot hip motion leaves an incompatible clip unchanged", t => {
  const walk = new AnimationClip("walk", 1, [new QuaternionKeyframeTrack("LeftFoot.quaternion", [0], sample(0))]);
  t.is(addBotWalkHipMotion(walk, new Group()), walk);
});
