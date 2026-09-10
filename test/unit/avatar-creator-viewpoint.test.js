import test from "ava";
import { Group, Quaternion, Vector3 } from "three";
import { createCreatorViewpointClassifier, creatorViewpointPosition } from "../../src/utils/avatar-creator-viewpoint";

const markedMesh = () => {
  const mesh = new Group();
  const child = new Group();
  child.userData.yenhubsCreatorRig = "makehuman-mixamo-v1";
  mesh.add(child);
  return mesh;
};

test("only Creator meshes receive the calibrated optical offset, without mutating inputs", t => {
  const classify = createCreatorViewpointClassifier();
  const position = new Vector3(1, 1.6, 3);
  const quaternion = new Quaternion();
  const original = position.clone();
  t.true(
    creatorViewpointPosition(position, quaternion, classify(markedMesh())).distanceTo(new Vector3(1, 1.7, 2.885)) <
      1e-12
  );
  t.deepEqual(creatorViewpointPosition(position, quaternion, classify(new Group())), original);
  t.deepEqual(position, original);
  t.deepEqual(quaternion, new Quaternion());
});

test("camera-local forward and up follow yaw and pitch", t => {
  const origin = new Vector3();
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const pitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
  t.true(creatorViewpointPosition(origin, yaw, true).distanceTo(new Vector3(-0.115, 0.1, 0)) < 1e-12);
  t.true(creatorViewpointPosition(origin, pitch, true).distanceTo(new Vector3(0, 0.115, 0.1)) < 1e-12);
});

test("repeated frames starting from the original POV do not drift", t => {
  const position = new Vector3(0, 1.6, 0);
  const target = new Vector3();
  for (let frame = 0; frame < 100; frame++) {
    creatorViewpointPosition(position, new Quaternion(), true, target);
  }
  t.true(target.distanceTo(new Vector3(0, 1.7, -0.115)) < 1e-12);
  t.deepEqual(position.toArray(), [0, 1.6, 0]);
});

test("classification follows loaded mesh identity across swaps and skips repeated tree scans", t => {
  const classify = createCreatorViewpointClassifier();
  const creator = markedMesh();
  const arbitrary = new Group();
  arbitrary.add(new Group());
  t.false(classify(undefined));
  t.true(classify(creator));
  creator.traverse = () => t.fail("cached mesh must not be traversed again");
  t.true(classify(creator));
  t.false(classify(arbitrary));
  t.true(classify(markedMesh()));
  t.true(classify(creator));
});

test("an empty pre-load root is reconsidered when its model arrives", t => {
  const classify = createCreatorViewpointClassifier();
  const root = new Group();
  t.false(classify(root));
  root.add(markedMesh());
  t.true(classify(root));
});
