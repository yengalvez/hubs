import test from "ava";
import fs from "fs";
import path from "path";
import {
  composeAvatar,
  CREATOR_DEFAULTS,
  CREATOR_BODIES,
  CREATOR_HAIR,
  CREATOR_OUTFITS
} from "../../../src/utils/avatar-creator";

const read = body => {
  const data = fs.readFileSync(path.resolve(__dirname, `../../../src/assets/models/avatar-creator/${body}.glb`));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
const jsonOf = bytes =>
  JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, new DataView(bytes).getUint32(12, true))));

for (const body of CREATOR_BODIES) {
  test(`${body}: all hair/outfit combinations export privately without changing template`, t => {
    const template = read(body);
    const original = Buffer.from(template).toString("base64");
    for (const hair of CREATOR_HAIR)
      for (const outfit of CREATOR_OUTFITS) {
        const options = { ...CREATOR_DEFAULTS, body, hair, outfit };
        const bytes = composeAvatar(template, options);
        const json = jsonOf(bytes);
        t.is(new DataView(bytes).getUint32(8, true), bytes.byteLength);
        t.is(bytes.byteLength % 4, 0);
        const visible = json.nodes.filter(n => n.mesh !== undefined);
        t.true(visible.some(n => n.name.startsWith("base_")));
        t.true(visible.some(n => n.extras && n.extras.creator_group === `outfit_${outfit}`));
        t.false(visible.some(n => n.name.includes("Head_Hood")));
        t.is(visible.filter(n => n.name.startsWith("hair_")).length, hair === "none" ? 0 : 1);
        t.true(
          visible.every(
            n =>
              !n.extras ||
              !n.extras.creator_group ||
              ["hair_" + hair, "outfit_" + outfit].includes(n.extras.creator_group)
          )
        );
        t.deepEqual(json.asset.extras.options, options);
        t.false((json.images || []).some(i => i.uri));
        t.false((json.buffers || []).some(b => b.uri));
      }
    t.is(Buffer.from(template).toString("base64"), original);
  });
}

test("rejects unknown choices, external URLs and invalid colors", t => {
  for (const patch of [
    { body: "external" },
    { hair: "https://example.com/a.glb" },
    { outfit: "unknown" },
    { hairColor: "red" }
  ]) {
    t.throws(() => composeAvatar(read("male"), { ...CREATOR_DEFAULTS, ...patch }));
  }
  t.throws(() => composeAvatar(new ArrayBuffer(0), CREATOR_DEFAULTS));
});

test("hair colour is encoded in linear colour space", t => {
  const json = jsonOf(composeAvatar(read("male"), { ...CREATOR_DEFAULTS, hairColor: "#ffffff" }));
  t.true(
    json.materials
      .filter(m => m.name.startsWith("MI_Hair"))
      .every(m => m.pbrMetallicRoughness.baseColorFactor.join() === "1,1,1,1")
  );
});
