import test from "ava";
import fs from "fs";
import path from "path";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from "three";
import { fitCreatorJackets } from "../../../src/utils/avatar-creator-garment-fit";
import { normalizeCreatorHeight } from "../../../src/utils/avatar-creator-height";
import { ensureAvatarNodes } from "../../../src/utils/avatar-gltf-normalizer";

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
