import test from "ava";

require("../../../scripts/shim");

const { File: NodeFile } = require("node:buffer");
const { avaturnExportToFile, normalizeAvaturnCreatorUrl } = require("../../../src/utils/avaturn-utils");

const originalFile = global.File;

test.before(() => {
  global.File = NodeFile;
});

test.after.always(() => {
  global.File = originalFile;
});

function glbBytes() {
  const bytes = new Uint8Array(12);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, bytes.length, true);
  return bytes;
}

test("Avaturn project URLs are restricted to secure project subdomains", t => {
  t.is(normalizeAvaturnCreatorUrl("https://yenhubs.avaturn.dev/editor?ignored=1"), "https://yenhubs.avaturn.dev");
  t.is(normalizeAvaturnCreatorUrl("http://yenhubs.avaturn.dev"), null);
  t.is(normalizeAvaturnCreatorUrl("https://avaturn.dev"), null);
  t.is(normalizeAvaturnCreatorUrl("https://yenhubs.avaturn.dev.evil.example"), null);
  t.is(normalizeAvaturnCreatorUrl("https://user@yenhubs.avaturn.dev"), null);
});

test.serial("a dataURL export becomes a validated private GLB file", async t => {
  const encoded = Buffer.from(glbBytes()).toString("base64");
  const file = await avaturnExportToFile(
    {
      avatarId: "avatar/unsafe id",
      urlType: "dataURL",
      url: `data:model/gltf-binary;base64,${encoded}`
    },
    "https://yenhubs.avaturn.dev"
  );

  t.is(file.name, "avaturn-avatarunsafeid.glb");
  t.is(file.size, 12);
  t.is(file.type, "model/gltf-binary");
});

test.serial("an httpURL export only downloads from Avaturn-controlled hosts", async t => {
  let requestedUrl;
  const file = await avaturnExportToFile(
    {
      avatarId: "abc",
      urlType: "httpURL",
      url: "https://assets.avaturn.me/export/avatar.glb"
    },
    "https://yenhubs.avaturn.dev",
    {
      fetchImpl: async url => {
        requestedUrl = url;
        return {
          ok: true,
          headers: { get: () => "12" },
          body: null,
          blob: async () => new Blob([glbBytes()], { type: "model/gltf-binary" })
        };
      }
    }
  );

  t.is(requestedUrl, "https://assets.avaturn.me/export/avatar.glb");
  t.is(file.name, "avaturn-abc.glb");
});

test.serial("a third-party export URL is rejected before any request", async t => {
  let requested = false;
  await t.throwsAsync(
    () =>
      avaturnExportToFile(
        { avatarId: "abc", urlType: "httpURL", url: "https://evil.example/avatar.glb" },
        "https://yenhubs.avaturn.dev",
        { fetchImpl: async () => (requested = true) }
      ),
    { message: /dominio no permitido/ }
  );
  t.false(requested);
});

test.serial("declared oversized downloads are rejected before reading the body", async t => {
  let read = false;
  await t.throwsAsync(
    () =>
      avaturnExportToFile(
        { avatarId: "abc", urlType: "httpURL", url: "https://assets.avaturn.me/avatar.glb" },
        "https://yenhubs.avaturn.dev",
        {
          maxBytes: 12,
          fetchImpl: async () => ({
            ok: true,
            headers: { get: () => "13" },
            body: null,
            blob: async () => {
              read = true;
              return new Blob([glbBytes()]);
            }
          })
        }
      ),
    { message: /tamaño permitido/ }
  );
  t.false(read);
});

test.serial("invalid GLB bytes from Avaturn never reach the avatar editor", async t => {
  const encoded = Buffer.from("not-a-glb").toString("base64");
  await t.throwsAsync(
    () =>
      avaturnExportToFile(
        { avatarId: "abc", urlType: "dataURL", url: `data:application/octet-stream;base64,${encoded}` },
        "https://yenhubs.avaturn.dev"
      ),
    { message: /GLB/ }
  );
});
