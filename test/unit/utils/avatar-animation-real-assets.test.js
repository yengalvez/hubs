import test from "ava";
import fs from "fs";
import path from "path";
import {
  AnimationClip,
  AnimationMixer,
  Group,
  Object3D,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack
} from "three";
import { ensureAvatarNodes } from "../../../src/utils/avatar-gltf-normalizer";
import {
  alignAvatarArmReference,
  captureAvatarBind,
  restoreCreatorHandTracks,
  retargetAvatarClip
} from "../../../src/utils/avatar-animation-retarget";
import { compensateOmittedAnimationParents } from "../../../src/utils/avatar-animation-parent-compensation";

const names = ["Left", "Right"].flatMap(side =>
  ["UpLeg", "Leg", "Foot", "ToeBase", "Shoulder", "Arm", "ForeArm"].map(bone => side + bone)
);
const normalize = name => name.replace(/^.*[|:]/, "").replace(/^mixamorig[_-]?/i, "");

function load(file, runtimeNames = false) {
  const bytes = fs.readFileSync(path.resolve(__dirname, "../../../src/assets", file));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
  if (runtimeNames) ensureAvatarNodes(json);
  const binary = 28 + length;
  const nodes = json.nodes.map(node => {
    const object = new Object3D();
    const name = normalize(node.name || "");
    object.name = runtimeNames ? PropertyBinding.sanitizeNodeName(node.name || "") : name;
    if (node.matrix) object.matrix.fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    return object;
  });
  json.nodes.forEach((node, i) => (node.children || []).forEach(child => nodes[i].add(nodes[child])));
  const root = new Group();
  for (const i of json.scenes[json.scene || 0].nodes) root.add(nodes[i]);
  const values = index => {
    const accessor = json.accessors[index];
    const view = json.bufferViews[accessor.bufferView];
    if (accessor.componentType !== 5126 || view.byteStride) throw new Error("Unexpected animation accessor layout");
    const size = accessor.type === "VEC4" ? 4 : 1;
    return new Float32Array(
      bytes.buffer,
      bytes.byteOffset + binary + (view.byteOffset || 0) + (accessor.byteOffset || 0),
      accessor.count * size
    );
  };
  const tracks = (json.animations?.[0]?.channels || [])
    .filter(c => c.target.path === "rotation")
    .map(channel => {
      const sampler = json.animations[0].samplers[channel.sampler];
      return new QuaternionKeyframeTrack(
        `${nodes[channel.target.node].name}.quaternion`,
        values(sampler.input),
        values(sampler.output)
      );
    });
  return { root, clip: new AnimationClip("source", -1, tracks) };
}

for (const body of ["male", "female"]) {
  for (const motion of ["idle", "walk", "walk-backwards", "walk-strafe-left", "walk-strafe-right", "sit"]) {
    test(`${body} ${motion}: filtered limbs preserve the original animated hierarchy`, t => {
      const source = load(`animations/mixamo/${motion}.glb`);
      const model = load(`models/avatar-creator/${body}.glb`, true).root;
      const actual = model.clone(true);
      const sourceBind = captureAvatarBind(source.root);
      const targetBind = alignAvatarArmReference(sourceBind, captureAvatarBind(model));
      const reference = source.clip.clone();
      reference.tracks = reference.tracks.filter(track => targetBind.has(track.name.slice(0, -11)));
      const filtered = source.clip.clone();
      filtered.tracks = filtered.tracks.filter(track => names.includes(track.name.slice(0, -11)));
      const withHands = restoreCreatorHandTracks(filtered, source.clip, targetBind);
      const compensated = compensateOmittedAnimationParents(withHands, source.clip, sourceBind);
      t.deepEqual(
        compensated.tracks.map(track => track.name),
        withHands.tracks.map(track => track.name)
      );
      const fullMixer = new AnimationMixer(model);
      const actualMixer = new AnimationMixer(actual);
      fullMixer.clipAction(retargetAvatarClip(reference, sourceBind, targetBind)).play();
      actualMixer.clipAction(retargetAvatarClip(compensated, sourceBind, targetBind)).play();
      const keys = Array.from(new Set(source.clip.tracks.flatMap(track => Array.from(track.times)))).sort(
        (a, b) => a - b
      );
      const times = keys.flatMap((key, i) =>
        i + 1 === keys.length
          ? [key]
          : [key, ...[0.25, 0.5, 0.75].map(fraction => key + (keys[i + 1] - key) * fraction)]
      );
      let maxAngle = 0;
      for (const time of times) {
        fullMixer.setTime(time);
        actualMixer.setTime(time);
        model.updateMatrixWorld(true);
        actual.updateMatrixWorld(true);
        const handNames = [...targetBind.keys()].filter(name => /^(Left|Right)Hand/.test(name));
        for (const name of [...names, ...handNames]) {
          const nodeName = targetBind.get(name).nodeName;
          const expected = model.getObjectByName(nodeName).getWorldQuaternion(new Quaternion()).normalize();
          const observed = actual.getObjectByName(nodeName).getWorldQuaternion(new Quaternion()).normalize();
          maxAngle = Math.max(maxAngle, observed.angleTo(expected));
        }
      }
      t.true(maxAngle < (0.02 * Math.PI) / 180, `world orientation error ${(maxAngle * 180) / Math.PI} degrees`);
    });
  }
}
