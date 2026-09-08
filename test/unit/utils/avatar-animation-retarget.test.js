import test from "ava";
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Group,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3
} from "three";
import {
  alignAvatarArmReference,
  captureAvatarBind,
  isCreatorAvatar,
  restoreCreatorHandTracks,
  retargetAvatarClip,
  retargetQuaternionTrack
} from "../../../src/utils/avatar-animation-retarget";

const rotation = (axis, angle) => new Quaternion().setFromAxisAngle(new Vector3(...axis), angle);
const bind = (parentWorld, local) => ({ parentWorld, world: parentWorld.clone().multiply(local) });
const near = (t, actual, expected) => t.true(actual.angleTo(expected) < 0.001);

test("retargeted fingers bind to the actual namespaced runtime node", t => {
  const source = new Group();
  const sourceFinger = new Bone();
  sourceFinger.name = "LeftHandIndex1";
  source.add(sourceFinger);
  const target = source.clone(true);
  target.children[0].name = "mixamorigLeftHandIndex1";
  const expected = rotation([1, 0, 0], 0.5);
  const clip = new AnimationClip("finger", 1, [
    new QuaternionKeyframeTrack("LeftHandIndex1.quaternion", [0], expected.toArray())
  ]);
  const result = retargetAvatarClip(clip, captureAvatarBind(source), captureAvatarBind(target));
  t.is(result.tracks[0].name, "mixamorigLeftHandIndex1.quaternion");
  const mixer = new AnimationMixer(target);
  mixer.clipAction(result).play();
  mixer.update(0.1);
  near(t, target.children[0].quaternion, expected);
});

test("creator hand tracks restore authored motion without altering legacy clips or adding absent joints", t => {
  const q = [0, 0, 0, 1];
  const tracks = ["mixamorig:LeftHand", "mixamorigRightHand", "LeftHandIndex1", "RightHandPinky3", "Head"].map(
    name => new QuaternionKeyframeTrack(`${name}.quaternion`, [0], q)
  );
  const source = new AnimationClip("source", 1, tracks);
  const legacy = new AnimationClip("legacy", 1, []);
  const target = new Map(["LeftHand", "RightHand", "LeftHandIndex1"].map(name => [name, {}]));
  const result = restoreCreatorHandTracks(legacy, source, target);
  t.deepEqual(
    result.tracks.map(track => track.name),
    ["LeftHand.quaternion", "RightHand.quaternion", "LeftHandIndex1.quaternion"]
  );
  t.is(legacy.tracks.length, 0);
  t.is(source.tracks[0].name, "mixamorig:LeftHand.quaternion");
  t.not(result.tracks[0], source.tracks[0]);
  t.is(restoreCreatorHandTracks(result, source, target).tracks.length, 3);
});

test("inflated Hubs joints keep the first animation target and find original rig extras", t => {
  const root = new Group();
  const hips = new Group();
  hips.name = "Hips";
  hips.quaternion.copy(rotation([1, 0, 0], 0.6));
  hips.position.y = 1;
  const original = new Bone();
  original.name = "Hips";
  original.userData.yenhubsCreatorRig = "makehuman-mixamo-v1";
  root.add(hips);
  hips.add(original);
  const captured = captureAvatarBind(root).get("Hips");
  t.true(isCreatorAvatar(root));
  near(t, captured.world, hips.quaternion);
  near(t, captured.parentWorld, new Quaternion());
  t.not(captured.parentName, "Hips");
  delete original.userData.yenhubsCreatorRig;
  t.false(isCreatorAvatar(root));
});

test("arm reference preserves anatomical clavicle slope", t => {
  const makeShoulder = angle => {
    const root = new Group();
    const shoulder = new Bone();
    shoulder.name = "LeftShoulder";
    shoulder.quaternion.copy(rotation([0, 0, 1], angle));
    const arm = new Bone();
    arm.name = "LeftArm";
    arm.position.x = 1;
    root.add(shoulder);
    shoulder.add(arm);
    return captureAvatarBind(root);
  };
  const source = makeShoulder(0);
  const target = makeShoulder(-0.3);
  const aligned = alignAvatarArmReference(source, target);
  near(t, aligned.get("LeftShoulder").world, target.get("LeftShoulder").world);
  near(t, aligned.get("LeftArm").parentWorld, target.get("LeftShoulder").world);
});

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
    const finger = new Object3D();
    finger.name = "LeftHandIndex1";
    finger.position.x = 0.1;
    hand.add(finger);
    return captureAvatarBind(root);
  };
  const source = makeArm(0);
  const target = makeArm(-Math.PI / 4);
  const aligned = alignAvatarArmReference(source, target);
  near(t, aligned.get("LeftArm").world, source.get("LeftArm").world);
  near(t, aligned.get("LeftForeArm").parentWorld, aligned.get("LeftArm").world);
  near(t, aligned.get("LeftHand").world, source.get("LeftHand").world);
  near(t, aligned.get("LeftHandIndex1").world, source.get("LeftHandIndex1").world);
  near(t, aligned.get("LeftHandIndex1").parentWorld, aligned.get("LeftHand").world);
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
