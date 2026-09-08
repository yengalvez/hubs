import test from "ava";
import { Quaternion, Vector3 } from "three";
import { avatarLocomotionDirection } from "../../../src/utils/avatar-locomotion-direction";

test("four anatomical directions are invariant under body yaw", t => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.73]) {
    const body = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    for (const [x, z, expected] of [
      [0, 1, "walk"],
      [0, -1, "walkBack"],
      [1, 0, "strafeLeft"],
      [-1, 0, "strafeRight"]
    ]) {
      const worldVelocity = new Vector3(x, 0, z).applyQuaternion(body);
      const local = worldVelocity.applyQuaternion(body.clone().invert());
      t.is(avatarLocomotionDirection(local.x, local.z), expected);
    }
  }
});

test("a quarter-turn independent of the player container must not select a strafe for forward", t => {
  const body = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const world = new Vector3(0, 0, 1).applyQuaternion(body);
  // The old container-frame/-Z classifier chose strafeRight for this movement.
  const oldAngle = Math.atan2(world.x, -world.z);
  t.true(oldAngle > Math.PI / 4 && oldAngle < (3 * Math.PI) / 4);
  const local = world.applyQuaternion(body.clone().invert());
  t.is(avatarLocomotionDirection(local.x, local.z), "walk");
});
