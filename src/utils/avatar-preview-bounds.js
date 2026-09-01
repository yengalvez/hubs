import { Box3, Vector3 } from "three";

// Three r141's Box3.setFromObject measures undeformed positions, which can be
// in a different bind-space scale from a GLB's visible skinned avatar. Compute
// the displayed pose once when framing the preview, never in the render loop.
export function getAvatarPreviewBounds(object, target = new Box3()) {
  const vertex = new Vector3();
  const base = new Vector3();
  const morph = new Vector3();
  target.makeEmpty();
  object.updateWorldMatrix(true, true);

  object.traverse(node => {
    const geometry = node.geometry;
    const positions = geometry && geometry.attributes && geometry.attributes.position;
    if (!positions) return;

    const morphPositions = geometry.morphAttributes.position;
    const influences = node.morphTargetInfluences;
    for (let i = 0; i < positions.count; i++) {
      base.fromBufferAttribute(positions, i);
      vertex.copy(base);
      if (morphPositions && influences) {
        for (let j = 0; j < morphPositions.length; j++) {
          const influence = influences[j];
          if (!influence) continue;
          morph.fromBufferAttribute(morphPositions[j], i);
          if (!geometry.morphTargetsRelative) morph.sub(base);
          vertex.addScaledVector(morph, influence);
        }
      }
      if (node.isSkinnedMesh) node.boneTransform(i, vertex);
      vertex.applyMatrix4(node.matrixWorld);
      target.expandByPoint(vertex);
    }
  });
  return target;
}

export function fitAvatarPreviewCamera(camera, box, center, orientation, margin = 1.05) {
  if (box.isEmpty()) return;
  camera.position.set(0, 0, 1).applyEuler(orientation).add(center);
  camera.lookAt(center);
  const inverseRotation = camera.quaternion.clone().invert();
  const halfVerticalFov = Math.tan((camera.fov * Math.PI) / 360);
  const halfHorizontalFov = halfVerticalFov * camera.aspect;
  const corner = new Vector3();
  let distance = camera.near * 2;

  // Account for both axes and the oblique viewing direction. A height-only
  // fit clips outstretched hands in the narrow portrait preview.
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corner.set(x, y, z).sub(center).applyQuaternion(inverseRotation);
        distance = Math.max(
          distance,
          corner.z + camera.near * 2,
          corner.z + (margin * Math.abs(corner.x)) / halfHorizontalFov,
          corner.z + (margin * Math.abs(corner.y)) / halfVerticalFov
        );
      }
    }
  }
  camera.position.set(0, 0, distance).applyQuaternion(camera.quaternion).add(center);
}
