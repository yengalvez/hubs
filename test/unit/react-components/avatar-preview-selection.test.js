import test from "ava";

require("../../../scripts/shim");
global.THREE = require("three");

const Module = require("module");
const stubs = {
  "../utils/theme": { onThemeChanged: () => () => {}, getThemeColor: () => "#000" },
  "three/examples/jsm/controls/OrbitControls": { OrbitControls: class {} },
  "../components/environment-map": { createDefaultEnvironmentMap: () => null },
  "../components/gltf-model-plus": { loadGLTF: async () => null },
  "../utils/three-utils": {
    findNode: (root, predicate) => {
      let found;
      root.traverse(node => {
        if (!found && predicate(node)) found = node;
      });
      return found;
    }
  },
  "../utils/avatar-utils": { ensureAvatarMaterial: value => value, MAT_NAME: "AvatarMaterial" },
  "../utils/avatar-creator-garment-fit": { fitCreatorJackets: () => {} },
  "../utils/image-bitmap-utils": {
    createImageBitmap: async value => value,
    disposeImageBitmap: image => image.close && image.close()
  },
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function model() {
  const scene = new THREE.Group();
  const image = {
    closed: 0,
    close() {
      this.closed++;
    }
  };
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture(image) });
  material.name = "AvatarMaterial";
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  scene.add(mesh);
  const result = { scene, mesh, image, disposals: 0, animations: [] };
  scene.dispose = () => {
    result.disposals++;
  };
  return result;
}

function previewHarness(props = {}) {
  window.APP = { store: { state: { preferences: { materialQualitySetting: "medium" } } } };
  const preview = new AvatarPreview({ avatarGltfUrl: "first", ...props });
  preview.mounted = true;
  preview.loadId = 0;
  preview.scene = new THREE.Scene();
  preview.resetCamera = () => {};
  preview.setState = value => Object.assign(preview.state, value);
  return preview;
}

test.serial("twenty replacements and unmount release each owned model once, not unrelated scene resources", async t => {
  const preview = previewHarness();
  const models = [];
  let unrelatedDisposals = 0;
  const unrelated = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  unrelated.geometry.dispose = () => unrelatedDisposals++;
  preview.scene.add(unrelated);
  stubs["../components/gltf-model-plus"].loadGLTF = async () => {
    const gltf = model();
    models.push(gltf);
    return gltf;
  };
  await preview.loadCurrentAvatarGltfUrl();
  for (let i = 0; i < 20; i++) {
    const oldProps = preview.props;
    preview.props = { avatarGltfUrl: `replacement-${i}` };
    await preview.componentDidUpdate(oldProps);
    t.is(preview.previewLoads.size, 1);
  }
  let stopped = false;
  let rendererDisposed = false;
  preview.previewRenderer = {
    setAnimationLoop: value => {
      stopped = value === null;
    },
    dispose: () => {
      rendererDisposed = true;
    }
  };
  preview.componentWillUnmount();
  t.true(models.every(gltf => gltf.disposals === 1 && gltf.image.closed === 1));
  t.is(preview.previewLoads.size, 0);
  t.is(preview.mixer, null);
  t.is(preview.avatar, null);
  t.true(stopped && rendererDisposed);
  t.is(unrelatedDisposals, 0);
});

test.serial("late old GLB cannot replace or dispose the current model", async t => {
  const old = deferred();
  const oldModel = model();
  const currentModel = model();
  const loaded = [];
  const preview = previewHarness({ onGltfLoaded: gltf => loaded.push(gltf) });
  stubs["../components/gltf-model-plus"].loadGLTF = url =>
    url === "first" ? old.promise : Promise.resolve(currentModel);
  const pending = preview.loadCurrentAvatarGltfUrl();
  const oldProps = preview.props;
  preview.props = { ...oldProps, avatarGltfUrl: "current" };
  await preview.componentDidUpdate(oldProps);
  old.resolve(oldModel);
  await pending;
  t.is(preview.avatar, currentModel.scene);
  t.is(preview.previewResources.previewMesh, currentModel.mesh);
  t.deepEqual(loaded, [currentModel]);
  t.is(oldModel.disposals, 1);
  t.is(oldModel.image.closed, 1);
  t.is(currentModel.disposals, 0);
  preview.componentWillUnmount();
});

test.serial("GLB completion after unmount releases resources without publishing a model", async t => {
  const load = deferred();
  const gltf = model();
  let loaded = false;
  const preview = previewHarness({
    onGltfLoaded: () => {
      loaded = true;
    }
  });
  stubs["../components/gltf-model-plus"].loadGLTF = () => load.promise;
  const pending = preview.loadCurrentAvatarGltfUrl();
  preview.componentWillUnmount();
  load.resolve(gltf);
  await pending;
  t.is(gltf.disposals, 1);
  t.is(gltf.image.closed, 1);
  t.false(loaded);
  t.is(preview.previewLoads.size, 0);
});

test.serial("late environment map is disposed after unmount without double-disposing the scene", async t => {
  const environment = deferred();
  const gltf = model();
  const preview = previewHarness();
  window.APP.store.state.preferences.materialQualitySetting = "high";
  stubs["../components/gltf-model-plus"].loadGLTF = async () => gltf;
  stubs["../components/environment-map"].createDefaultEnvironmentMap = () => environment.promise;
  const pending = preview.loadCurrentAvatarGltfUrl();
  await Promise.resolve();
  preview.componentWillUnmount();
  let disposed = 0;
  environment.resolve({ dispose: () => disposed++ });
  await pending;
  t.is(disposed, 1);
  t.is(gltf.disposals, 1);
  t.is(gltf.mesh.material.envMap, null);
});

test.serial("invalid loaded model is disposed and reports failure", async t => {
  const gltf = model();
  gltf.mesh.material.name = "not-an-avatar";
  const preview = previewHarness();
  stubs["../components/gltf-model-plus"].loadGLTF = async () => gltf;
  await t.throwsAsync(preview.loadPreviewAvatar("invalid", 0), { message: "Failed to find avatar preview mesh." });
  t.is(gltf.disposals, 1);
  t.is(gltf.image.closed, 1);
  t.is(preview.previewLoads.size, 0);
});

test.serial("owned jacket clone, skeleton and mixer are released alongside the loader scene", async t => {
  const gltf = model();
  gltf.animations = [new THREE.AnimationClip("idle_eyes", 1, [])];
  let geometryDisposals = 0;
  let skeletonDisposals = 0;
  gltf.mesh.skeleton = { dispose: () => skeletonDisposals++ };
  stubs["../components/gltf-model-plus"].loadGLTF = async () => gltf;
  stubs["../utils/avatar-creator-garment-fit"].fitCreatorJackets = scene => {
    scene.children[0].geometry = gltf.mesh.geometry.clone();
    gltf.mesh.geometry.dispose = () => geometryDisposals++;
  };
  try {
    const preview = previewHarness();
    await preview.loadCurrentAvatarGltfUrl();
    const mixer = preview.mixer;
    t.is(mixer.stats.actions.inUse, 1);
    preview.componentWillUnmount();
    t.is(mixer.stats.actions.inUse, 0);
    t.is(mixer.stats.actions.total, 0);
    t.is(geometryDisposals, 1);
    t.is(skeletonDisposals, 1);
    t.is(gltf.disposals, 1);
  } finally {
    stubs["../utils/avatar-creator-garment-fit"].fitCreatorJackets = () => {};
  }
});

test.serial("late custom bitmap after unmount is closed and never applied", async t => {
  const bitmap = deferred();
  const gltf = model();
  const preview = previewHarness({ base_map: new File([], "custom.png") });
  stubs["../components/gltf-model-plus"].loadGLTF = async () => gltf;
  stubs["../utils/image-bitmap-utils"].createImageBitmap = () => bitmap.promise;
  try {
    const pending = preview.loadCurrentAvatarGltfUrl();
    await Promise.resolve();
    preview.componentWillUnmount();
    let closed = 0;
    bitmap.resolve({ close: () => closed++ });
    await pending;
    t.is(closed, 1);
    t.is(gltf.disposals, 1);
    t.is(gltf.mesh.material.map.image, gltf.image);
  } finally {
    stubs["../utils/image-bitmap-utils"].createImageBitmap = async value => value;
  }
});

test.serial("out-of-order custom bitmaps cannot overwrite the latest edit", async t => {
  const gltf = model();
  const preview = previewHarness();
  stubs["../components/gltf-model-plus"].loadGLTF = async () => gltf;
  await preview.loadCurrentAvatarGltfUrl();
  const first = deferred();
  const second = deferred();
  const fileA = new File([], "a.png");
  const fileB = new File([], "b.png");
  stubs["../utils/image-bitmap-utils"].createImageBitmap = file => (file === fileA ? first.promise : second.promise);
  try {
    let closedA = 0;
    let closedB = 0;
    const imageB = { close: () => closedB++ };
    const pendingA = preview.applyMaps({}, { base_map: fileA });
    const pendingB = preview.applyMaps({ base_map: fileA }, { base_map: fileB });
    second.resolve(imageB);
    await pendingB;
    first.resolve({ close: () => closedA++ });
    await pendingA;
    t.is(gltf.mesh.material.map.image, imageB);
    t.is(closedA, 1);
    t.is(closedB, 0);
    preview.componentWillUnmount();
    t.is(closedB, 1);
    t.is(gltf.image.closed, 1);
  } finally {
    stubs["../utils/image-bitmap-utils"].createImageBitmap = async value => value;
  }
});

test.serial("replacing a parsed model retires it immediately while its environment map is pending", async t => {
  const environment = deferred();
  const oldModel = model();
  const currentModel = model();
  const preview = previewHarness();
  window.APP.store.state.preferences.materialQualitySetting = "high";
  stubs["../components/gltf-model-plus"].loadGLTF = async url => (url === "first" ? oldModel : currentModel);
  let environmentLoads = 0;
  let oldMapDisposals = 0;
  let newMapDisposals = 0;
  const newMap = { dispose: () => newMapDisposals++ };
  stubs["../components/environment-map"].createDefaultEnvironmentMap = () =>
    environmentLoads++ === 0 ? environment.promise : Promise.resolve(newMap);
  const pending = preview.loadCurrentAvatarGltfUrl();
  await Promise.resolve();
  const oldProps = preview.props;
  preview.props = { avatarGltfUrl: "current" };
  await preview.componentDidUpdate(oldProps);
  t.is(oldModel.disposals, 1);
  t.is(preview.avatar, currentModel.scene);
  environment.resolve({ dispose: () => oldMapDisposals++ });
  await pending;
  t.is(oldMapDisposals, 1);
  t.is(oldModel.disposals, 1);
  t.is(currentModel.mesh.material.envMap, newMap);
  t.is(newMapDisposals, 0);
  preview.componentWillUnmount();
  t.is(newMapDisposals, 1);
});

test.serial("map changes while the environment loads are reconciled before publishing the preview", async t => {
  const environment = deferred();
  const bitmap = deferred();
  const requested = deferred();
  const gltf = model();
  let loaded = false;
  const preview = previewHarness({
    onGltfLoaded: () => {
      loaded = true;
    }
  });
  window.APP.store.state.preferences.materialQualitySetting = "high";
  stubs["../components/gltf-model-plus"].loadGLTF = async () => gltf;
  stubs["../components/environment-map"].createDefaultEnvironmentMap = () => environment.promise;
  const originalFetch = global.fetch;
  global.fetch = async url => {
    t.is(url, "replacement.png");
    return { blob: async () => ({}) };
  };
  stubs["../utils/image-bitmap-utils"].createImageBitmap = () => {
    requested.resolve();
    return bitmap.promise;
  };
  try {
    const pending = preview.loadCurrentAvatarGltfUrl();
    await Promise.resolve();
    const oldProps = preview.props;
    preview.props = { ...oldProps, base_map: "replacement.png" };
    await preview.componentDidUpdate(oldProps);
    environment.resolve({ dispose: () => {} });
    await requested.promise;
    t.true(preview.state.loading);
    t.false(loaded);
    const replacement = { close: () => {} };
    bitmap.resolve(replacement);
    await pending;
    t.is(gltf.mesh.material.map.image, replacement);
    t.false(preview.state.loading);
    t.true(loaded);
    preview.componentWillUnmount();
  } finally {
    global.fetch = originalFetch;
    stubs["../utils/image-bitmap-utils"].createImageBitmap = async value => value;
  }
});

test.serial("map removal during reconciliation wins over the pending replacement", async t => {
  const environment = deferred();
  const bitmap = deferred();
  const requested = deferred();
  const gltf = model();
  const preview = previewHarness();
  window.APP.store.state.preferences.materialQualitySetting = "high";
  stubs["../components/gltf-model-plus"].loadGLTF = async () => gltf;
  stubs["../components/environment-map"].createDefaultEnvironmentMap = () => environment.promise;
  stubs["../utils/image-bitmap-utils"].createImageBitmap = () => {
    requested.resolve();
    return bitmap.promise;
  };
  try {
    const pending = preview.loadCurrentAvatarGltfUrl();
    await Promise.resolve();
    let oldProps = preview.props;
    preview.props = { ...oldProps, base_map: new File([], "replacement.png") };
    await preview.componentDidUpdate(oldProps);
    environment.resolve({ dispose: () => {} });
    await requested.promise;
    oldProps = preview.props;
    preview.props = { ...oldProps, base_map: null };
    await preview.componentDidUpdate(oldProps);
    let closed = 0;
    bitmap.resolve({ close: () => closed++ });
    await pending;
    t.is(gltf.mesh.material.map.image, gltf.image);
    t.is(closed, 1);
    t.false(preview.state.loading);
    preview.componentWillUnmount();
  } finally {
    stubs["../utils/image-bitmap-utils"].createImageBitmap = async value => value;
  }
});

test.serial("unmount during map reconciliation retires its model and late bitmap", async t => {
  const environment = deferred();
  const bitmap = deferred();
  const requested = deferred();
  const gltf = model();
  let loaded = false;
  const preview = previewHarness({
    onGltfLoaded: () => {
      loaded = true;
    }
  });
  window.APP.store.state.preferences.materialQualitySetting = "high";
  stubs["../components/gltf-model-plus"].loadGLTF = async () => gltf;
  stubs["../components/environment-map"].createDefaultEnvironmentMap = () => environment.promise;
  stubs["../utils/image-bitmap-utils"].createImageBitmap = () => {
    requested.resolve();
    return bitmap.promise;
  };
  try {
    const pending = preview.loadCurrentAvatarGltfUrl();
    await Promise.resolve();
    const oldProps = preview.props;
    preview.props = { ...oldProps, base_map: new File([], "replacement.png") };
    await preview.componentDidUpdate(oldProps);
    environment.resolve({ dispose: () => {} });
    await requested.promise;
    preview.componentWillUnmount();
    let closed = 0;
    bitmap.resolve({ close: () => closed++ });
    await pending;
    t.is(gltf.disposals, 1);
    t.is(closed, 1);
    t.false(loaded);
    t.is(preview.avatar, null);
  } finally {
    stubs["../utils/image-bitmap-utils"].createImageBitmap = async value => value;
  }
});

test("component resize refits the camera and ignores a hidden canvas", t => {
  const preview = new AvatarPreview({});
  preview.canvas = { parentElement: { offsetWidth: 200, offsetHeight: 450 } };
  const sizes = [];
  preview.previewRenderer = { setSize: (...size) => sizes.push(size) };
  preview.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
  preview.controls = { target: new THREE.Vector3(0, 1, 0) };
  preview.camera.position.set(0, 1, 3);
  preview.camera.lookAt(preview.controls.target);
  preview.previewBounds = new THREE.Box3(new THREE.Vector3(-1, 0, -0.2), new THREE.Vector3(1, 2, 0.2));
  preview.resize();
  t.is(preview.camera.aspect, 200 / 450);
  t.true(preview.camera.position.z > 3);
  preview.canvas.parentElement.offsetHeight = 0;
  preview.resize();
  t.deepEqual(sizes, [[200, 450]]);
  t.is(preview.camera.aspect, 200 / 450);
});
