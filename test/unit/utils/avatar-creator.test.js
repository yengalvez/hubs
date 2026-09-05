import test from "ava";
import fs from "fs";
import path from "path";
import {
  composeAvatar,
  CREATOR_DEFAULTS,
  CREATOR_BODIES,
  CREATOR_HAIR,
  CREATOR_TOPS,
  CREATOR_BOTTOMS
} from "../../../src/utils/avatar-creator";

const read = body => {
  const data = fs.readFileSync(path.resolve(__dirname, `../../../src/assets/models/avatar-creator/${body}.glb`));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
const jsonOf = bytes =>
  JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, new DataView(bytes).getUint32(12, true))));

for (const body of CREATOR_BODIES) {
  test(`${body}: independent wardrobe combinations retain only selected resources and credits`, t => {
    const template = read(body);
    const original = Buffer.from(template).toString("base64");
    for (const hair of CREATOR_HAIR)
      for (const top of CREATOR_TOPS)
        for (const bottom of CREATOR_BOTTOMS) {
          const options = { ...CREATOR_DEFAULTS, body, hair, top, bottom };
          const bytes = composeAvatar(template, options);
          const json = jsonOf(bytes);
          t.is(new DataView(bytes).getUint32(8, true), bytes.byteLength);
          t.is(bytes.byteLength % 4, 0);
          const visible = json.nodes.filter(n => n.mesh !== undefined);
          const groups = visible.map(n => n.extras && n.extras.creator_group).filter(Boolean);
          t.true(groups.includes(`body_${top}_${bottom}`));
          t.true(groups.includes(`top_${top}`));
          t.true(groups.includes(`bottom_${bottom}`));
          t.is(groups.filter(g => g.startsWith("hair_")).length, hair === "none" ? 0 : 1);
          t.true(
            visible.every(
              n =>
                !n.extras ||
                !n.extras.creator_group ||
                [`hair_${hair}`, `top_${top}`, `bottom_${bottom}`, `body_${top}_${bottom}`].includes(
                  n.extras.creator_group
                )
            )
          );
          t.deepEqual(json.asset.extras.options, options);
          t.is(json.asset.extras.creatorNeutralHair, 1);
          t.is(
            json.nodes.find(n => /^(mixamorig[:_-]?)?Hips$/i.test(n.name || "")).extras.yenhubsCreatorRig,
            "makehuman-mixamo-v1"
          );
          t.false((json.images || []).some(i => i.uri));
          t.false((json.buffers || []).some(b => b.uri));
          t.true(bytes.byteLength < template.byteLength / 2);
          t.true(json.asset.copyright.includes("CC BY 4.0"));
          t.true(json.asset.extras.credits.length > 0);
          for (const node of visible) t.true(node.mesh < json.meshes.length);
          for (const view of json.bufferViews) {
            t.is(view.byteOffset % 4, 0);
            t.true(view.byteOffset + view.byteLength <= json.buffers[0].byteLength);
          }
          for (const accessor of json.accessors) {
            if (accessor.bufferView !== undefined) t.true(accessor.bufferView < json.bufferViews.length);
          }
        }
    t.is(Buffer.from(template).toString("base64"), original);
  });
}

test("rejects unknown choices, external URLs and invalid colors", t => {
  for (const patch of [
    { body: "external" },
    { hair: "https://example.com/a.glb" },
    { top: "unknown" },
    { bottom: "unknown" },
    { hairColor: "red" }
  ]) {
    t.throws(() => composeAvatar(read("male"), { ...CREATOR_DEFAULTS, ...patch }));
  }
  t.throws(() => composeAvatar(new ArrayBuffer(0), CREATOR_DEFAULTS));
});

test("hair colour is encoded in linear colour space", t => {
  const json = jsonOf(composeAvatar(read("male"), { ...CREATOR_DEFAULTS, hairColor: "#ffffff" }));
  const hair = json.materials.filter(m => m.extras && m.extras.creator_hair);
  t.true(hair.length > 0);
  t.true(hair.every(m => m.pbrMetallicRoughness.baseColorFactor.join() === "1,1,1,1"));
});
