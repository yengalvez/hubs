import test from "ava";

require("../../../scripts/shim");

const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const { parseSync } = require("@babel/core");
const configs = require("../../../src/utils/configs").default;
const { normalizeAvaturnCreatorUrl } = require("../../../src/utils/avaturn-utils");
const phoenixUtilsPath = require.resolve("../../../src/utils/phoenix-utils");
require.cache[phoenixUtilsPath] = { id: phoenixUtilsPath, filename: phoenixUtilsPath, loaded: true, exports: {} };
const HubChannel = require("../../../src/utils/hub-channel").default;
const { Socket } = require("phoenix");

// Install the actual action registration from hub.js; do not execute full
// room boot/WebGL or a real login. This is a source-boundary unit, not cold
// browser acceptance. Its module events, configs and window action are real.
const source = readFileSync(require.resolve("../../../src/hub"), "utf8");
const ast = parseSync(source, {
  configFile: false,
  babelrc: false,
  sourceType: "module",
  parserOpts: { plugins: ["jsx"] }
});
const registrations = [];
function findRegistration(node) {
  if (!node || typeof node !== "object") return;
  if (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.object.name === "window" &&
    node.callee.property.name === "addEventListener" &&
    node.arguments[0]?.value === "action_create_avaturn_avatar"
  ) {
    registrations.push(node);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(findRegistration);
    else if (value && typeof value === "object") findRegistration(value);
  }
}
findRegistration(ast.program);

function admission(t) {
  t.is(registrations.length, 1, "test the single production action handler");
  const hub = new HubChannel({ state: { credentials: {} }, addEventListener() {} }, "avatar-admission");
  const transport = new Socket("wss://local.invalid/socket").channel("hub:avatar-admission", {});
  hub.setChannel(transport);
  configs.APP_CONFIG.links = { avaturn_creator: "https://yenhubs.avaturn.dev" };
  const actions = [];
  const overlays = [];
  let listener;
  const node = registrations[0];
  runInNewContext(source.slice(node.start, node.end), {
    window: {
      addEventListener(name, callback) {
        listener = callback;
        window.addEventListener(name, callback);
      }
    },
    configs,
    normalizeAvaturnCreatorUrl,
    hubChannel: hub,
    history: {},
    performConditionalSignIn: (_predicate, action) => actions.push(action),
    pushHistoryState: (...args) => overlays.push(args),
    SignInMessages: { createAvatar: {} }
  });
  t.teardown(() => {
    window.removeEventListener("action_create_avaturn_avatar", listener);
    hub.disconnect();
  });
  return {
    transport,
    actions,
    overlays,
    profile(enabled) {
      transport.trigger("product_modules_changed", {
        bots_enabled: false,
        ai_enabled: false,
        avaturn_enabled: enabled
      });
    },
    request() {
      window.dispatchEvent(new window.CustomEvent("action_create_avaturn_avatar"));
    }
  };
}

test.serial("login completion after Avaturn OFF cannot admit the old editor callback", t => {
  const h = admission(t);
  h.profile(true);
  h.request();
  t.is(h.actions.length, 1);
  h.profile(false);
  h.actions[0]();
  h.request();
  t.is(h.actions.length, 1, "OFF also rejects new admission before login");
  t.is(h.overlays.length, 0);
});

test.serial("OFF-ON rejects the deferred old login callback, while a fresh creator-only request can enter", t => {
  const h = admission(t);
  h.profile(true);
  h.request();
  h.profile(false);
  h.profile(true);
  h.actions[0]();
  t.is(h.overlays.length, 0);
  h.request();
  h.actions[1]();
  t.is(h.overlays.length, 1);
  t.is(h.overlays[0][1], "overlay");
  t.is(h.overlays[0][2], "avatar-editor");
  t.is(h.overlays[0][3].mode, "avaturn");
  t.false(configs.feature("enable_room_bots"));
  t.false(configs.feature("enable_bot_chat"));
});

test.serial("lost channel authority revokes a pending Avaturn login completion", t => {
  const h = admission(t);
  h.profile(true);
  h.request();
  h.transport.trigger("phx_error", {});
  h.actions[0]();
  t.is(h.overlays.length, 0);
});

test.serial("bot and AI changes alone do not revoke an independent Avaturn login admission", t => {
  const h = admission(t);
  h.transport.trigger("product_modules_changed", { bots_enabled: true, ai_enabled: true, avaturn_enabled: true });
  h.request();
  h.profile(true);
  h.actions[0]();
  t.is(h.overlays.length, 1);
  t.false(configs.feature("enable_room_bots"));
  t.false(configs.feature("enable_bot_chat"));
});
