import { pruneCreatorResources } from "./avatar-creator-prune";
// Curated CC0/CC-BY assets served by YenHubs. No provider API receives user data.
export const CREATOR_DEFAULTS = Object.freeze({
  body: "male",
  hair: "short02",
  top: "polo",
  bottom: "chinos",
  hairColor: "#493326"
});
export const CREATOR_BODIES = ["male", "female"];
export const CREATOR_HAIR = ["none", "short01", "short02", "bob01", "ponytail01", "afro01"];
export const CREATOR_TOPS = ["polo", "blazer", "doublebreasted", "sweater", "tshirt"];
export const CREATOR_BOTTOMS = ["suit", "denim", "chinos", "jeans", "wool"];

export function composeAvatar(template, options) {
  if (
    !CREATOR_BODIES.includes(options.body) ||
    !CREATOR_HAIR.includes(options.hair) ||
    !CREATOR_TOPS.includes(options.top) ||
    !CREATOR_BOTTOMS.includes(options.bottom) ||
    !/^#[0-9a-f]{6}$/i.test(options.hairColor)
  ) {
    throw new Error("Opciones de avatar inválidas.");
  }
  const header = new DataView(template);
  if (
    template.byteLength < 28 ||
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== template.byteLength ||
    header.getUint32(16, true) !== 0x4e4f534a
  )
    throw new Error("Plantilla de avatar inválida.");
  const length = header.getUint32(12, true);
  if (length + 28 > template.byteLength) throw new Error("Plantilla incompleta.");
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(template, 20, length)));
  if ((json.animations || []).length || json.buffers.length !== 1 || json.buffers[0].uri)
    throw new Error("Plantilla no compatible.");
  const selected = new Set([
    `hair_${options.hair}`,
    `top_${options.top}`,
    `bottom_${options.bottom}`,
    `body_${options.top}_${options.bottom}`
  ]);
  const present = new Set(json.nodes.filter(n => n.mesh !== undefined).map(n => n.extras && n.extras.creator_group));
  for (const group of selected) {
    if (group !== "hair_none" && !present.has(group)) throw new Error("Falta una pieza del avatar.");
  }
  for (const node of json.nodes) {
    if (/^(mixamorig[:_-]?)?Hips$/i.test(node.name || "")) {
      node.extras = { ...node.extras, yenhubsCreatorRig: "makehuman-mixamo-v1" };
    }
    const group = node.extras && node.extras.creator_group;
    if (group && !selected.has(group)) {
      delete node.mesh;
      delete node.skin;
    }
  }
  const color = [1, 3, 5].map(i => {
    const srgb = parseInt(options.hairColor.slice(i, i + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  });
  for (const material of json.materials) {
    if (material.extras && material.extras.creator_hair) material.pbrMetallicRoughness.baseColorFactor = [...color, 1];
  }
  json.asset.extras = { ...json.asset.extras, yenhubsCreator: 2, options: { ...options } };
  const binStart = 20 + length;
  if (header.getUint32(binStart + 4, true) !== 0x004e4942) throw new Error("Plantilla sin datos binarios.");
  const bin = pruneCreatorResources(json, new Uint8Array(template, binStart + 8, header.getUint32(binStart, true)));
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(encoded.byteLength / 4) * 4;
  const tail = new Uint8Array(8 + bin.byteLength);
  const binHeader = new DataView(tail.buffer);
  binHeader.setUint32(0, bin.byteLength, true);
  binHeader.setUint32(4, 0x004e4942, true);
  tail.set(bin, 8);
  const bytes = new Uint8Array(20 + padded + tail.byteLength);
  bytes.set(new Uint8Array(template, 0, 20));
  bytes.fill(32, 20, 20 + padded);
  bytes.set(encoded, 20);
  bytes.set(tail, 20 + padded);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, padded, true);
  return bytes.buffer;
}
