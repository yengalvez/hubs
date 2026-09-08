// IK renders Hubs avatars facing +Z (the camera faces -Z). Classify velocity
// in the *body* frame, not the player container, which can retain another yaw.
export function avatarLocomotionDirection(x, z) {
  if (Math.abs(z) >= Math.abs(x)) return z >= 0 ? "walk" : "walkBack";
  return x > 0 ? "strafeLeft" : "strafeRight";
}
