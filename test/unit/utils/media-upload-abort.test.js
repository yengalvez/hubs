import test from "ava";

require("../../../scripts/shim");

const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const { parseSync } = require("@babel/core");
const { File: NodeFile } = require("node:buffer");

// Execute the actual upload declaration without loading unrelated WebGL/media
// players. Only its endpoint and fetch are local fixtures, never a provider.
const source = readFileSync(require.resolve("../../../src/utils/media-utils"), "utf8");
const ast = parseSync(source, { configFile: false, babelrc: false, sourceType: "module" });
const declaration = ast.program.body.find(
  node => node.type === "ExportNamedDeclaration" && node.declaration?.declarations?.[0]?.id.name === "upload"
).declaration;

function uploadWithFetch(fetch) {
  return runInNewContext(`${source.slice(declaration.start, declaration.end)}; upload;`, {
    FormData,
    fetch,
    getDirectMediaAPIEndpoint: () => "https://local.invalid/api/v1/media"
  });
}

test.serial("the actual media upload forwards the optional editor AbortSignal to fetch", async t => {
  let request;
  const upload = uploadWithFetch((url, options) => {
    request = { url, options };
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("fixture-aborted")), { once: true });
    });
  });
  const controller = new AbortController();
  const pending = upload(new NodeFile(["local"], "fixture.bin"), undefined, { signal: controller.signal });
  t.is(request.url, "https://local.invalid/api/v1/media");
  t.is(request.options.signal, controller.signal);
  t.is(request.options.method, "POST");
  t.is(request.options.body.get("media").name, "fixture.bin");
  t.is(request.options.body.get("promotion_mode"), "with_token");
  controller.abort();
  await t.throwsAsync(pending, { message: "fixture-aborted" });
});

test.serial(
  "ordinary media uploads retain the same endpoint, content type, result and no cancellation signal",
  async t => {
    const requests = [];
    const result = { file_id: "fixture-only" };
    const upload = uploadWithFetch(async (url, options) => {
      requests.push({ url, options });
      return { json: async () => result };
    });
    t.is(await upload(new NodeFile(["local"], "fixture.bin")), result);
    t.is(await upload(new NodeFile(["local"], "fixture.glb"), "model/gltf-binary"), result);
    t.true(requests.every(request => !Object.prototype.hasOwnProperty.call(request.options, "signal")));
    t.is(requests[0].options.body.get("desired_content_type"), null);
    t.is(requests[1].options.body.get("desired_content_type"), "model/gltf-binary");
  }
);
