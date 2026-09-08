import test from "ava";
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  VectorKeyframeTrack
} from "three";
import { pathToFileURL } from "url";

// AVA's Babel hook runs application files as CJS. Load the real upstream ESM
// clone natively, rather than replacing skin cloning with a test double.
const Module = require("module");
let measureCreatorSeatContact;
test.before(async () => {
  const nativeImport = new Function("url", "return import(url)");
  const skeletonUtils = await nativeImport(
    pathToFileURL(require.resolve("three/examples/jsm/utils/SkeletonUtils.js")).href
  );
  const originalLoad = Module._load;
  try {
    Module._load = function (request, parent, isMain) {
      if (request === "three/examples/jsm/utils/SkeletonUtils.js") return skeletonUtils;
      return originalLoad(request, parent, isMain);
    };
    ({ measureCreatorSeatContact } = require("../../../src/utils/avatar-seat-contact"));
  } finally {
    Module._load = originalLoad;
  }
});

function body() {
  const root = new Group();
  const hips = new Bone();
  hips.name = "Hips";
  hips.position.y = 1;
  hips.userData.yenhubsCreatorRig = "makehuman-mixamo-v1";
  const leg = new Bone();
  leg.name = "LeftUpLeg";
  hips.add(leg);
  root.add(hips);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        -0.1,
        0.9,
        -0.08,
        0.1,
        0.9,
        -0.08,
        0,
        0,
        -0.1, // A foot cannot become the seat-contact minimum.
        0,
        0.8,
        0.15 // An anterior vertex cannot become the posterior support.
      ],
      3
    )
  );
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton([hips, leg]));
  const clip = new AnimationClip("sit", 1, [new VectorKeyframeTrack("Hips.position", [0, 1], [0, 1, 0, 0, 0.6, 0])]);
  return { root, hips, mesh, clip };
}

test("contact is the deformed posterior surface, not Hips, feet or front; live skeleton stays unchanged", t => {
  const { root, hips, mesh, clip } = body();
  const positions = Array.from(mesh.geometry.attributes.position.array);
  const point = measureCreatorSeatContact(root, clip);
  t.truthy(point);
  t.true(Math.abs(point.y - 0.5) < 1e-6);
  t.true(Math.abs(point.z + 0.08) < 1e-6);
  t.true(Math.abs(point.x) < 1e-6);
  t.is(hips.position.y, 1);
  t.deepEqual(Array.from(mesh.geometry.attributes.position.array), positions);
});

test("hidden or unmarked bodies do not receive a guessed contact", t => {
  const { root, hips, mesh, clip } = body();
  mesh.visible = false;
  t.is(measureCreatorSeatContact(root, clip), null);
  mesh.visible = true;
  hips.userData = {};
  t.is(measureCreatorSeatContact(root, clip), null);
});
