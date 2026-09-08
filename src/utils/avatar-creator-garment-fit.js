import { isCreatorAvatar } from "./avatar-animation-retarget";
import { fitCreatorGarmentHems, isCreatorSuitTrousers } from "./avatar-creator-garment-hems";

// Compatibility correction for the bundled MakeHuman jackets, including GLBs
// already saved by the creator. Imported third-party avatars are not touched.
// The wardrobe permits independent trousers; the jacket originally fitted only
// its own matching trousers and intersects the thicker wool waistband/seat.
export function fitCreatorJackets(root) {
  if (!isCreatorAvatar(root)) return;
  root.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry || Array.isArray(mesh.material)) return;
    // The separated suit trousers retain the jacket material. They are not a
    // jacket hem, and expanding them at ankle height breaks their fit to shoes.
    if (isCreatorSuitTrousers(mesh)) return;
    if (!/^Human\.toigo_male_(double-breasted_suit|suit_tie_and_jacket)$/.test(mesh.material?.name || "")) return;
    if (mesh.geometry.userData.creatorJacketClearance === 1) return;
    // Never mutate another avatar's cached geometry. Bundled vertices use metres,
    // Y up; keep the collar, sleeves and upper torso unchanged.
    const geometry = mesh.geometry.clone();
    // This Three.js version shares userData in BufferGeometry.clone(). Keep
    // the fitted marker private: otherwise cached/headless/remote copies are
    // marked as fitted even though their vertex buffers were never adjusted.
    geometry.userData = { ...geometry.userData };
    geometry.computeBoundingBox();
    const hem = geometry.boundingBox.min.y;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const skinIndex = geometry.attributes.skinIndex;
    const skinWeight = geometry.attributes.skinWeight;
    const armJoints = new Set(
      (mesh.skeleton?.bones || []).map((bone, i) => (/(?:Shoulder|Arm|ForeArm|Hand)/i.test(bone.name) ? i : -1))
    );
    for (let i = 0; i < position.count; i++) {
      // Low sleeve cuffs can share the hem's height in the A-pose. Skin
      // ownership, not height alone, keeps sleeves aligned with their wrists.
      if (
        skinIndex &&
        skinWeight &&
        [0, 1, 2, 3].some(k => skinWeight.array[i * 4 + k] > 0 && armJoints.has(skinIndex.array[i * 4 + k]))
      )
        continue;
      const weight = Math.max(0, Math.min(1, (hem + 0.25 - position.getY(i)) / 0.18));
      const x = position.getX(i),
        z = position.getZ(i);
      const radius = Math.hypot(x, z);
      if (radius > 0 && weight > 0) {
        const scale = 1 + (0.03 * weight) / radius;
        position.setXYZ(i, x * scale, position.getY(i), z * scale);
        // Transform the original smooth normal with the deformation Jacobian.
        // Recomputing normals here would introduce hard seams at duplicated UVs.
        if (normal) {
          const rx = x / radius,
            rz = z / radius;
          const nx = normal.getX(i),
            nz = normal.getZ(i);
          const radial = nx * rx + nz * rz;
          const slope = weight < 1 ? -0.03 / 0.18 : 0;
          const ax = radial * rx + (nx - radial * rx) / scale;
          const ay = normal.getY(i) - slope * radial;
          const az = radial * rz + (nz - radial * rz) / scale;
          const length = Math.hypot(ax, ay, az);
          normal.setXYZ(i, ax / length, ay / length, az / length);
        }
      }
    }
    position.needsUpdate = true;
    if (normal) normal.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.creatorJacketClearance = 1;
    mesh.geometry = geometry;
  });
  fitCreatorGarmentHems(root);
}
