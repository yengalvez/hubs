import { Triangle, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";

function updateHemNormals(geometry, before, moved) {
  const sourceNormal = before.attributes.normal;
  if (!sourceNormal || !moved.size) return;
  const sourcePosition = before.attributes.position;
  const position = geometry.attributes.position;
  const keys = [],
    sums = new Map(),
    changed = new Set();
  // Weld only for calculating smooth normals, never topology or UVs. Authored
  // hard edges remain separate because their original normals differ.
  for (let i = 0; i < position.count; i++) {
    const key = [
      sourcePosition.getX(i),
      sourcePosition.getY(i),
      sourcePosition.getZ(i),
      sourceNormal.getX(i),
      sourceNormal.getY(i),
      sourceNormal.getZ(i)
    ]
      .map(v => v.toFixed(6))
      .join(",");
    keys.push(key);
    if (!sums.has(key)) sums.set(key, new Vector3());
  }
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    cross = new Vector3();
  const count = geometry.index ? geometry.index.count : position.count;
  for (let at = 0; at + 2 < count; at += 3) {
    const vertices = [0, 1, 2].map(k => (geometry.index ? geometry.index.getX(at + k) : at + k));
    a.fromBufferAttribute(position, vertices[0]);
    b.fromBufferAttribute(position, vertices[1]);
    c.fromBufferAttribute(position, vertices[2]);
    cross.crossVectors(b.sub(a), c.sub(a));
    for (const vertex of vertices) sums.get(keys[vertex]).add(cross);
    if (vertices.some(vertex => moved.has(vertex))) for (const vertex of vertices) changed.add(keys[vertex]);
  }
  for (const key of changed) sums.get(key).normalize();
  for (let i = 0; i < position.count; i++)
    if (changed.has(keys[i])) {
      const n = sums.get(keys[i]);
      if (n.lengthSq() > 0) geometry.attributes.normal.setXYZ(i, n.x, n.y, n.z);
    }
  geometry.attributes.normal.needsUpdate = true;
}

const TOPS = new Set([
  "Human.namuhekam_male_polo_shirt",
  "Human.toigo_fisherman_sweater",
  "Human.toigo_male_double-breasted_suit",
  "Human.toigo_male_suit_tie_and_jacket"
]);
const BOTTOMS = new Set([
  "Human.mindfront_male_trousers_1",
  "Human.mindfront_male_trousers_2",
  "Human.punkduck_male_classic_jeans",
  "Human.toigo_wool_pants",
  "Trousers.suit"
]);
const normalize = name => name.replace(/^.*[|:]/, "").replace(/^mixamorig[_-]?/i, "");

export function isCreatorSuitTrousers(mesh) {
  // GLTFLoader strips punctuation, and Hubs may put extras on a wrapper.
  return [mesh, mesh.parent].some(
    node =>
      node &&
      (node.userData?.creator_group === "bottom_suit" ||
        /^Trouserssuit(?:_\d+)?$/.test(node.name.replace(/\(headless\)$/, "").replace(/[. :/]/g, "")))
  );
}

// Called only after creator identity has been established. Fit against the
// selected trousers, not all wardrobe layers. Both meshes must share the same
// bind-space contract. The tucked T-shirt is intentionally not an outer layer.
export function fitCreatorGarmentHems(root) {
  const tops = [],
    bottoms = [];
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !mesh.geometry || Array.isArray(mesh.material)) return;
    if (isCreatorSuitTrousers(mesh) || BOTTOMS.has(mesh.material?.name)) bottoms.push(mesh);
    else if (TOPS.has(mesh.material?.name) && mesh.geometry.userData.creatorHemFit !== 1) tops.push(mesh);
  });
  if (!bottoms.length || !tops.length) return;
  // Local first-person rendering adds an erased/headless copy of every skin.
  // It is the same outfit, not a second selected pair of trousers. Fit both
  // copies against the untouched original surface, regardless of load order.
  const originals = bottoms.filter(mesh => !/\(headless\)$/.test(mesh.name));
  const bottom = originals.length === 1 ? originals[0] : bottoms.length === 1 ? bottoms[0] : null;
  if (!bottom || bottoms.some(mesh => mesh !== bottom && mesh.name !== `${bottom.name}(headless)`)) return;
  const base = bottom.geometry;
  if (!base.attributes.skinIndex || !base.attributes.skinWeight) return;
  // BVH construction reorders indices. Never build it on cached/rendered bytes.
  const surface = base.clone();
  const bvh = new MeshBVH(surface);
  const probe = { geometry: surface };
  const point = new Vector3(),
    closest = new Vector3(),
    temp = new Vector3();
  const normal = new Vector3(),
    bary = new Vector3();
  const nearestTriangle = new Triangle();
  const boneNames = bottom.skeleton.bones.map(bone => normalize(bone.name));
  for (const top of tops) {
    if (top.geometry.userData.creatorHemFit === 1) continue;
    if (!top.bindMatrix.elements.every((v, i) => Math.abs(v - bottom.bindMatrix.elements[i]) < 1e-6)) continue;
    const geometry = top.geometry.clone();
    const before = top.geometry;
    const moved = new Set();
    geometry.userData = { ...geometry.userData };
    const position = geometry.attributes.position;
    const indices = geometry.attributes.skinIndex,
      weights = geometry.attributes.skinWeight;
    if (!indices || !weights || indices.itemSize !== 4 || weights.itemSize !== 4) continue;
    const targetBones = new Map(top.skeleton.bones.map((bone, i) => [normalize(bone.name), i]));
    const armIndices = new Set(
      top.skeleton.bones.flatMap((bone, i) => (/Shoulder|Arm|Hand/.test(bone.name) ? [i] : []))
    );
    geometry.computeBoundingBox();
    const hem = geometry.boundingBox.min.y;
    for (let vertex = 0; vertex < position.count; vertex++) {
      const offset = vertex * 4;
      if ([0, 1, 2, 3].some(k => weights.array[offset + k] > 0 && armIndices.has(indices.array[offset + k]))) continue;
      const strength = Math.max(0, Math.min(1, (hem + 0.22 - position.getY(vertex)) / 0.14));
      if (!strength) continue;
      point.fromBufferAttribute(position, vertex);
      let distance = 0.12,
        triangleIndices = null;
      bvh.shapecast(
        probe,
        (box, leaf, score) => score < distance,
        (triangle, a, b, c) => {
          triangle.closestPointToPoint(point, temp);
          const candidate = point.distanceTo(temp);
          if (candidate < distance) {
            distance = candidate;
            closest.copy(temp);
            nearestTriangle.copy(triangle);
            triangleIndices = [surface.index.getX(a), surface.index.getX(b), surface.index.getX(c)];
          }
          return false;
        },
        box => box.distanceToPoint(point)
      );
      if (!triangleIndices) continue;
      nearestTriangle.getNormal(normal);
      const gap = temp.copy(point).sub(closest).dot(normal);
      if (gap < 0.03) {
        point.addScaledVector(normal, (0.03 - gap) * strength);
        moved.add(vertex);
      }
      position.setXYZ(vertex, point.x, point.y, point.z);
      nearestTriangle.getBarycoord(closest, bary);
      const mixed = new Map();
      for (let k = 0; k < 4; k++) {
        const joint = indices.array[offset + k];
        mixed.set(joint, (mixed.get(joint) || 0) + weights.array[offset + k] * (1 - strength));
      }
      for (let corner = 0; corner < 3; corner++) {
        const at = triangleIndices[corner] * 4;
        for (let k = 0; k < 4; k++) {
          const joint = targetBones.get(boneNames[base.attributes.skinIndex.array[at + k]]);
          if (joint === undefined) continue;
          const weight = base.attributes.skinWeight.array[at + k] * bary.getComponent(corner) * strength;
          mixed.set(joint, (mixed.get(joint) || 0) + weight);
        }
      }
      const selected = [...mixed]
        .filter(([, w]) => w > 1e-8)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      const total = selected.reduce((sum, [, weight]) => sum + weight, 0);
      if (total > 0)
        for (let k = 0; k < 4; k++) {
          indices.array[offset + k] = selected[k]?.[0] || 0;
          weights.array[offset + k] = selected[k] ? selected[k][1] / total : 0;
        }
    }
    position.needsUpdate = indices.needsUpdate = weights.needsUpdate = true;
    updateHemNormals(geometry, before, moved);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.creatorHemFit = 1;
    top.geometry = geometry;
  }
}
