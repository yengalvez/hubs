import test from "ava";
import {
  AnimationClip,
  AnimationMixer,
  Group,
  Matrix4,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack
} from "three";
import { captureAvatarBind, isAvaturnAvatar, retargetFullBodyClip } from "../../../src/utils/avatar-animation-retarget";
import { ensureAvatarNodes } from "../../../src/utils/avatar-gltf-normalizer";
import { normalizeCreatorHeight } from "../../../src/utils/avatar-creator-height";
import { alignTrackedAvatarHead, createTrackedHeadState } from "../../../src/utils/avatar-tracked-head";

const q = angle => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle);
const joint = (name, parent, angle = 0) => {
  const n = new Group();
  n.name = name;
  n.quaternion.copy(q(angle));
  n.position.y = 0.2;
  parent.add(n);
  return n;
};

test("Avaturn sizes meshes and joints uniformly to its eye height without rewriting skin data", t => {
  const json = {
    asset: { generator: "Avaturn.me | Blender" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "Armature", children: [1] },
      { name: "Head", translation: [0, 1.65, 0], children: [2, 3] },
      { name: "LeftEye", translation: [0.03, 0.1, 0.08] },
      { name: "RightEye", translation: [-0.03, 0.1, 0.08] }
    ],
    skins: [{ joints: [1, 2, 3], inverseBindMatrices: 0 }]
  };
  const positions = json.nodes.map(n => n.translation),
    skin = JSON.stringify(json.skins);
  normalizeCreatorHeight(json);
  t.deepEqual(json.nodes[0].scale, [1.6 / 1.75, 1.6 / 1.75, 1.6 / 1.75]);
  t.deepEqual(
    json.nodes.map(n => n.translation),
    positions
  );
  t.is(JSON.stringify(json.skins), skin);
  normalizeCreatorHeight(json);
  t.true(Math.abs(json.nodes[0].scale[0] - 1.6 / 1.75) < 1e-10);
});

test("Avaturn provenance survives inflation; RPM and unknown exporters are not opted in", t => {
  const make = generator => ({
    asset: { generator },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "AvatarRoot", children: [1] },
      { name: "Hips", extras: { preserved: 1 } }
    ]
  });
  const avatar = ensureAvatarNodes(make("Avaturn.me | Blender"));
  t.deepEqual(avatar.nodes[1].extras, { preserved: 1, yenhubsAnimationRig: "avaturn" });
  for (const generator of ["Ready Player Me", "Blender", ""]) {
    t.deepEqual(ensureAvatarNodes(make(generator)).nodes[1].extras, { preserved: 1 });
  }
  const root = new Group(),
    wrapper = joint("Hips", root),
    bone = joint("Hips", wrapper);
  t.false(isAvaturnAvatar(root));
  bone.userData = avatar.nodes[1].extras;
  t.true(isAvaturnAvatar(root));
});

test("full-body retarget keeps torso, legs and wrists together without importing root motion or head control", t => {
  const source = new Group(),
    target = new Group();
  const names = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftUpLeg", "LeftHand", "LeftHandIndex1"];
  let s = source,
    a = target;
  names.forEach((name, i) => {
    s = joint(name, s, i * 0.03);
    a = joint(name, a, i * -0.02);
  });
  const sb = captureAvatarBind(source),
    tb = captureAvatarBind(target);
  const raw = new AnimationClip("raw", 1, [
    ...names.map(
      name =>
        new QuaternionKeyframeTrack(`mixamorig:${name}.quaternion`, [0, 1], [...q(0.2).toArray(), ...q(0.3).toArray()])
    ),
    new VectorKeyframeTrack("Hips.position", [0], [99, 99, 99])
  ]);
  const filtered = new AnimationClip("idle", 1, []);
  const output = retargetFullBodyClip(filtered, raw, sb, tb);
  t.deepEqual(
    output.tracks.map(track => track.name),
    names.filter(n => n !== "Head").map(n => `${n}.quaternion`)
  );
  t.is(filtered.tracks.length, 0);
  t.is(raw.tracks.length, 10);
  t.is(raw.tracks[0].name, "mixamorig:Hips.quaternion");
  const mixer = new AnimationMixer(target);
  mixer.clipAction(output).play();
  mixer.setTime(0.5);
  // Source and target have different bind axes: copied raw local angles are not correct.
  t.true(target.getObjectByName("LeftHand").quaternion.angleTo(q(0.25)) > 0.1);
  t.deepEqual(target.getObjectByName("Hips").position.toArray(), [0, 0.2, 0]);
  const sit = new AnimationClip("sit", 1, [new VectorKeyframeTrack("Hips.position", [0], [0, 1, 0])]);
  t.true(retargetFullBodyClip(sit, raw, sb, tb).tracks.some(track => track.name === "Hips.position"));
});

test("tracked head stays aligned through an animated rotated hierarchy without changing bone lengths", t => {
  const tracking = new Group();
  tracking.position.set(4, 0.4, -2);
  tracking.rotation.y = 0.8;
  const avatar = joint("AvatarRoot", tracking),
    spine = joint("Spine", avatar, -0.3);
  const neck = joint("Neck", spine, 0.1),
    head = joint("Head", neck, 0.2);
  avatar.rotation.y = -0.4;
  const wanted = new Matrix4().compose(new Vector3(0.1, 1.6, -0.2), q(0.4), new Vector3(1, 1, 1));
  const state = createTrackedHeadState();
  const localPositions = [spine, neck, head].map(n => n.position.toArray());
  for (const angle of [-0.3, 0.2, -0.1]) {
    spine.quaternion.copy(q(angle));
    alignTrackedAvatarHead(avatar, head, tracking, wanted, state);
    tracking.updateMatrixWorld(true);
    const world = new Matrix4().multiplyMatrices(tracking.matrixWorld, wanted);
    t.true(head.getWorldPosition(new Vector3()).distanceTo(new Vector3().setFromMatrixPosition(world)) < 1e-6);
    t.true(head.getWorldQuaternion(new Quaternion()).angleTo(new Quaternion().setFromRotationMatrix(world)) < 1e-6);
  }
  t.deepEqual(
    [spine, neck, head].map(n => n.position.toArray()),
    localPositions
  );
  const before = avatar.position.clone();
  alignTrackedAvatarHead(avatar, head, tracking, wanted, state);
  t.true(avatar.position.distanceTo(before) < 1e-6);
});

test("seated tracked head does not undo the seat position lock", t => {
  const tracking = new Group(),
    avatar = joint("AvatarRoot", tracking),
    head = joint("Head", avatar);
  const position = avatar.position.clone();
  alignTrackedAvatarHead(
    avatar,
    head,
    tracking,
    new Matrix4().makeTranslation(0, 2, 0),
    createTrackedHeadState(),
    true
  );
  t.deepEqual(avatar.position.toArray(), position.toArray());
});

test("scaled tracking roots preserve head rotation, unit quaternion and bone scale", t => {
  for (const size of [0.5, 1, 2]) {
    const tracking = new Group();
    tracking.scale.setScalar(size);
    tracking.position.set(2, 0.4, -1);
    tracking.rotation.y = 0.7;
    const avatar = joint("AvatarRoot", tracking),
      spine = joint("Spine", avatar, -0.3),
      head = joint("Head", spine, 0.2);
    const wanted = new Matrix4().compose(new Vector3(0.1, 1.6, -0.2), q(0.4), new Vector3(1, 1, 1));
    const state = createTrackedHeadState();
    for (const seated of [false, true, false]) {
      const before = avatar.position.clone();
      alignTrackedAvatarHead(avatar, head, tracking, wanted, state, seated);
      tracking.updateMatrixWorld(true);
      const position = new Vector3(),
        rotation = new Quaternion(),
        scale = new Vector3();
      new Matrix4().multiplyMatrices(tracking.matrixWorld, wanted).decompose(position, rotation, scale);
      t.true(Math.abs(head.quaternion.length() - 1) < 1e-10);
      t.true(head.getWorldQuaternion(new Quaternion()).angleTo(rotation) < 1e-6);
      t.true(head.getWorldScale(new Vector3()).distanceTo(new Vector3(size, size, size)) < 1e-6);
      if (seated) t.true(avatar.position.distanceTo(before) < 1e-6);
      else t.true(head.getWorldPosition(new Vector3()).distanceTo(position) < 1e-6);
    }
  }
});
