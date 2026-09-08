import test from "ava";
import fs from "fs";
import path from "path";
import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { alignCreatorSeatViewpoint, SPOKE_SEAT_CONTACT } from "../../../src/utils/avatar-seat-anchor";

test("seat target is the top face of the actual blue pyramid, not the grey torso", t => {
  const file = path.resolve(__dirname, "../../../src/assets/models/spawn-point.glb");
  const bytes = fs.readFileSync(file);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
  const accessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  const view = json.bufferViews[accessor.bufferView];
  const ys = [];
  for (let i = 0; i < accessor.count; i++) {
    const offset = 28 + length + (view.byteOffset || 0) + (accessor.byteOffset || 0) + i * (view.byteStride || 12);
    ys.push(bytes.readFloatLE(offset + 4));
  }
  t.true(ys.some(y => Math.abs(y - SPOKE_SEAT_CONTACT[1]) < 0.00001));
  t.true(SPOKE_SEAT_CONTACT[1] < 0.7);
});

test("seated contact reaches the marker under yaw, avatar size and parent transforms", t => {
  for (const yaw of [0, Math.PI / 2, (-106.112 * Math.PI) / 180]) {
    for (const size of [0.8, 1, 1.3]) {
      const parent = new Object3D();
      parent.position.set(-2, 0.1, 3);
      parent.rotation.y = 0.3;
      parent.scale.setScalar(1.2);
      parent.updateMatrixWorld(true);
      const avatar = new Object3D();
      avatar.scale.setScalar(size);
      const camera = new Object3D();
      camera.position.set(0, 1.6, 0);
      camera.rotation.y = 0.4;
      parent.add(camera);
      parent.updateMatrixWorld(true);
      const ik = {
        ikRoot: { el: { object3D: parent }, camera: { object3D: camera } },
        avatar,
        invMiddleEyeToHead: new Matrix4().makeTranslation(0, -0.04, -0.03),
        invHipsToHeadVector: new Vector3(-0.002, -1.6, -0.027)
      };
      const waypoint = new Matrix4().compose(
        new Vector3(1.566, -0.406, 0.416),
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
        new Vector3(1.1, 1.1, 1.1)
      );
      const view = waypoint
        .clone()
        .multiply(new Matrix4().makeRotationY(Math.PI))
        .multiply(new Matrix4().makeTranslation(0, 1.6, -0.15));
      const contact = new Vector3(0.004, 0.393, 0.027);
      const before = view.toArray();
      const corrected = alignCreatorSeatViewpoint(view, waypoint, contact, ik, parent.matrixWorld, camera.matrixWorld);
      // Match the camera by moving the parent, as childMatch does in production.
      const destinationRig = corrected.clone().multiply(camera.matrix.clone().invert());
      destinationRig.decompose(parent.position, parent.quaternion, parent.scale);
      const heading = camera.matrix.clone().multiply(new Matrix4().makeRotationY(Math.PI));
      const euler = new Euler().setFromRotationMatrix(heading, "YXZ");
      euler.x = euler.z = 0;
      avatar.quaternion.setFromEuler(euler);
      avatar.position
        .copy(new Vector3().setFromMatrixPosition(heading.multiply(ik.invMiddleEyeToHead)))
        .add(ik.invHipsToHeadVector);
      parent.add(avatar);
      parent.updateMatrixWorld(true);
      const actual = avatar.localToWorld(contact.clone());
      const expected = new Vector3().fromArray(SPOKE_SEAT_CONTACT).applyMatrix4(waypoint);
      t.true(actual.distanceTo(expected) < 1e-10);
      t.true(camera.matrixWorld.elements.every(Number.isFinite));
      t.deepEqual(view.toArray(), before);
    }
  }
});
