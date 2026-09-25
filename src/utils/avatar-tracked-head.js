import { Matrix4, Quaternion, Vector3 } from "three";

export function createTrackedHeadState() {
  return {
    matrix: new Matrix4(),
    rotation: new Quaternion(),
    parentRotation: new Quaternion(),
    scale: new Vector3(),
    from: new Vector3(),
    to: new Vector3()
  };
}

// A humanoid Head is below an animated pelvis/spine/neck, not directly below
// AvatarRoot. Solve in the real parent space, keeping the camera authoritative.
export function alignTrackedAvatarHead(avatar, head, trackingRoot, headTransform, state, keepPosition = false) {
  trackingRoot.updateMatrixWorld(true);
  state.matrix.multiplyMatrices(trackingRoot.matrixWorld, headTransform);
  if (!keepPosition && avatar.parent) {
    head.getWorldPosition(state.from);
    state.to.setFromMatrixPosition(state.matrix);
    avatar.parent.worldToLocal(state.from);
    avatar.parent.worldToLocal(state.to);
    avatar.position.add(state.to.sub(state.from));
    avatar.matrixNeedsUpdate = true;
    avatar.updateMatrixWorld(true);
  }
  // /grow and /shrink scale the tracking root. A rotation matrix must not
  // contain that scale, otherwise the head quaternion is no longer unit.
  state.matrix.decompose(state.from, state.rotation, state.scale);
  head.parent.getWorldQuaternion(state.parentRotation).invert();
  head.quaternion.copy(state.parentRotation.multiply(state.rotation)).normalize();
  head.matrixNeedsUpdate = true;
}
