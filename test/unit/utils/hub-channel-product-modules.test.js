import test from "ava";

require("../../../scripts/shim");
// Migration transport imports the application-wide TS store; this unit tests
// the real HubChannel event boundary, not socket migration or the store.
const phoenixUtilsPath = require.resolve("../../../src/utils/phoenix-utils");
require.cache[phoenixUtilsPath] = { id: phoenixUtilsPath, filename: phoenixUtilsPath, loaded: true, exports: {} };
const HubChannel = require("../../../src/utils/hub-channel").default;
const configs = require("../../../src/utils/configs").default;
const { Socket } = require("phoenix");

function moduleChannel() {
  const store = { state: { credentials: {} }, addEventListener() {} };
  const hub = new HubChannel(store, "hub-modules");
  const transport = new Socket("wss://local.invalid/socket").channel("hub:hub-modules", {});
  hub.setChannel(transport);
  return { hub, transport };
}

test.serial("product module events fail closed, rotate chat epoch and revoke on disconnect", t => {
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
  t.deepEqual(hub.productModules, { bots_enabled: false, ai_enabled: false, avaturn_enabled: false });
  const epoch = hub.botChatCapabilityEpoch;
  events.get("product_modules_changed")({ bots_enabled: true, ai_enabled: true });
  t.deepEqual(hub.productModules, { bots_enabled: true, ai_enabled: true, avaturn_enabled: false });
  t.true(hub.botChatCapabilityEpoch > epoch);
  error();
  t.false(hub.productModules.ai_enabled);
  events.get("product_modules_changed")({ bots_enabled: "true", ai_enabled: true });
  t.deepEqual(hub.productModules, { bots_enabled: false, ai_enabled: false, avaturn_enabled: false });
  events.get("product_modules_changed")({ bots_enabled: true, ai_enabled: true });
  close();
  t.false(hub.productModules.ai_enabled);
  events.get("product_modules_changed")({ bots_enabled: true, ai_enabled: true });
  hub.disconnect();
  t.false(hub.productModules.ai_enabled);
});

test.serial("the real Phoenix entry projects only the three product flags across all six profiles", t => {
  const { hub, transport } = moduleChannel();
  t.teardown(() => hub.disconnect());
  configs.APP_CONFIG.features.enable_spoke = true;
  configs.APP_CONFIG.features.max_room_size = 42;
  configs.APP_CONFIG.links = { avaturn_creator: "https://yenhubs.avaturn.dev" };
  const features = configs.APP_CONFIG.features;
  const links = configs.APP_CONFIG.links;
  for (const [bots, ai, avaturn] of [
    [false, false, false],
    [false, false, true],
    [true, false, false],
    [true, false, true],
    [true, true, false],
    [true, true, true]
  ]) {
    transport.trigger("product_modules_changed", { bots_enabled: bots, ai_enabled: ai, avaturn_enabled: avaturn });
    t.is(configs.feature("enable_room_bots"), bots);
    t.is(configs.feature("enable_bot_chat"), ai);
    t.is(configs.feature("enable_avaturn_creator"), avaturn);
  }
  t.is(configs.APP_CONFIG.features, features, "there is no second competing config/flag source");
  t.is(configs.APP_CONFIG.links, links);
  t.is(configs.link("avaturn_creator"), "https://yenhubs.avaturn.dev");
  t.true(configs.feature("enable_spoke"));
  t.is(configs.feature("max_room_size"), 42);
});

test.serial("module projection is strict, independent for Avaturn, and revokes missing payloads and disconnects", t => {
  const { hub, transport } = moduleChannel();
  t.teardown(() => hub.disconnect());
  transport.trigger("product_modules_changed", { bots_enabled: false, ai_enabled: true, avaturn_enabled: true });
  t.false(configs.feature("enable_room_bots"));
  t.false(configs.feature("enable_bot_chat"));
  t.true(configs.feature("enable_avaturn_creator"));
  for (const payload of [null, undefined, {}, { bots_enabled: "true", ai_enabled: 1, avaturn_enabled: "true" }]) {
    transport.trigger("product_modules_changed", payload);
    t.false(configs.feature("enable_room_bots"));
    t.false(configs.feature("enable_bot_chat"));
    t.false(configs.feature("enable_avaturn_creator"));
  }
  transport.trigger("product_modules_changed", { bots_enabled: true, ai_enabled: true, avaturn_enabled: true });
  transport.trigger("phx_error", {});
  t.false(configs.feature("enable_avaturn_creator"));
  transport.trigger("product_modules_changed", { bots_enabled: true, ai_enabled: true, avaturn_enabled: true });
  transport.trigger("phx_close", {});
  t.false(configs.feature("enable_avaturn_creator"));
  transport.trigger("product_modules_changed", { bots_enabled: true, ai_enabled: true, avaturn_enabled: true });
  hub.disconnect();
  t.false(configs.feature("enable_room_bots"));
  t.false(configs.feature("enable_bot_chat"));
  t.false(configs.feature("enable_avaturn_creator"));
});

test.serial("OFF-ON notifies synchronously and rotates both admission epochs even with the same token", t => {
  const { hub, transport } = moduleChannel();
  t.teardown(() => hub.disconnect());
  hub.configureBotChatCapability("A".repeat(32));
  const profile = { bots_enabled: true, ai_enabled: true, avaturn_enabled: true };
  transport.trigger("product_modules_changed", profile);
  const capabilityEpoch = hub.botChatCapabilityEpoch;
  const creatorEpoch = configs.avaturnCreatorEpoch;
  const observed = [];
  const unsubscribe = configs.subscribeToProductModules(() => observed.push(configs.feature("enable_avaturn_creator")));
  transport.trigger("product_modules_changed", null);
  transport.trigger("product_modules_changed", profile);
  unsubscribe();
  t.deepEqual(observed, [false, true]);
  t.is(hub.botChatCapabilityEpoch, capabilityEpoch + 2);
  t.is(configs.avaturnCreatorEpoch, creatorEpoch + 2);
});

test.serial(
  "a projection listener failure cannot skip later OFF revocation or the existing chat admission rotation",
  t => {
    const { hub, transport } = moduleChannel();
    t.teardown(() => hub.disconnect());
    hub.configureBotChatCapability("A".repeat(32));
    transport.trigger("product_modules_changed", { bots_enabled: true, ai_enabled: true, avaturn_enabled: true });
    const epoch = hub.botChatCapabilityEpoch;
    const unsubscribe = configs.subscribeToProductModules(() => {
      throw new Error("fixture-listener-failure");
    });
    let revocations = 0;
    const unsubscribeRevoker = configs.subscribeToProductModules(() => {
      if (configs.feature("enable_avaturn_creator") === false) revocations++;
    });
    try {
      t.throws(() => transport.trigger("product_modules_changed", null), {
        message: "fixture-listener-failure"
      });
      t.is(revocations, 1, "a later listener still receives the OFF revocation after the first listener throws");
      t.false(configs.feature("enable_avaturn_creator"));
      t.is(hub.botChatCapabilityEpoch, epoch + 1);
    } finally {
      unsubscribe();
      unsubscribeRevoker();
    }
  }
);
