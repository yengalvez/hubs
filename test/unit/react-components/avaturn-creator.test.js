import test from "ava";

require("../../../scripts/shim");

const Module = require("module");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = require("react-dom/test-utils");
const { IntlProvider } = require("react-intl");
const configs = require("../../../src/utils/configs").default;
const phoenixUtilsPath = require.resolve("../../../src/utils/phoenix-utils");
require.cache[phoenixUtilsPath] = { id: phoenixUtilsPath, filename: phoenixUtilsPath, loaded: true, exports: {} };
const HubChannel = require("../../../src/utils/hub-channel").default;
const { Socket } = require("phoenix");

let sdkInstance;
let hub;
let transport;
let initialization;
let exportWork;
let receivedSignal;
let sdkLoads = 0;
const exportedFile = { name: "validated.glb" };

class FakeAvaturnSDK {
  callbacks = {};
  destroyed = false;

  constructor() {
    sdkInstance = this;
  }

  async init(container, options) {
    this.container = container;
    this.options = options;
    if (initialization) await initialization;
    return this;
  }

  on(name, callback) {
    this.callbacks[name] = callback;
    return this;
  }

  destroy() {
    this.destroyed = true;
  }
}

const stubs = {
  "../utils/avaturn-sdk": {
    loadAvaturnSdk: async () => {
      sdkLoads++;
      return new FakeAvaturnSDK();
    }
  },
  "../utils/avaturn-utils": {
    ...require("../../../src/utils/avaturn-utils"),
    avaturnExportToFile: async (_result, _url, { signal }) => {
      receivedSignal = signal;
      if (exportWork) return exportWork;
      return exportedFile;
    }
  }
};
const originalLoad = Module._load;
Module._load = function loadAvaturnWithIsolatedSdk(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, parent, isMain);
};
let AvaturnCreator;
try {
  AvaturnCreator = require("../../../src/react-components/avaturn-creator").default;
} finally {
  Module._load = originalLoad;
}

const originalAct = global.IS_REACT_ACT_ENVIRONMENT;
test.before(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
});
test.after.always(() => {
  global.IS_REACT_ACT_ENVIRONMENT = originalAct;
});

function setAvaturnEnabled(enabled) {
  transport.trigger("product_modules_changed", { bots_enabled: true, ai_enabled: true, avaturn_enabled: enabled });
}

test.beforeEach(() => {
  hub = new HubChannel({ state: { credentials: {} }, addEventListener() {} }, "avaturn-profile");
  transport = new Socket("wss://local.invalid/socket").channel("hub:avaturn-profile", {});
  hub.setChannel(transport);
  setAvaturnEnabled(true);
  initialization = exportWork = receivedSignal = null;
  sdkLoads = 0;
});
test.afterEach.always(async () => act(async () => hub.disconnect()));

function component(props = {}) {
  const instance = new AvaturnCreator({
    creatorUrl: "https://yenhubs.avaturn.dev",
    onExport: async () => true,
    ...props
  });
  instance.container = document.createElement("div");
  instance.setState = update => {
    instance.state = { ...instance.state, ...update };
  };
  return instance;
}

test.serial("the embedded editor turns Avaturn Next into one validated YenHubs export", async t => {
  sdkInstance = null;
  const events = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <IntlProvider locale="en">
        <AvaturnCreator
          creatorUrl="https://yenhubs.avaturn.dev"
          onExportStart={() => events.push("start")}
          onExport={async file => {
            events.push(file);
            return true;
          }}
        />
      </IntlProvider>
    );
    await new Promise(resolve => setImmediate(resolve));
  });

  t.truthy(sdkInstance);
  t.deepEqual(sdkInstance.options, {
    url: "https://yenhubs.avaturn.dev",
    iframeClassName: "avaturn-sdk-frame"
  });
  t.truthy(sdkInstance.callbacks.export);

  await act(async () => {
    await sdkInstance.callbacks.export({ urlType: "dataURL", url: "data:fixture" });
  });
  t.deepEqual(events, ["start", exportedFile]);
  t.regex(container.textContent, /Avatar received correctly/);

  await act(async () => root.unmount());
  t.true(sdkInstance.destroyed);
  container.remove();
});

test.serial("a development remount cannot let the discarded SDK replace the active one", async t => {
  sdkInstance = null;
  const component = new AvaturnCreator({
    creatorUrl: "https://yenhubs.avaturn.dev",
    onExport: async () => true
  });
  component.container = document.createElement("div");
  component.setState = update => {
    component.state = { ...component.state, ...update };
  };

  const firstMount = component.componentDidMount();
  await new Promise(resolve => setImmediate(resolve));
  const firstSdk = sdkInstance;
  component.componentWillUnmount();
  const secondMount = component.componentDidMount();
  await new Promise(resolve => setImmediate(resolve));
  const secondSdk = sdkInstance;

  await Promise.all([firstMount, secondMount]);

  t.not(firstSdk, secondSdk);
  t.true(firstSdk.destroyed);
  t.false(secondSdk.destroyed);
  t.truthy(secondSdk.callbacks.export);

  component.componentWillUnmount();
  t.true(secondSdk.destroyed);
});

test.serial("OFF and invalid URLs do not even load the SDK on direct mount", async t => {
  setAvaturnEnabled(false);
  const off = component();
  await off.componentDidMount();
  t.is(off.state.status, "unavailable");
  t.is(sdkLoads, 0);
  // These are separate direct-mount cases. Leaving the OFF fixture subscribed
  // would legitimately reactivate it when enabling the invalid-URL case.
  off.componentWillUnmount();
  setAvaturnEnabled(true);
  const invalid = component({ creatorUrl: "https://evil.example" });
  await invalid.componentDidMount();
  t.is(sdkLoads, 0);
  invalid.componentWillUnmount();
});

test.serial("two Next events in one tick and after receipt deliver only once", async t => {
  let calls = 0;
  const instance = component({
    onExport: async () => {
      calls++;
      return true;
    }
  });
  await instance.componentDidMount();
  await Promise.all([instance.handleExport({}), instance.handleExport({})]);
  await instance.handleExport({});
  t.is(calls, 1);
  sdkInstance.callbacks.error();
  t.is(instance.state.status, "received", "a late provider error cannot undo a received export");
  instance.componentWillUnmount();
});

test.serial("an export failure permits a deliberate retry", async t => {
  let calls = 0;
  const instance = component({ onExport: async () => ++calls > 1 });
  await instance.componentDidMount();
  await instance.handleExport({});
  t.is(instance.state.status, "error");
  await instance.handleExport({});
  t.is(instance.state.status, "received");
  t.is(calls, 2);
  instance.componentWillUnmount();
});

test.serial("a downstream preview rejection unlocks a new export but a saved avatar stays terminal", async t => {
  let exports = 0;
  const instance = component({
    onExport: async () => {
      exports++;
      return true;
    }
  });
  await instance.componentDidMount();
  await instance.handleExport({});
  t.is(instance.state.status, "received");
  t.true(instance.exportLocked);
  const acceptedProps = instance.props;
  instance.props = { ...instance.props, validationError: "Esqueleto incompatible" };
  instance.componentDidUpdate(acceptedProps);
  t.is(instance.state.status, "error");
  t.is(instance.state.error, "Esqueleto incompatible");
  t.false(instance.exportLocked);
  const errorProps = instance.props;
  instance.props = { ...instance.props, validationError: null };
  instance.componentDidUpdate(errorProps);
  await instance.handleExport({});
  t.is(exports, 2);
  t.is(instance.state.status, "received");
  t.true(instance.exportLocked);
  const retryProps = instance.props;
  instance.props = { ...instance.props, disabled: true, validationError: "late stale error" };
  instance.componentDidUpdate(retryProps);
  t.true(instance.exportLocked);
  await instance.handleExport({});
  t.is(exports, 2, "saved or saving avatars cannot start another export");
  instance.componentWillUnmount();
});

test.serial("unmount aborts download and suppresses a late export callback", async t => {
  let finish;
  let calls = 0;
  exportWork = new Promise(resolve => {
    finish = resolve;
  });
  const instance = component({
    onExport: async () => {
      calls++;
    }
  });
  await instance.componentDidMount();
  const pending = instance.handleExport({});
  instance.componentWillUnmount();
  t.true(receivedSignal.aborted);
  finish(exportedFile);
  await pending;
  t.is(calls, 0);
});

test.serial("unmount cancels an unresolved handshake; a late init cannot register callbacks", async t => {
  let finish;
  initialization = new Promise(resolve => {
    finish = resolve;
  });
  const instance = component();
  const mounting = instance.componentDidMount();
  await new Promise(resolve => setImmediate(resolve));
  const discarded = sdkInstance;
  instance.componentWillUnmount();
  await mounting;
  finish();
  await new Promise(resolve => setImmediate(resolve));
  t.true(discarded.destroyed);
  t.falsy(discarded.callbacks.export);
});

test.serial("switching OFF during a session destroys the iframe and SDK", async t => {
  const instance = component();
  await instance.componentDidMount();
  setAvaturnEnabled(false);
  t.true(sdkInstance.destroyed);
  t.is(instance.session, null);
  t.is(instance.state.status, "unavailable");
  instance.componentWillUnmount();
});

test.serial("mounted creator follows Completo to BASE and creator-only ON without manual lifecycle calls", async t => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let exports = 0;
  let finish;
  exportWork = new Promise(resolve => (finish = resolve));
  await act(async () => {
    root.render(
      <IntlProvider locale="en">
        <AvaturnCreator creatorUrl="https://yenhubs.avaturn.dev" onExport={async () => ++exports} />
      </IntlProvider>
    );
    await new Promise(resolve => setImmediate(resolve));
  });
  t.teardown(async () => {
    finish(exportedFile);
    await act(async () => root.unmount());
    container.remove();
  });
  const discarded = sdkInstance;
  let pending;
  await act(async () => {
    pending = discarded.callbacks.export({});
  });
  const signal = receivedSignal;
  await act(async () => transport.trigger("product_modules_changed", null));
  t.true(signal.aborted);
  t.true(discarded.destroyed);
  t.regex(container.textContent, /no está disponible/);
  t.is(sdkLoads, 1);

  await act(async () => {
    transport.trigger("product_modules_changed", { bots_enabled: false, ai_enabled: false, avaturn_enabled: true });
    await new Promise(resolve => setImmediate(resolve));
  });
  t.false(configs.feature("enable_room_bots"));
  t.false(configs.feature("enable_bot_chat"));
  t.is(sdkLoads, 2, "Avaturn restarts independently from bots and AI");
  t.not(sdkInstance, discarded);
  exportWork = null;
  await act(async () => {
    finish(exportedFile);
    await pending;
    await discarded.callbacks.export({});
  });
  t.is(exports, 0, "neither a held export nor a stale SDK callback is admitted after ON");
  await act(async () => sdkInstance.callbacks.export({}));
  t.is(exports, 1, "only the new live SDK can export");
});

test.serial("a batched OFF-ON pulse destroys pending SDK initialization before ON and close revokes it", async t => {
  let finish;
  initialization = new Promise(resolve => (finish = resolve));
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <IntlProvider locale="en">
        <AvaturnCreator creatorUrl="https://yenhubs.avaturn.dev" onExport={async () => true} />
      </IntlProvider>
    );
    await new Promise(resolve => setImmediate(resolve));
  });
  t.teardown(async () => {
    finish();
    await act(async () => root.unmount());
  });
  const first = sdkInstance;
  await act(async () => {
    setAvaturnEnabled(false);
    t.true(first.destroyed, "OFF cancels synchronously, before React can batch ON");
    initialization = null;
    setAvaturnEnabled(true);
    await new Promise(resolve => setImmediate(resolve));
  });
  const current = sdkInstance;
  t.not(current, first);
  t.truthy(current.callbacks.export);
  await act(async () => {
    finish();
    await new Promise(resolve => setImmediate(resolve));
  });
  t.falsy(first.callbacks.export);
  await act(async () => transport.trigger("phx_close", {}));
  t.true(current.destroyed);
  t.regex(container.textContent, /no está disponible/);
});

test.serial("init timeout destroys the stalled SDK and explicit retry initializes a fresh one", async t => {
  const originalTimeout = global.setTimeout;
  global.setTimeout = (callback, ms, ...args) => originalTimeout(callback, ms === 30000 ? 10 : ms, ...args);
  t.teardown(() => {
    global.setTimeout = originalTimeout;
  });
  initialization = new Promise(() => {});
  const instance = component();
  await instance.componentDidMount();
  const stalled = sdkInstance;
  t.true(stalled.destroyed);
  t.is(instance.state.status, "error");
  t.regex(instance.state.error, /tiempo/);
  initialization = null;
  await instance.start();
  t.not(sdkInstance, stalled);
  t.is(instance.state.status, "ready");
  instance.componentWillUnmount();
});
