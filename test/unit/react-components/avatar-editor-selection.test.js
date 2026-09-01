/* eslint-disable react/prop-types */

import test from "ava";

require("../../../scripts/shim");

const Module = require("module");
const React = require("react");
const { File: NodeFile } = require("node:buffer");
const { createRoot } = require("react-dom/client");
const { act } = require("react-dom/test-utils");
const { IntlProvider } = require("react-intl");
const { MAX_AVATAR_GLB_BYTES } = require("../../../src/utils/avatar-glb-utils");

// Exercise the mounted editor and real file/skeleton validators. Rendering,
// parsing and transport are isolated: these are not real-avatar acceptance tests.
const urls = new Map();
const parsedFiles = [];
const uploadedFiles = [];
const savedAvatars = [];
let nextUrl = 0;

function gltfFixture(compatible = true) {
  const names = compatible
    ? [
        "Hips",
        "Spine",
        "Neck",
        "Head",
        "LeftShoulder",
        "LeftArm",
        "LeftForeArm",
        "LeftHand",
        "RightShoulder",
        "RightArm",
        "RightForeArm",
        "RightHand"
      ]
    : ["Hips"];
  return {
    parser: { json: {} },
    scene: {
      traverse(callback) {
        callback({ isSkinnedMesh: true, skeleton: { bones: names.map(name => ({ name })) } });
      }
    },
    files: { gltf: new File(["{}"], "fixture.gltf"), bin: new File(["local"], "fixture.bin") }
  };
}

class PreviewStub extends React.Component {
  snapshot = async () => new Uint8Array([0]);
  render() {
    return <div data-testid="avatar-preview" data-url={this.props.avatarGltfUrl || ""} />;
  }
}

const stubs = {
  "../utils/configs": {},
  "./if-feature": () => null,
  "../utils/phoenix-utils": {
    fetchReticulumAuthenticated: async (_url, _method, { avatar }) => {
      savedAvatars.push(avatar);
      return { avatars: [{ avatar_id: "local-only" }] };
    }
  },
  "../utils/media-utils": {
    upload: async file => {
      uploadedFiles.push(file);
      return { file_id: file.name, meta: { access_token: "test-only", promotion_token: "test-only" } };
    }
  },
  "../utils/avatar-utils": { ensureAvatarMaterial: value => value },
  "./avatar-preview": PreviewStub,
  "three/examples/jsm/loaders/GLTFLoader": {
    GLTFLoader: class {
      register() {
        return this;
      }
      load(url, onLoad) {
        parsedFiles.push(urls.get(url));
        onLoad(gltfFixture());
      }
    }
  }
};
const originalLoad = Module._load;
Module._load = function loadEditorWithIsolatedEffects(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, parent, isMain);
};
let AvatarEditor;
try {
  AvatarEditor = require("../../../src/react-components/avatar-editor").default.WrappedComponent;
} finally {
  Module._load = originalLoad;
}

const originalGlobals = {
  File: global.File,
  fetch: global.fetch,
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
  act: global.IS_REACT_ACT_ENVIRONMENT
};
test.before(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.File = NodeFile;
  global.fetch = () => {
    throw new Error("Network is forbidden in avatar selection tests");
  };
  URL.createObjectURL = file => {
    const url = `blob:local-avatar-${++nextUrl}`;
    urls.set(url, file);
    return url;
  };
  URL.revokeObjectURL = url => urls.delete(url);
});
test.after.always(() => {
  global.File = originalGlobals.File;
  global.fetch = originalGlobals.fetch;
  URL.createObjectURL = originalGlobals.createObjectURL;
  URL.revokeObjectURL = originalGlobals.revokeObjectURL;
  global.IS_REACT_ACT_ENVIRONMENT = originalGlobals.act;
});

function headerFile(name = "valid.glb") {
  const bytes = new Uint8Array(12);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, bytes.length, true);
  return new File([bytes], name);
}

async function mount(t, mode = "private-glb") {
  urls.clear();
  parsedFiles.length = uploadedFiles.length = savedAvatars.length = 0;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const ref = React.createRef();
  await act(async () =>
    root.render(
      <IntlProvider locale="en">
        <AvatarEditor mode={mode} ref={ref} intl={{ formatMessage: m => m.defaultMessage }} />
      </IntlProvider>
    )
  );
  t.teardown(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return {
    editor: ref.current,
    get save() {
      return container.querySelector('button[type="submit"]');
    },
    get error() {
      return container.querySelector(".error-text")?.textContent;
    },
    async select(file) {
      const input = container.querySelector('input[type="file"]');
      Object.defineProperty(input, "files", { configurable: true, value: file ? [file] : [] });
      await act(async () => {
        input.dispatchEvent(new window.Event("change", { bubbles: true }));
        await new Promise(resolve => setImmediate(resolve));
      });
    },
    async ready(compatible = true) {
      await act(async () => ref.current.handleGltfLoaded(gltfFixture(compatible)));
    },
    async submit() {
      await act(async () => ref.current.uploadAvatar({ preventDefault() {} }));
    }
  };
}

for (const kind of ["corrupt", "oversized"]) {
  test.serial(`valid then ${kind} GLB cannot leave Save enabled`, async t => {
    const h = await mount(t);
    await h.select(headerFile());
    await h.ready();
    t.false(h.save.disabled);
    const invalid = kind === "corrupt" ? new File(["not a glb"], "corrupt.glb") : headerFile("oversized.glb");
    if (kind === "oversized") Object.defineProperty(invalid, "size", { value: MAX_AVATAR_GLB_BYTES + 1 });
    await h.select(invalid);
    t.truthy(h.error);
    t.true(h.save.disabled);
    t.falsy(h.editor.inputFiles.glb);
  });
}

test.serial("submit after a rejected selection never parses or uploads the previous file", async t => {
  const h = await mount(t);
  await h.select(headerFile());
  await h.ready();
  await h.select(new File(["bad"], "bad.glb"));
  await h.submit();
  t.is(parsedFiles.length, 0);
  t.is(uploadedFiles.length, 0);
  t.is(savedAvatars.length, 0);
});

async function deferredHeaderFile(corrupt = false) {
  const file = headerFile("slow.glb");
  const bytes = await file.arrayBuffer();
  if (corrupt) new DataView(bytes).setUint32(0, 0, true);
  let release;
  const header = new Promise(resolve => (release = () => resolve(bytes)));
  Object.defineProperty(file, "slice", { value: () => ({ arrayBuffer: () => header }) });
  return { file, release };
}

async function finishHeader(pending) {
  await act(async () => {
    pending.release();
    await new Promise(resolve => setImmediate(resolve));
  });
}

test.serial("a replacement blocks Save while its header is still being read", async t => {
  const h = await mount(t);
  await h.select(headerFile());
  await h.ready();
  const pending = await deferredHeaderFile();
  await h.select(pending.file);
  t.true(h.save.disabled);
  t.falsy(h.editor.inputFiles.glb);
  await h.submit();
  t.is(parsedFiles.length, 0);
  await finishHeader(pending);
  t.true(h.save.disabled, "the new header alone does not prove a valid preview/rig");
  await h.ready();
  t.false(h.save.disabled);
  t.is(h.editor.inputFiles.glb, pending.file);
});

for (const corrupt of [false, true]) {
  test.serial(`a late ${corrupt ? "rejection" : "success"} cannot replace the newest selection`, async t => {
    const h = await mount(t);
    const pending = await deferredHeaderFile(corrupt);
    await h.select(pending.file);
    const newest = headerFile("newest.glb");
    await h.select(newest);
    await h.ready();
    await finishHeader(pending);
    t.is(h.editor.inputFiles.glb, newest);
    t.false(h.save.disabled);
    t.falsy(h.error);
    t.is(urls.get(h.editor.state.previewGltfUrl), newest);
  });
}

test.serial("cancelling the picker preserves the current valid selection", async t => {
  const h = await mount(t);
  const valid = headerFile();
  await h.select(valid);
  await h.ready();
  const previewUrl = h.editor.state.previewGltfUrl;
  await h.select(null);
  t.is(h.editor.inputFiles.glb, valid);
  t.is(h.editor.state.previewGltfUrl, previewUrl);
  t.false(h.save.disabled);
});

test.serial("a valid reselection after rejection can save only the new file", async t => {
  const h = await mount(t);
  await h.select(headerFile("old.glb"));
  await h.ready();
  const oldUrl = h.editor.state.previewGltfUrl;
  await h.select(new File(["bad"], "bad.glb"));
  t.false(urls.has(oldUrl), "the discarded blob URL is released");
  const valid = headerFile("new.glb");
  await h.select(valid);
  t.true(h.save.disabled);
  await h.ready();
  await h.submit();
  t.deepEqual(parsedFiles, [valid]);
  t.is(uploadedFiles.length, 3);
  t.is(savedAvatars.length, 1);
  t.false(savedAvatars[0].allow_promotion);
  t.false(savedAvatars[0].allow_remixing);
});

test.serial("an incompatible replacement rig blocks both Save and direct submit", async t => {
  const h = await mount(t);
  await h.select(headerFile());
  await h.ready();
  await h.select(headerFile("incompatible.glb"));
  await h.ready(false);
  t.regex(h.error, /esqueleto compatible/);
  t.true(h.save.disabled);
  await h.submit();
  t.is(parsedFiles.length, 0);
  t.is(uploadedFiles.length, 0);
});

test.serial("the legacy private mode alias also discards a rejected replacement", async t => {
  const h = await mount(t, "avaturn-private");
  await h.select(headerFile());
  await h.ready();
  await h.select(new File(["bad"], "bad.glb"));
  t.true(h.save.disabled);
  await h.submit();
  t.is(parsedFiles.length, 0);
});

test.serial("the private file picker is disabled during an upload", async t => {
  const h = await mount(t);
  await act(async () => h.editor.setState({ uploading: true }));
  t.true(document.querySelector('input[type="file"]').disabled);
  t.true(h.save.disabled);
});
