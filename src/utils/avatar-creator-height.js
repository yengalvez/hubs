import { Matrix4, Quaternion, Vector3 } from "three";

// Desktop Hubs positions its viewpoint 1.6m above a floor waypoint. Match the
// bundled creator's head reference to that convention instead of translating a
// short model upward (which leaves its feet and sitting pose floating).
// This runs before skin binding/inflation, uniformly scaling meshes AND joints.
export function normalizeCreatorHeight(json) {
  if (!json.nodes.some(n => n.extras?.yenhubsCreatorRig === "makehuman-mixamo-v1")) return;
  const scene = json.scenes[json.scene || 0];
  if (scene.nodes.length !== 1) return;
  let headHeight;
  const walk = (index, parent) => {
    const node = json.nodes[index];
    const local = node.matrix
      ? new Matrix4().fromArray(node.matrix)
      : new Matrix4().compose(
          new Vector3().fromArray(node.translation || [0, 0, 0]),
          new Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
          new Vector3().fromArray(node.scale || [1, 1, 1])
        );
    const world = parent.clone().multiply(local);
    if (node.name === "Head") headHeight = world.elements[13];
    for (const child of node.children || []) walk(child, world);
  };
  walk(scene.nodes[0], new Matrix4());
  if (!Number.isFinite(headHeight) || headHeight < 0.8 || headHeight > 2.5) return;
  const root = json.nodes[scene.nodes[0]],
    factor = 1.6 / headHeight;
  if (root.matrix) {
    root.matrix = new Matrix4()
      .makeScale(factor, factor, factor)
      .multiply(new Matrix4().fromArray(root.matrix))
      .toArray();
  } else {
    root.scale = (root.scale || [1, 1, 1]).map(v => v * factor);
    if (root.translation) root.translation = root.translation.map(v => v * factor);
  }
}
