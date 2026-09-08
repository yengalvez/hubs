import test from "ava";
import fs from "fs";
import path from "path";
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh
} from "three";
import { fitCreatorJackets } from "../../../src/utils/avatar-creator-garment-fit";
import { normalizeCreatorHeight } from "../../../src/utils/avatar-creator-height";
import { ensureAvatarNodes } from "../../../src/utils/avatar-gltf-normalizer";

test("suit trousers sharing the jacket material are not expanded at the ankles", t => {
  const root = new Group();
  root.userData.yenhubsCreatorRig = "makehuman-mixamo-v1";
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0.1, 0, 0, 0.1, 1, 0], 3));
  const trousers = new Mesh(geometry, new MeshStandardMaterial());
  trousers.name = "Trouserssuit";
  trousers.material.name = "Human.toigo_male_suit_tie_and_jacket";
  root.add(trousers);
  fitCreatorJackets(root);
  t.is(trousers.geometry, geometry);
  t.falsy(geometry.userData.creatorJacketClearance);
});

test("outer hem follows selected trouser skin weights while preserving cache, UV seams and arm vertices", t => {
  const root = new Group();
  root.userData.yenhubsCreatorRig = "makehuman-mixamo-v1";
  const makeBone = name => {
    const bone = new Bone();
    bone.name = name;
    return bone;
  };
  const bottomGeometry = new BufferGeometry();
  bottomGeometry.setAttribute(
    "position",
    new Float32BufferAttribute([0.2, 0.5, -0.3, 0.2, 1.1, -0.3, 0.2, 0.5, 0.3], 3)
  );
  bottomGeometry.setIndex([0, 1, 2]);
  bottomGeometry.setAttribute("skinIndex", new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  bottomGeometry.setAttribute("skinWeight", new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const bottom = new SkinnedMesh(bottomGeometry, new MeshStandardMaterial());
  bottom.name = "Humanmindfront_male_trousers_2";
  bottom.material.name = "Human.mindfront_male_trousers_2";
  bottom.skeleton = new Skeleton([makeBone("Hips"), makeBone("LeftUpLeg")]);
  const original = new BufferGeometry();
  original.setAttribute(
    "position",
    new Float32BufferAttribute([0.21, 0.65, -0.1, 0.21, 0.65, -0.1, 0.21, 1.4, -0.1, 0.21, 0.66, 0], 3)
  );
  original.setAttribute("normal", new Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  original.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  original.setAttribute("skinIndex", new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0], 4));
  original.setAttribute("skinWeight", new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  original.setIndex([0, 2, 3, 1, 2, 3]);
  const top = new SkinnedMesh(original, new MeshStandardMaterial());
  top.name = "Humannamuhekam_male_polo_shirt";
  top.material.name = "Human.namuhekam_male_polo_shirt";
  top.skeleton = new Skeleton([makeBone("LeftUpLeg"), makeBone("Hips"), makeBone("RightArm")]);
  const headlessTop = new SkinnedMesh(original.clone(), top.material);
  headlessTop.name = `${top.name}(headless)`;
  headlessTop.skeleton = top.skeleton;
  const headlessBottom = new SkinnedMesh(bottomGeometry.clone(), bottom.material);
  headlessBottom.name = `${bottom.name}(headless)`;
  headlessBottom.skeleton = bottom.skeleton;
  root.add(top, bottom, headlessTop, headlessBottom);
  const sourcePositions = Array.from(original.attributes.position.array);
  const sourceIndices = Array.from(bottomGeometry.index.array);
  fitCreatorJackets(root);
  t.not(top.geometry, original);
  t.deepEqual(top.geometry.attributes.position.array, headlessTop.geometry.attributes.position.array);
  t.deepEqual(top.geometry.attributes.skinWeight.array, headlessTop.geometry.attributes.skinWeight.array);
  t.deepEqual(Array.from(original.attributes.position.array), sourcePositions);
  t.deepEqual(Array.from(bottomGeometry.index.array), sourceIndices);
  t.falsy(original.userData.creatorHemFit);
  t.true(Math.abs(top.geometry.attributes.position.getX(0) - 0.23) < 1e-6);
  t.is(top.geometry.attributes.skinIndex.getX(0), 0);
  t.is(top.geometry.attributes.skinWeight.getX(0), 1);
  for (const vertex of [2, 3]) {
    t.is(top.geometry.attributes.position.getX(vertex), original.attributes.position.getX(vertex));
    t.is(top.geometry.attributes.skinIndex.getX(vertex), original.attributes.skinIndex.getX(vertex));
  }
  t.deepEqual(top.geometry.attributes.uv.array, original.attributes.uv.array);
  t.deepEqual(
    Array.from(top.geometry.attributes.normal.array.slice(0, 3)),
    Array.from(top.geometry.attributes.normal.array.slice(3, 6))
  );
  t.true(Array.from(top.geometry.attributes.normal.array).every(Number.isFinite));
  const fitted = top.geometry;
  fitCreatorJackets(root);
  t.is(top.geometry, fitted);
});

test("jacket clearance is bounded, preserves seams/skin attributes and is idempotent", t => {
  const root = new Group();
  root.userData.yenhubsCreatorRig = "makehuman-mixamo-v1";
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0.2, 0.7, 0, 0.2, 0.7, 0, 0.2, 1.2, 0, 0.3, 0.7, 0], 3)
  );
  geometry.setAttribute("normal", new Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute("skinIndex", new Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  mesh.material.name = "Human.toigo_male_double-breasted_suit";
  mesh.skeleton = { bones: [{ name: "Hips" }, { name: "LeftForeArm" }] };
  root.add(mesh);
  fitCreatorJackets(root);
  const fitted = mesh.geometry;
  t.not(fitted, geometry);
  t.true(Math.abs(fitted.attributes.position.getX(0) - 0.23) < 1e-6);
  t.is(fitted.attributes.position.getX(2), geometry.attributes.position.getX(2));
  t.is(fitted.attributes.position.getX(3), geometry.attributes.position.getX(3));
  t.deepEqual(
    Array.from(fitted.attributes.normal.array.slice(0, 3)),
    Array.from(fitted.attributes.normal.array.slice(3, 6))
  );
  t.deepEqual(fitted.attributes.skinWeight.array, geometry.attributes.skinWeight.array);
  fitCreatorJackets(root);
  t.is(mesh.geometry, fitted);
  const imported = new Group();
  const untouched = new Mesh(geometry, mesh.material);
  imported.add(untouched);
  fitCreatorJackets(imported);
  t.is(untouched.geometry, geometry);
});

test("cached, local headless and remote jacket copies each receive exactly one identical fit", t => {
  const cached = new BufferGeometry();
  cached.userData.source = "preserved";
  cached.setAttribute("position", new Float32BufferAttribute([0.1, 0.7, -0.1, 0.1, 1.2, -0.1], 3));
  const material = new MeshStandardMaterial();
  material.name = "Human.toigo_male_double-breasted_suit";
  const local = new Group();
  local.userData.yenhubsCreatorRig = "makehuman-mixamo-v1";
  const original = new Mesh(cached, material);
  const headless = new Mesh(cached.clone(), material);
  local.add(original, headless);
  const remote = new Group();
  remote.userData.yenhubsCreatorRig = "makehuman-mixamo-v1";
  const replica = new Mesh(cached, material);
  remote.add(replica);
  const before = Array.from(cached.attributes.position.array);

  fitCreatorJackets(local);
  fitCreatorJackets(remote);
  t.deepEqual(cached.userData, { source: "preserved" });
  t.deepEqual(Array.from(cached.attributes.position.array), before);
  const expected = Array.from(original.geometry.attributes.position.array);
  t.notDeepEqual(expected, before);
  for (const mesh of [original, headless, replica]) {
    t.deepEqual(Array.from(mesh.geometry.attributes.position.array), expected);
    t.is(mesh.geometry.userData.creatorJacketClearance, 1);
    t.not(mesh.geometry.userData, cached.userData);
  }
  fitCreatorJackets(local);
  fitCreatorJackets(remote);
  t.deepEqual(Array.from(original.geometry.attributes.position.array), expected);
  t.deepEqual(Array.from(headless.geometry.attributes.position.array), expected);
  t.deepEqual(Array.from(replica.geometry.attributes.position.array), expected);
});

test("creator height aligns the head with Hubs' floor viewpoint without cumulative scaling", t => {
  const json = {
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "Root", children: [1] },
      { name: "Head", translation: [0, 1.25, 0], extras: { yenhubsCreatorRig: "makehuman-mixamo-v1" } }
    ]
  };
  normalizeCreatorHeight(json);
  t.deepEqual(json.nodes[0].scale, [1.28, 1.28, 1.28]);
  normalizeCreatorHeight(json);
  t.deepEqual(json.nodes[0].scale, [1.28, 1.28, 1.28]);
  delete json.nodes[1].extras;
  json.nodes[0].scale = [1, 1, 1];
  normalizeCreatorHeight(json);
  t.deepEqual(json.nodes[0].scale, [1, 1, 1]);
});

for (const sex of ["male", "female"]) {
  test(`${sex}: real creator template is normalized once, without altering skin inverse binds`, t => {
    const bytes = fs.readFileSync(path.resolve(__dirname, `../../../src/assets/models/avatar-creator/${sex}.glb`));
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    json.nodes.find(n => n.name === "mixamorig:Hips" || n.name === "Hips").extras = {
      yenhubsCreatorRig: "makehuman-mixamo-v1"
    };
    const skins = JSON.stringify(json.skins);
    const originalRoot = json.scenes[0].nodes[0];
    ensureAvatarNodes(json);
    const scale = [...json.nodes[originalRoot].scale];
    t.true(scale[0] > 1 && scale[0] < 1.5);
    t.is(JSON.stringify(json.skins), skins);
    ensureAvatarNodes(json);
    t.deepEqual(json.nodes[originalRoot].scale, scale);
  });
}
