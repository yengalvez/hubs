import test from "ava";

require("../../../scripts/shim");

const Module = require("module");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = require("react-dom/test-utils");
const { IntlProvider } = require("react-intl");

let sdkInstance;
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
  "@avaturn/sdk": { AvaturnSDK: FakeAvaturnSDK },
  "../utils/avaturn-utils": {
    normalizeAvaturnCreatorUrl: value => value,
    avaturnExportToFile: async () => exportedFile
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
  const firstSdk = sdkInstance;
  component.componentWillUnmount();
  const secondMount = component.componentDidMount();
  const secondSdk = sdkInstance;

  await Promise.all([firstMount, secondMount]);

  t.not(firstSdk, secondSdk);
  t.true(firstSdk.destroyed);
  t.false(secondSdk.destroyed);
  t.truthy(secondSdk.callbacks.export);

  component.componentWillUnmount();
  t.true(secondSdk.destroyed);
});
