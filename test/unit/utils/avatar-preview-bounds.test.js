import test from "ava";
import {
  Bone,
  Box3,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3
} from "three";
import { fitAvatarPreviewCamera, getAvatarPreviewBounds } from "../../../src/utils/avatar-preview-bounds";

function skinnedLine(bindScale = 1) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 0, 0.018, 0], 3));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0], 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  const bone = new Bone();
  mesh.add(bone);
  mesh.bind(new Skeleton([bone], [new Matrix4().makeScale(bindScale, bindScale, bindScale)]), new Matrix4());
  return { mesh, bone };
}

test("frames displayed skin vertices instead of the smaller bind-space geometry", t => {
  const { mesh } = skinnedLine(100);
  const raw = new Box3().setFromObject(mesh).getSize(new Vector3());
  const displayed = getAvatarPreviewBounds(mesh).getSize(new Vector3());
  t.true(Math.abs(raw.y - 0.018) < 1e-6);
  t.true(Math.abs(displayed.y - 1.8) < 1e-6);
});

test("includes parent transforms and current bone pose", t => {
  const { mesh, bone } = skinnedLine(100);
  const root = new Group();
  root.position.set(3, 4, 5);
  root.scale.setScalar(2);
  root.add(mesh);
  bone.position.y = 1;
  const box = getAvatarPreviewBounds(root);
  t.deepEqual(box.min.toArray(), [3, 6, 5]);
  t.true(Math.abs(box.max.y - 9.6) < 1e-6);
});

test("keeps ordinary meshes and mixed static attachments in the bounds", t => {
  const root = new Group();
  const cube = new Mesh(new BoxGeometry(2, 4, 2), new MeshBasicMaterial());
  cube.position.set(2, 3, 4);
  root.add(cube);
  t.deepEqual(getAvatarPreviewBounds(root), new Box3().setFromObject(root));
  const { mesh } = skinnedLine(100);
  root.add(mesh);
  const box = getAvatarPreviewBounds(root);
  t.deepEqual(box.min.toArray(), [0, 0, 0]);
  t.deepEqual(box.max.toArray(), [3, 5, 5]);
});

for (const relative of [false, true]) {
  test(`applies ${relative ? "relative" : "absolute"} morphs before skinning without changing geometry`, t => {
    const { mesh } = skinnedLine(100);
    const values = relative ? [0, 0.01, 0, 0, 0.01, 0] : [0, 0.01, 0, 0, 0.028, 0];
    mesh.geometry.morphAttributes.position = [new Float32BufferAttribute(values, 3)];
    mesh.geometry.morphTargetsRelative = relative;
    mesh.updateMorphTargets();
    mesh.morphTargetInfluences[0] = 0.5;
    const before = Array.from(mesh.geometry.attributes.position.array);
    const box = getAvatarPreviewBounds(mesh);
    t.true(Math.abs(box.min.y - 0.5) < 1e-6);
    t.true(Math.abs(box.max.y - 2.3) < 1e-6);
    t.deepEqual(Array.from(mesh.geometry.attributes.position.array), before);
  });
}

test("clears reused bounds and ignores non-rendered helpers without geometry", t => {
  const target = new Box3(new Vector3(-10, -10, -10), new Vector3(10, 10, 10));
  const root = new Group();
  root.add(new Bone());
  t.is(getAvatarPreviewBounds(root, target), target);
  t.true(target.isEmpty());
});

for (const aspect of [200 / 450, 720 / 1280]) {
  test(`camera fit includes hands, head and feet at aspect ${aspect}`, t => {
    const box = new Box3(new Vector3(-0.91, 0, -0.17), new Vector3(0.91, 1.87, 0.24));
    const center = new Vector3(0, 1.87 * 0.6, 0.035);
    const camera = new PerspectiveCamera(55, aspect, 0.1, 1000);
    fitAvatarPreviewCamera(camera, box, center, new Euler(-Math.PI / 6, Math.PI / 6, 0));
    camera.updateMatrixWorld(true);
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const projected = new Vector3(x, y, z).project(camera);
          t.true(Math.abs(projected.x) <= 1);
          t.true(Math.abs(projected.y) <= 1);
          t.true(projected.z >= -1 && projected.z <= 1);
        }
      }
    }
  });
}
