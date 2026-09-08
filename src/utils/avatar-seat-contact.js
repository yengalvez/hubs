import { AnimationMixer, LoopOnce, Matrix4, Vector3 } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { isCreatorAvatar } from "./avatar-animation-retarget";

// Measure the posterior pelvis surface on a disposable skeleton, never the live
// skeleton or the Hips joint. Feet and long garments are not seat-contact probes.
// Missing surface data deliberately returns null instead of a guessed offset.
export function measureCreatorSeatContact(root, clip) {
  if (!isCreatorAvatar(root)) return null;
  const copy = clone(root);
  const probes = [];
  copy.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    for (let parent = mesh.parent; parent && parent !== copy; parent = parent.parent) {
      if (!parent.visible) return;
    }
    const position = mesh.geometry.attributes.position;
    const indices = mesh.geometry.attributes.skinIndex;
    const weights = mesh.geometry.attributes.skinWeight;
    if (!position || !indices || !weights) return;
    const hipsIndex = mesh.skeleton.bones.findIndex(b => /^(?:mixamorig:)?Hips$/.test(b.name));
    if (hipsIndex < 0) return;
    const pelvis = new Vector3().setFromMatrixPosition(
      new Matrix4().copy(mesh.skeleton.boneInverses[hipsIndex]).invert()
    );
    for (let i = 0; i < position.count; i++) {
      let hipWeight = 0;
      let pelvisWeight = 0;
      for (let k = 0; k < 4; k++) {
        const joint = indices.array[i * 4 + k];
        const weight = weights.array[i * 4 + k];
        if (joint === hipsIndex) hipWeight += weight;
        if (/^(?:mixamorig:)?(?:Hips|LeftUpLeg|RightUpLeg)$/.test(mesh.skeleton.bones[joint]?.name || "")) {
          pelvisWeight += weight;
        }
      }
      if (hipWeight < 0.25 || pelvisWeight < 0.9) continue;
      const rest = new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
      if (rest.y >= pelvis.y || rest.z >= pelvis.z) continue;
      probes.push({ mesh, index: i });
    }
  });
  if (!probes.length) return null;
  const mixer = new AnimationMixer(copy);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.update(clip.duration);
  copy.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(copy.matrixWorld).invert();
  const points = probes.map(({ mesh, index }) => {
    const point = new Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index);
    mesh.boneTransform(index, point);
    return point.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
  });
  const lowest = Math.min(...points.map(p => p.y));
  // Average the contact patch, not one asymmetric vertex. 2mm is sampling
  // tolerance in model space, not a placement correction or chair height.
  const patch = points.filter(p => p.y <= lowest + 0.002);
  const contact = patch.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(patch.length);
  mixer.stopAllAction();
  mixer.uncacheRoot(copy);
  return contact.toArray().every(Number.isFinite) ? contact : null;
}
