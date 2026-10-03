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
const configs = require("../../../src/utils/configs").default;
const phoenixUtilsPath = require.resolve("../../../src/utils/phoenix-utils");
require.cache[phoenixUtilsPath] = { id: phoenixUtilsPath, filename: phoenixUtilsPath, loaded: true, exports: {} };
const HubChannel = require("../../../src/utils/hub-channel").default;
const { Socket } = require("phoenix");

// Exercise the mounted editor and real file/skeleton validators. Rendering,
// parsing and transport are isolated: these are not real-avatar acceptance tests.
const urls = new Map();
const parsedFiles = [];
const uploadedFiles = [];
const savedAvatars = [];
const uploadSignals = [];
const saveSignals = [];
let nextUrl = 0;
let hub;
let transport;
let avaturnCreatorProps;
let saveFailure = false;
let saveBarrier;
let uploadBarrier;

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
  "./avatar-creator-controls": () => null,
  "./avaturn-creator": props => {
    avaturnCreatorProps = props;
    return <div data-testid="avaturn-creator" />;
  },
  "./if-feature": () => null,
  "../utils/phoenix-utils": {
    fetchReticulumAuthenticated: async (_url, _method, { avatar }, { signal } = {}) => {
      saveSignals.push(signal);
      if (saveBarrier) await saveBarrier;
      if (saveFailure) throw new Error("Save temporarily unavailable");
      savedAvatars.push(avatar);
      return { avatars: [{ avatar_id: "local-only" }] };
    }
  },
  "../utils/media-utils": {
    upload: async (file, _desiredContentType, { signal } = {}) => {
      uploadedFiles.push(file);
      uploadSignals.push(signal);
      if (uploadBarrier) await uploadBarrier;
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

function setAvaturnEnabled(enabled) {
  transport.trigger("product_modules_changed", { bots_enabled: false, ai_enabled: false, avaturn_enabled: enabled });
}

test.beforeEach(() => {
  hub = new HubChannel({ state: { credentials: {} }, addEventListener() {} }, "avatar-profile");
  transport = new Socket("wss://local.invalid/socket").channel("hub:avatar-profile", {});
  hub.setChannel(transport);
  configs.APP_CONFIG.links = { avaturn_creator: "https://yenhubs.avaturn.dev" };
  setAvaturnEnabled(true);
  saveFailure = false;
  saveBarrier = uploadBarrier = null;
  uploadSignals.length = saveSignals.length = 0;
});
test.afterEach.always(async () => act(async () => hub.disconnect()));

function headerFile(name = "valid.glb") {
  const bytes = new Uint8Array(12);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, bytes.length, true);
  return new File([bytes], name);
}

async function mount(t, mode = "private-glb", onSave) {
  urls.clear();
  parsedFiles.length = uploadedFiles.length = savedAvatars.length = 0;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const ref = React.createRef();
  await act(async () =>
    root.render(
      <IntlProvider locale="en">
        <AvatarEditor mode={mode} onSave={onSave} ref={ref} intl={{ formatMessage: m => m.defaultMessage }} />
      </IntlProvider>
    )
  );
  t.teardown(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return {
    container,
    editor: ref.current,
    get save() {
      return container.querySelector('button[type="submit"]');
    },
    get error() {
      return container.querySelector(".error-text")?.textContent;
    },
    get guide() {
      return container.querySelector(".private-glb-guide");
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

test.serial("private GLB upload contains its own expandable guide", async t => {
  const h = await mount(t);
  t.truthy(h.guide);
  t.regex(h.guide.querySelector("summary").textContent, /GLB guide and requirements/);
  t.regex(h.guide.textContent, /My Avatars/);
});

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

test.serial("creator replacement invalidates the old file before generation and saves privately", async t => {
  const h = await mount(t, "creator");
  await act(async () => h.editor.acceptCreatorFile(headerFile("old.glb")));
  await h.ready();
  t.false(h.save.disabled);
  await act(async () => h.editor.invalidateCreatorFile());
  t.true(h.save.disabled);
  await h.submit();
  t.is(uploadedFiles.length, 0);
  const generated = headerFile("generated.glb");
  await act(async () => h.editor.acceptCreatorFile(generated));
  await h.ready();
  await h.submit();
  t.deepEqual(parsedFiles, [generated]);
  t.false(savedAvatars[0].allow_promotion);
  t.false(savedAvatars[0].allow_remixing);
});

test.serial("creator ignores a late header after newer generation starts", async t => {
  const h = await mount(t, "creator");
  const pending = await deferredHeaderFile();
  let work;
  await act(async () => {
    work = h.editor.acceptCreatorFile(pending.file);
  });
  await act(async () => h.editor.invalidateCreatorFile());
  const newest = headerFile("latest.glb");
  await act(async () => h.editor.acceptCreatorFile(newest));
  await finishHeader(pending);
  await work;
  t.is(h.editor.inputFiles.glb, newest);
  t.is(savedAvatars.length, 0);
});

test.serial("creator failure cannot submit its previous selection", async t => {
  const h = await mount(t, "creator");
  await act(async () => h.editor.acceptCreatorFile(headerFile()));
  await h.ready();
  await act(async () => h.editor.invalidateCreatorFile());
  await act(async () => h.editor.handleCreatorError("Plantilla no disponible"));
  await h.submit();
  t.is(uploadedFiles.length, 0);
  t.is(savedAvatars.length, 0);
  t.true(h.save.disabled);
});

test.serial("Avaturn export validates, previews, confirms and saves privately without a second click", async t => {
  let saved;
  const h = await mount(t, "avaturn", avatar => (saved = avatar));
  const exported = headerFile("avaturn.glb");
  await act(async () => h.editor.handleAvaturnExportStart());
  await act(async () => h.editor.acceptAvaturnFile(exported));
  await act(async () => {
    h.editor.handleGltfLoaded(gltfFixture());
  });
  await act(async () => new Promise(resolve => setTimeout(resolve, 20)));

  t.deepEqual(parsedFiles, [exported]);
  t.is(savedAvatars.length, 1);
  t.false(savedAvatars[0].allow_promotion);
  t.false(savedAvatars[0].allow_remixing);
  t.is(h.editor.state.avaturnSaveState, "saved");
  t.falsy(h.save, "there is no Retry save button after a successful save");
  await h.submit();
  await h.submit();
  await act(async () => h.editor.handleAvaturnExportStart());
  t.false(await h.editor.acceptAvaturnFile(headerFile("duplicate.glb")));
  t.is(savedAvatars.length, 1, "success is terminal during the 1400ms confirmation");
  t.falsy(saved, "the success confirmation remains visible before returning to My Avatars");
  await act(async () => new Promise(resolve => setTimeout(resolve, 1450)));
  t.is(saved.avatar_id, "local-only");
});

test.serial("direct/history Avaturn editor mount with OFF or invalid URL never mounts creator", async t => {
  setAvaturnEnabled(false);
  const off = await mount(t, "avaturn");
  t.falsy(off.container.querySelector('[data-testid="avaturn-creator"]'));
  t.regex(off.container.textContent, /no está disponible/);
  t.false(off.editor.handleAvaturnExportStart());
  t.false(await off.editor.acceptAvaturnFile(headerFile()));
  await off.submit();
  t.is(savedAvatars.length, 0);
  setAvaturnEnabled(true);
  configs.APP_CONFIG.links.avaturn_creator = "https://evil.example";
  const invalid = await mount(t, "avaturn");
  t.falsy(invalid.container.querySelector('[data-testid="avaturn-creator"]'));
});

for (const failure of ["rig", "load"]) {
  test.serial(`Avaturn ${failure} rejection reaches the creator and permits a fresh validated export`, async t => {
    const h = await mount(t, "avaturn");
    await act(async () => h.editor.handleAvaturnExportStart());
    await act(async () => h.editor.acceptAvaturnFile(headerFile("bad-preview.glb")));
    if (failure === "rig") await h.ready(false);
    else await act(async () => h.editor.handleGltfLoadError());
    t.truthy(avaturnCreatorProps.validationError);
    t.false(avaturnCreatorProps.disabled);
    t.false(h.editor.state.previewReady);
    t.is(savedAvatars.length, 0);
    await act(async () => h.editor.handleAvaturnExportStart());
    t.is(avaturnCreatorProps.validationError, null);
    await act(async () => h.editor.acceptAvaturnFile(headerFile("good-preview.glb")));
    await h.ready(true);
    await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
    t.is(savedAvatars.length, 1);
    t.true(avaturnCreatorProps.disabled);
    t.false(h.editor.handleAvaturnExportStart());
    t.false(await h.editor.acceptAvaturnFile(headerFile("must-not-duplicate.glb")));
    t.is(savedAvatars.length, 1);
  });
}

test.serial("a failed Avaturn save can retry, with concurrent retries coalesced", async t => {
  const h = await mount(t, "avaturn");
  await act(async () => h.editor.handleAvaturnExportStart());
  await act(async () => h.editor.acceptAvaturnFile(headerFile()));
  saveFailure = true;
  await h.ready();
  await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
  t.is(h.editor.state.avaturnSaveState, "error");
  t.false(h.save.disabled);
  t.is(savedAvatars.length, 0);
  saveFailure = false;
  let release;
  saveBarrier = new Promise(resolve => {
    release = resolve;
  });
  let first;
  await act(async () => {
    first = h.editor.uploadAvatar();
    await h.editor.uploadAvatar();
  });
  t.true(h.editor.uploadInFlight);
  t.false(h.editor.handleAvaturnExportStart());
  await act(async () => {
    release();
    await first;
  });
  t.is(savedAvatars.length, 1);
  t.is(h.editor.state.avaturnSaveState, "saved");
  await h.submit();
  t.is(savedAvatars.length, 1);
});

test.serial(
  "mounted Avaturn OFF-ON discards a held header and queued autosave while normal GLB stays usable",
  async t => {
    const privateEditor = await mount(t, "private-glb");
    const normalFile = headerFile("normal.glb");
    await privateEditor.select(normalFile);
    await privateEditor.ready();
    const h = await mount(t, "avaturn");
    const pending = await deferredHeaderFile();
    let accepting;
    await act(async () => {
      h.editor.handleAvaturnExportStart();
      accepting = h.editor.acceptAvaturnFile(pending.file);
    });
    await act(async () => {
      setAvaturnEnabled(false);
      setAvaturnEnabled(true);
      pending.release();
      t.false(await accepting);
    });
    t.falsy(h.editor.inputFiles.glb);
    t.falsy(h.editor.state.previewGltfUrl);
    t.false(h.editor.avaturnAutoSavePending);
    t.is(privateEditor.editor.inputFiles.glb, normalFile);
    t.false(privateEditor.save.disabled, "the independent normal GLB editor remains available");

    await act(async () => {
      h.editor.handleAvaturnExportStart();
      await h.editor.acceptAvaturnFile(headerFile("before-off.glb"));
      h.editor.handleGltfLoaded(gltfFixture());
      setAvaturnEnabled(false);
    });
    await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
    t.is(uploadedFiles.length, 0);
    t.falsy(h.container.querySelector('[data-testid="avaturn-creator"]'));
    t.regex(h.container.textContent, /no está disponible/);
    await privateEditor.submit();
    t.deepEqual(parsedFiles, [normalFile]);
    t.is(savedAvatars.length, 1);
    t.true(
      uploadSignals.every(signal => signal === undefined),
      "ordinary GLB uploads do not inherit Avaturn cancellation"
    );
  }
);

test.serial(
  "OFF aborts only the mounted Avaturn media requests and a late upload cannot create an avatar after ON",
  async t => {
    let release;
    uploadBarrier = new Promise(resolve => (release = resolve));
    let callbacks = 0;
    const h = await mount(t, "avaturn", () => callbacks++);
    await act(async () => {
      h.editor.handleAvaturnExportStart();
      await h.editor.acceptAvaturnFile(headerFile());
    });
    await h.ready();
    await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
    t.is(uploadSignals.length, 3);
    t.true(uploadSignals.every(signal => signal && !signal.aborted));
    await act(async () => {
      setAvaturnEnabled(false);
      t.true(
        uploadSignals.every(signal => signal.aborted),
        "actual editor upload callsites share its revocable signal"
      );
      setAvaturnEnabled(true);
      release();
      await new Promise(resolve => setImmediate(resolve));
    });
    t.is(saveSignals.length, 0);
    t.is(savedAvatars.length, 0);
    t.is(callbacks, 0);
    t.falsy(h.editor.state.avaturnSaveState);
    t.false(h.editor.state.uploading);
    t.false(h.editor.uploadInFlight);
  }
);

test.serial("an old Avaturn header rejected after OFF-ON cannot clear the new export's pending autosave", async t => {
  const h = await mount(t, "avaturn");
  const old = await deferredHeaderFile();
  let acceptingOld;
  await act(async () => {
    h.editor.handleAvaturnExportStart();
    acceptingOld = h.editor.acceptAvaturnFile(old.file);
  });
  const newest = headerFile("after-on.glb");
  await act(async () => {
    setAvaturnEnabled(false);
    setAvaturnEnabled(true);
    h.editor.handleAvaturnExportStart();
    t.true(await h.editor.acceptAvaturnFile(newest));
  });
  t.true(h.editor.avaturnAutoSavePending);
  const newestPreviewUrl = h.editor.state.previewGltfUrl;
  await act(async () => {
    old.release();
    t.false(await acceptingOld);
  });
  t.true(h.editor.avaturnAutoSavePending, "the stale A rejection cannot revoke B's accepted autosave");
  t.is(h.editor.inputFiles.glb, newest);
  t.is(h.editor.state.previewGltfUrl, newestPreviewUrl);
  t.is(urls.get(newestPreviewUrl), newest);
  t.is(savedAvatars.length, 0);
  await h.ready();
  await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
  t.deepEqual(parsedFiles, [newest]);
  t.is(savedAvatars.length, 1);
  t.is(h.editor.state.avaturnSaveState, "saved");
});

test.serial(
  "OFF aborts the Avaturn avatar save and ignores its late response after ON without claiming server rollback",
  async t => {
    let release;
    saveBarrier = new Promise(resolve => (release = resolve));
    let callbacks = 0;
    const h = await mount(t, "avaturn", () => callbacks++);
    await act(async () => {
      h.editor.handleAvaturnExportStart();
      await h.editor.acceptAvaturnFile(headerFile());
    });
    await h.ready();
    await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
    t.is(saveSignals.length, 1);
    const signal = saveSignals[0];
    t.false(signal.aborted);
    await act(async () => {
      setAvaturnEnabled(false);
      t.true(signal.aborted);
      setAvaturnEnabled(true);
      release();
      await new Promise(resolve => setImmediate(resolve));
    });
    t.is(savedAvatars.length, 1, "an abort cannot undo a write the server may already have made");
    t.falsy(h.editor.savedAvaturn, "the stale response cannot update the live editor");
    t.falsy(h.editor.state.avaturnSaveState);
    t.false(h.editor.state.uploading);
    t.is(callbacks, 0);
  }
);
