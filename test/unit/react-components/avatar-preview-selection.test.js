import test from "ava";

require("../../../scripts/shim");
global.THREE = require("three");

const Module = require("module");
const stubs = {
  "../utils/theme": { onThemeChanged: () => () => {}, getThemeColor: () => "#000" },
  "three/examples/jsm/controls/OrbitControls": { OrbitControls: class {} },
  "../components/environment-map": { createDefaultEnvironmentMap: () => null },
  "../components/gltf-model-plus": { loadGLTF: async () => null },
  "../utils/three-utils": { disposeNode: () => {}, findNode: () => null },
  "../utils/avatar-utils": { ensureAvatarMaterial: value => value, MAT_NAME: "AvatarMaterial" },
  "../utils/avatar-preview-bounds": { fitAvatarPreviewCamera: () => {}, getAvatarPreviewBounds: () => {} },
  "../utils/avatar-creator-garment-fit": { fitCreatorJackets: () => {} },
  "../utils/image-bitmap-utils": { createImageBitmap: async value => value, disposeImageBitmap: () => {} },
  "../utils/media-url-utils": { proxiedUrlFor: value => value }
};
const originalLoad = Module._load;
Module._load = function loadPreviewWithIsolatedEffects(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, parent, isMain);
};
let AvatarPreview;
try {
  AvatarPreview = require("../../../src/react-components/avatar-preview").AvatarPreview;
} finally {
  Module._load = originalLoad;
}

test("clearing a preview invalidates its in-flight GLB load", async t => {
  const preview = new AvatarPreview({ avatarGltfUrl: null });
  preview.loadId = 7;
  preview.avatar = { name: "discarded" };
  preview.scene = { remove: value => t.is(value, preview.avatar) };
  preview.applyMaps = () => Promise.resolve();

  await preview.componentDidUpdate({ avatarGltfUrl: "blob:discarded" });

  t.is(preview.loadId, 8);
  t.is(preview.avatar, null);
});
