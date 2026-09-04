import fs from "node:fs";
import process from "node:process";
import { Buffer } from "node:buffer";
const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) throw new Error("Usage: node normalize-business-avatar.mjs INPUT.glb OUTPUT.glb");
const input = fs.readFileSync(inputPath);
const size = input.readUInt32LE(12);
const json = JSON.parse(input.subarray(20, 20 + size));
const hairNames = ["short01", "short02", "bob01", "ponytail01", "afro01"];
for (const material of json.materials) {
  const hair = hairNames.some(name => material.name.endsWith("." + name));
  const cutout = hair || material.name.endsWith(".eyebrow001");
  material.alphaMode = cutout ? "MASK" : "OPAQUE";
  if (cutout) material.alphaCutoff = 0.5;
  material.extras = { creator_hair: hair };
}
for (const node of json.nodes) {
  const group = node.extras && node.extras.creator_group;
  // Keep only the composition contract, not offline MPFB editing properties.
  if (group) node.extras = { creator_group: group };
  else delete node.extras;
}
json.asset.copyright =
  "MakeHuman Team, Margaret Toigo, Namuhekam (CC0 1.0); Mindfront and punkduck (CC BY 4.0). Adapted for YenHubs.";
json.asset.extras = {
  credits: [
    {
      authors: "MakeHuman Team, Margaret Toigo, Namuhekam",
      license: "CC0-1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      source: "https://static.makehumancommunity.org/assets/assetpacks.html"
    },
    {
      authors: "Mindfront, punkduck",
      license: "CC-BY-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      source: "https://static.makehumancommunity.org/assets/assetpacks/pants02.html"
    }
  ],
  modifications:
    "Fitted to body, rigged, garments separated and adjusted, textures resized, transparency normalized and converted to GLB."
};
const encoded = Buffer.from(JSON.stringify(json));
const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
encoded.copy(padded);
const tail = input.subarray(20 + size);
const header = Buffer.from(input.subarray(0, 20));
header.writeUInt32LE(20 + padded.length + tail.length, 8);
header.writeUInt32LE(padded.length, 12);
fs.writeFileSync(outputPath, Buffer.concat([header, padded, tail]));
