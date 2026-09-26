import test from "ava";

require("../../../scripts/shim");
// Migration transport imports the application-wide TS store; this unit tests
// the real HubChannel event boundary, not socket migration or the store.
const phoenixUtilsPath = require.resolve("../../../src/utils/phoenix-utils");
require.cache[phoenixUtilsPath] = { id: phoenixUtilsPath, filename: phoenixUtilsPath, loaded: true, exports: {} };
const HubChannel = require("../../../src/utils/hub-channel").default;

test("product module events fail closed, rotate chat epoch and revoke on disconnect", t => {
  const store = { state: { credentials: {} }, addEventListener() {} };
  const hub = new HubChannel(store, "hub-modules");
  const events = new Map();
  let close;
  let error;
  const channel = {
    on: (name, callback) => events.set(name, callback),
    onClose: callback => (close = callback),
    onError: callback => (error = callback),
    socket: { disconnect() {} }
  };
  hub.setChannel(channel);
  hub.configureBotChatCapability("A".repeat(32));
  t.deepEqual(hub.productModules, { bots_enabled: false, ai_enabled: false });
  const epoch = hub.botChatCapabilityEpoch;
  events.get("product_modules_changed")({ bots_enabled: true, ai_enabled: true });
  t.deepEqual(hub.productModules, { bots_enabled: true, ai_enabled: true });
  t.true(hub.botChatCapabilityEpoch > epoch);
  error();
  t.false(hub.productModules.ai_enabled);
  events.get("product_modules_changed")({ bots_enabled: "true", ai_enabled: true });
  t.deepEqual(hub.productModules, { bots_enabled: false, ai_enabled: false });
  events.get("product_modules_changed")({ bots_enabled: true, ai_enabled: true });
  close();
  t.false(hub.productModules.ai_enabled);
  events.get("product_modules_changed")({ bots_enabled: true, ai_enabled: true });
  hub.disconnect();
  t.false(hub.productModules.ai_enabled);
});
