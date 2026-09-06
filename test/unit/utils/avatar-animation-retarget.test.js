import test from "ava";
import { Object3D, Quaternion, QuaternionKeyframeTrack, Vector3 } from "three";
import {
  alignAvatarArmReference,
  captureAvatarBind,
  retargetQuaternionTrack
} from "../../../src/utils/avatar-animation-retarget";

const rotation = (axis, angle) => new Quaternion().setFromAxisAngle(new Vector3(...axis), angle);
const bind = (parentWorld, local) => ({ parentWorld, world: parentWorld.clone().multiply(local) });
const near = (t, actual, expected) => t.true(actual.angleTo(expected) < 0.001);

test("A-pose arm reference aligns with T-pose without modifying the captured bind", t => {
  const makeArm = angle => {
    const root = new Object3D();
    const arm = new Object3D();
    arm.name = "LeftArm";
    arm.quaternion.copy(rotation([0, 0, 1], angle));
    const forearm = new Object3D();
    forearm.name = "LeftForeArm";
    forearm.position.x = 1;
    const hand = new Object3D();
    hand.name = "LeftHand";
    hand.position.x = 1;
    root.add(arm);
    arm.add(forearm);
    forearm.add(hand);
    return captureAvatarBind(root);
  };
  const source = makeArm(0);
  const target = makeArm(-Math.PI / 4);
  const aligned = alignAvatarArmReference(source, target);
  near(t, aligned.get("LeftArm").world, source.get("LeftArm").world);
  near(t, aligned.get("LeftForeArm").parentWorld, aligned.get("LeftArm").world);
  near(t, target.get("LeftArm").world, rotation([0, 0, 1], -Math.PI / 4));
});

test("animation-only skeletons capture named Object3D transforms without a skin", t => {
  const root = new Object3D();
  root.quaternion.copy(rotation([0, 1, 0], 0.5));
  const shoulder = new Object3D();
  shoulder.name = "mixamorig:RightShoulder";
  shoulder.quaternion.copy(rotation([1, 0, 0], 0.7));
  root.add(shoulder);
  const captured = captureAvatarBind(root).get("RightShoulder");
  t.truthy(captured);
  near(t, captured.world, shoulder.quaternion);
  near(t, captured.parentWorld, new Quaternion());
});

test("different chest bind orientations preserve the target rest pose", t => {
  const sourceLocal = rotation([1, 0, 0], 0.026);
  const targetLocal = rotation([1, 0, 0], 0.762);
  const source = bind(rotation([0, 0, 1], 0.15), sourceLocal);
  const target = bind(rotation([0, 1, 0], -0.2), targetLocal);
  const input = new QuaternionKeyframeTrack("Spine2.quaternion", [0], sourceLocal.toArray());
  const output = retargetQuaternionTrack(input, source, target);
  near(t, new Quaternion().fromArray(output.values), targetLocal);
  t.deepEqual(Array.from(input.values), Array.from(new Float32Array(sourceLocal.toArray())));
});

test("animated parent and child preserve the source world-space rotation delta", t => {
  const source = bind(rotation([0, 0, 1], 0.8), rotation([1, 0, 0], -0.4));
  const target = bind(rotation([0, 1, 0], 0.3), rotation([0, 0, 1], -1.2));
  const sourceParentAnimated = rotation([1, 0, 0], 0.7).multiply(source.parentWorld);
  const sourceLocalAnimated = rotation([0, 1, 0], 0.6);
  const input = new QuaternionKeyframeTrack("LeftFoot.quaternion", [0], sourceLocalAnimated.toArray());
  const local = new Quaternion().fromArray(retargetQuaternionTrack(input, source, target).values);
  const targetParentAnimated = sourceParentAnimated
    .clone()
    .multiply(source.parentWorld.clone().invert())
    .multiply(target.parentWorld);
  const actual = targetParentAnimated.multiply(local);
  const expected = sourceParentAnimated
    .clone()
    .multiply(sourceLocalAnimated)
    .multiply(source.world.clone().invert())
    .multiply(target.world);
  near(t, actual, expected);
});

test("identical bind spaces leave the clip unchanged", t => {
  const rest = bind(rotation([0, 1, 0], 0.2), rotation([1, 0, 0], 0.4));
  const q = rotation([0, 0, 1], 0.7);
  const track = new QuaternionKeyframeTrack("LeftLeg.quaternion", [0, 1], [...q.toArray(), ...q.toArray()]);
  const result = retargetQuaternionTrack(track, rest, rest);
  near(t, new Quaternion().fromArray(result.values), q);
  t.not(result, track);
});
