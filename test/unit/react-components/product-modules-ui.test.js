/* eslint-disable react/prop-types */

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
const originalAFRAME = global.AFRAME;
global.AFRAME = { utils: { device: { isMobile: () => false, isMobileVR: () => false } } };

// Mount the actual flag consumers, form and action tiles. Scene/URL modals
// and their unused transports are isolated; configs and HubChannel are real.
const stubs = {
  "./RoomSidebar": { SceneInfo: () => null },
  "../storage/media-search-store": { SOURCES: [] },
  "./room/AvatarUrlModalContainer": { AvatarUrlModalContainer: () => null },
  "./room/SceneUrlModalContainer": { SceneUrlModalContainer: () => null },
  "./room/ObjectUrlModalContainer": { ObjectUrlModalContainer: () => null },
  "./room/MediaBrowser": { MediaBrowser: ({ children }) => <div>{children}</div> },
  "../utils/avatar-utils": { remixAvatar() {} },
  "../utils/phoenix-utils": { getReticulumFetchUrl: value => value },
  "../utils/media-url-utils": { proxiedUrlFor: value => value, scaledThumbnailUrlFor: value => value },
  "./auth/SignInModal": { SignInMessages: {} }
};
const originalLoad = Module._load;
Module._load = function loadModuleConsumers(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  if (request.endsWith(".svg")) return { ReactComponent: () => <svg /> };
  return originalLoad.call(this, request, parent, isMain);
};
let MediaBrowserContainer;
let RoomSettingsSidebar;
try {
  MediaBrowserContainer = require("../../../src/react-components/media-browser").default;
  RoomSettingsSidebar = require("../../../src/react-components/room/RoomSettingsSidebar").RoomSettingsSidebar;
} finally {
  Module._load = originalLoad;
}

const originalAct = global.IS_REACT_ACT_ENVIRONMENT;
const originalCustomEvent = global.CustomEvent;
const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
test.before(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  // Production browser constructors share the DOM realm. The Node shim keeps
  // Node's built-in CustomEvent, which JSDOM window.dispatchEvent rejects.
  global.CustomEvent = window.CustomEvent;
  // Textarea autosize subscribes to FontFaceSet.loadingdone. JSDOM has no
  // FontFaceSet; give it a real DOM event target without replacing the input.
  if (!document.fonts) {
    Object.defineProperty(document, "fonts", { configurable: true, value: new window.EventTarget() });
  }
});
test.after.always(() => {
  global.AFRAME = originalAFRAME;
  global.IS_REACT_ACT_ENVIRONMENT = originalAct;
  global.CustomEvent = originalCustomEvent;
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else delete document.fonts;
});

async function mount(t, element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<IntlProvider locale="en">{element}</IntlProvider>));
  t.teardown(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

function moduleChannel(t) {
  const hub = new HubChannel({ state: { credentials: {} }, addEventListener() {} }, "profile-ui");
  const transport = new Socket("wss://local.invalid/socket").channel("hub:profile-ui", {});
  hub.setChannel(transport);
  configs.APP_CONFIG.links = { avaturn_creator: "https://yenhubs.avaturn.dev" };
  t.teardown(async () => act(async () => hub.disconnect()));
  return { hub, transport };
}

function profile(transport, bots, ai, avaturn) {
  transport.trigger("product_modules_changed", { bots_enabled: bots, ai_enabled: ai, avaturn_enabled: avaturn });
}

test.serial("mounted room settings remove bots and AI controls through the actual channel entry", async t => {
  const { transport } = moduleChannel(t);
  profile(transport, true, true, true);
  const container = await mount(
    t,
    <RoomSettingsSidebar
      room={{
        name: "Local room",
        description: "",
        room_size: 24,
        entry_mode: "allow",
        member_permissions: { spawn_and_move_media: true },
        user_data: {
          bots: { enabled: true, count: 1, chat_enabled: true, mobility: "static", prompt: "Local fixture" }
        }
      }}
      maxRoomSize={42}
      onSubmit={() => {}}
      onClose={() => {}}
    />
  );
  t.truthy(container.querySelector('[name="user_data.bots.enabled"]'));
  t.truthy(container.querySelector('[name="user_data.bots.chat_enabled"]'));
  t.truthy(container.querySelector('[name="user_data.bots.prompt"]'));

  await act(async () => profile(transport, true, false, true));
  t.truthy(container.querySelector('[name="user_data.bots.enabled"]'));
  t.falsy(container.querySelector('[name="user_data.bots.chat_enabled"]'));
  t.falsy(container.querySelector('[name="user_data.bots.prompt"]'));
  await act(async () => profile(transport, false, false, false));
  t.falsy(container.querySelector('[name="user_data.bots.enabled"]'));
  t.truthy(container.querySelector('[name="name"]'), "base room settings are preserved");

  await act(async () => profile(transport, false, true, true));
  t.falsy(container.querySelector('[name="user_data.bots.enabled"]'), "AI cannot bypass its bot parent");
  await act(async () => profile(transport, true, true, false));
  t.truthy(container.querySelector('[name="user_data.bots.enabled"]'));
  t.truthy(container.querySelector('[name="user_data.bots.chat_enabled"]'));
  await act(async () => transport.trigger("phx_error", {}));
  t.falsy(container.querySelector('[name="user_data.bots.enabled"]'));
});

test.serial("mounted avatar browser removes and restores only Avaturn while keeping GLB import admitted", async t => {
  const { hub, transport } = moduleChannel(t);
  profile(transport, true, true, true);
  const mediaSearchStore = {
    result: { entries: [] },
    addEventListener() {},
    removeEventListener() {}
  };
  const container = await mount(
    t,
    <MediaBrowserContainer
      mediaSearchStore={mediaSearchStore}
      history={{ location: { pathname: "/room/media/avatars", search: "?media_source=avatars" } }}
      hubChannel={hub}
      showNonHistoriedDialog={() => {}}
      scene={{}}
      store={{}}
    />
  );
  const action = text =>
    [...container.querySelectorAll('button, [role="button"]')].find(button => button.textContent.includes(text));
  const admissions = [];
  const avaturnAction = () => admissions.push("avaturn");
  const glbAction = () => admissions.push("glb");
  window.addEventListener("action_create_avaturn_avatar", avaturnAction);
  window.addEventListener("action_create_private_glb_avatar", glbAction);
  t.teardown(() => {
    window.removeEventListener("action_create_avaturn_avatar", avaturnAction);
    window.removeEventListener("action_create_private_glb_avatar", glbAction);
  });
  const staleAvaturnButton = action("Create with Avaturn");
  t.truthy(staleAvaturnButton);
  t.truthy(action("Upload GLB"));
  await act(async () => {
    profile(transport, false, false, false);
    staleAvaturnButton.click();
  });
  t.deepEqual(admissions, [], "even the pre-render button closure checks current admission");
  t.falsy(action("Create with Avaturn"));
  await act(async () => action("Upload GLB").click());
  t.deepEqual(admissions, ["glb"]);
  await act(async () => profile(transport, false, false, true));
  t.truthy(action("Create with Avaturn"));
  await act(async () => action("Create with Avaturn").click());
  t.deepEqual(admissions, ["glb", "avaturn"]);
  await act(async () => transport.trigger("product_modules_changed", {}));
  t.falsy(action("Create with Avaturn"));
  t.truthy(action("Upload GLB"));
});
