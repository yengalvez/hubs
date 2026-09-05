// Offline asset step after normalize-business-avatar.mjs. Requires Sharp in
// the build environment (not in the browser). Keeps mesh/rig and alpha intact.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const sharp = require("sharp");

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error("Usage: node prepare-creator-hair.cjs INPUT.glb OUTPUT.glb");
  const input = fs.readFileSync(inputPath);
  const jsonLength = input.readUInt32LE(12);
  const json = JSON.parse(input.subarray(20, 20 + jsonLength));
  if (json.asset.extras?.creatorNeutralHair === 1)
    throw new Error("Hair already prepared; use the original normalized template");
  const originalBin = input.subarray(28 + jsonLength);
  const chunks = [originalBin];
  let offset = originalBin.length;
  let count = 0;
  for (const material of json.materials) {
    if (!material.extras?.creator_hair) continue;
    const textureInfo = material.pbrMetallicRoughness.baseColorTexture;
    const texture = json.textures[textureInfo.index];
    const image = json.images[texture.source];
    const view = json.bufferViews[image.bufferView];
    const encoded = originalBin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const { data, info } = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    const original = Buffer.from(data);
    for (let i = 0; i < data.length; i += 4) {
      // Lift the source pigment to a neutral light base; retain strand shading
      // and exactly preserve the silhouette's original alpha channel.
      const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const neutral = Math.round(180 + (75 * luminance) / 255);
      data[i] = data[i + 1] = data[i + 2] = neutral;
    }
    const png = await sharp(data, { raw: info }).png().toBuffer();
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer();
    for (let i = 3; i < decoded.length; i += 4) assert.equal(decoded[i], original[i], "Hair alpha changed");
    const padded = Buffer.alloc(Math.ceil(png.length / 4) * 4);
    png.copy(padded);
    const bufferView = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length }) - 1;
    const source = json.images.push({ mimeType: "image/png", bufferView }) - 1;
    textureInfo.index = json.textures.push({ ...texture, source }) - 1;
    chunks.push(padded);
    offset += padded.length;
    count++;
  }
  assert.equal(count, 5, "Expected exactly five hair materials");
  json.buffers[0].byteLength = offset;
  json.asset.extras = { ...json.asset.extras, creatorNeutralHair: 1 };
  const encoded = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
  encoded.copy(paddedJson);
  const header = Buffer.from(input.subarray(0, 20));
  header.writeUInt32LE(28 + paddedJson.length + offset, 8);
  header.writeUInt32LE(paddedJson.length, 12);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(offset, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(outputPath, Buffer.concat([header, paddedJson, binHeader, ...chunks]));
  console.log(`Prepared ${count} hair textures; alpha verified unchanged; mesh and rig untouched.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
