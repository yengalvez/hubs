import { Euler, Matrix4, Quaternion, Vector3 } from "three";

// Upper face of Spoke's bundled spawn-point.glb blue pyramid, in helper metres.
// This is intentionally NOT the bottom of the grey torso (approximately .902m).
export const SPOKE_SEAT_CONTACT = Object.freeze([0, 0.69862, 0]);

// Predict the same body placement as ik-controller, then move the viewpoint,
// not just the local mesh. Other participants receive the corrected viewpoint.
// contact is a calibrated, seated surface point in the avatar's local frame.
export function alignCreatorSeatViewpoint(viewpoint, waypoint, contact, ik, rigWorld, povWorld) {
  // childMatch moves the rig itself. Keep the camera's rig-local transform
  // fixed and predict the NEW rig; using the old rig loses yaw/scale changes.
  const inverseRig = new Matrix4().copy(rigWorld).invert();
  const povInRig = inverseRig.clone().multiply(povWorld);
  const newRig = viewpoint.clone().multiply(povInRig.invert());
  const rootWorld = newRig.multiply(inverseRig.multiply(ik.ikRoot.el.object3D.matrixWorld));
  const forward = ik.ikRoot.camera.object3D.matrix.clone().multiply(new Matrix4().makeRotationY(Math.PI));
  const head = forward.clone().multiply(ik.invMiddleEyeToHead);
  const rotation = new Euler().setFromRotationMatrix(forward, "YXZ");
  rotation.x = rotation.z = 0;
  const predicted = contact
    .clone()
    .multiply(ik.avatar.scale)
    .applyQuaternion(new Quaternion().setFromEuler(rotation))
    .add(new Vector3().setFromMatrixPosition(head))
    .add(ik.invHipsToHeadVector)
    .applyMatrix4(rootWorld);
  const target = new Vector3().fromArray(SPOKE_SEAT_CONTACT).applyMatrix4(waypoint);
  const result = viewpoint.clone();
  result.setPosition(new Vector3().setFromMatrixPosition(viewpoint).add(target.sub(predicted)));
  return result;
}
