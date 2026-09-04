// Templates are curated CC0 assets, served by YenHubs. No provider API or user data leaves the app.
export const CREATOR_DEFAULTS = Object.freeze({
  body: "male",
  hair: "simpleparted",
  outfit: "peasant",
  hairColor: "#493326"
});
export const CREATOR_BODIES = ["male", "female"];
export const CREATOR_HAIR = ["none", "simpleparted", "buzzed", "buzzedfemale", "buns", "long"];
export const CREATOR_OUTFITS = ["peasant", "ranger"];

export function composeAvatar(template, options) {
  if (
    !CREATOR_BODIES.includes(options.body) ||
    !CREATOR_HAIR.includes(options.hair) ||
    !CREATOR_OUTFITS.includes(options.outfit) ||
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
  for (const node of json.nodes) {
    const group = node.extras && node.extras.creator_group;
    if (
      (group && group !== `hair_${options.hair}` && group !== `outfit_${options.outfit}`) ||
      (node.name || "").includes("Head_Hood")
    ) {
      delete node.mesh;
      delete node.skin;
    }
  }
  const color = [1, 3, 5].map(i => {
    const srgb = parseInt(options.hairColor.slice(i, i + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  });
  for (const material of json.materials) {
    if (material.name.startsWith("MI_Hair")) material.pbrMetallicRoughness.baseColorFactor = [...color, 1];
  }
  json.asset.copyright = "CC0 1.0 — Quaternius; adapted for YenHubs";
  json.asset.extras = { yenhubsCreator: 1, options: { ...options } };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(encoded.byteLength / 4) * 4;
  const tail = new Uint8Array(template, 20 + length);
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
