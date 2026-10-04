import test from "ava";

require("../../../scripts/shim");

const React = require("react");
const PropTypes = require("prop-types");
const { createRoot } = require("react-dom/client");
const { act } = require("react-dom/test-utils");
const { useBotChatRequest } = require("../../../src/react-components/room/useBotChatRequest");
// This boundary does not migrate sockets or load the application-wide TS
// store. Use the same unused-import seam as the existing HubChannel units;
// the HubChannel/Phoenix dispatch and mounted hook below are actual source.
const phoenixUtilsPath = require.resolve("../../../src/utils/phoenix-utils");
require.cache[phoenixUtilsPath] = { id: phoenixUtilsPath, filename: phoenixUtilsPath, loaded: true, exports: {} };
const HubChannel = require("../../../src/utils/hub-channel").default;
const { Socket } = require("phoenix");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CAPABILITY_A = "A".repeat(32);
const CAPABILITY_B = "B".repeat(32);
let forwardedModuleEvents;

test.before(() => {
  // Standalone Hubs stays Node-only. The root's pure cross-source driver may
  // supply ONLY the closed mapping produced by the compiled backend clause.
  const names = ["product_modules_changed", "avaturn_capabilities_changed"];
  const mapping =
    process.env.YENHUBS_TEST_MODULE_EVENT_MAP !== undefined
      ? JSON.parse(process.env.YENHUBS_TEST_MODULE_EVENT_MAP)
      : Object.fromEntries(names.map(name => [name, name]));
  if (
    !mapping ||
    typeof mapping !== "object" ||
    Array.isArray(mapping) ||
    Object.keys(mapping).length !== names.length ||
    !names.every(name => Object.prototype.hasOwnProperty.call(mapping, name) && mapping[name] === name)
  ) {
    throw new Error("invalid test-only backend event mapping");
  }
  forwardedModuleEvents = new Map(Object.entries(mapping));
});

class FakeHubChannel extends window.EventTarget {
  constructor(capability = null) {
    super();
    this.signedIn = true;
    this.botChatCapability = capability;
    this.botChatCapabilityEpoch = capability ? 1 : 0;
  }

  rotateCapability(capability) {
    this.botChatCapability = capability;
    this.botChatCapabilityEpoch += 1;
    this.dispatchEvent(
      new window.CustomEvent("bot_chat_capability_changed", {
        detail: { available: capability !== null, epoch: this.botChatCapabilityEpoch }
      })
    );
  }
}

const intl = {
  formatMessage(descriptor, values = {}) {
    return String(descriptor.defaultMessage || descriptor.id).replace("{waypoint}", values.waypoint || "");
  }
};

function Harness(props) {
  const value = useBotChatRequest(props);
  props.onValue(value);
  return null;
}

Harness.propTypes = {
  onValue: PropTypes.func.isRequired
};

function baseProps(overrides = {}) {
  return {
    scene: { querySelectorAll: () => [] },
    hubChannel: new FakeHubChannel(CAPABILITY_A),
    hubSid: "hub-a",
    botId: "bot-a",
    botName: "Bot A",
    inputValue: "hello",
    sendingDisabled: false,
    sessionEpoch: 1,
    intl,
    requestBotChat: async () => ({ reply: "reply" }),
    onInputChange() {},
    onAppendMessage() {},
    onValue() {},
    ...overrides
  };
}

async function mountHarness(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest;
  let currentProps = { ...props, onValue: value => (latest = value) };

  await act(async () => {
    root.render(<Harness {...currentProps} />);
  });

  return {
    get latest() {
      return latest;
    },
    async render(nextProps) {
      currentProps = { ...currentProps, ...nextProps };
      await act(async () => {
        root.render(<Harness {...currentProps} />);
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    }
  };
}

const submitEvent = { preventDefault() {} };

test.serial("the mounted bot-chat request hook blocks transport when the channel has no capability", async t => {
  const requests = [];
  const messages = [];
  const harness = await mountHarness(
    baseProps({
      hubChannel: new FakeHubChannel(null),
      requestBotChat: async (...args) => requests.push(args),
      onAppendMessage: message => messages.push(message)
    })
  );

  await act(async () => harness.latest.onSend(submitEvent));

  t.false(harness.latest.canChat);
  t.is(requests.length, 0);
  t.deepEqual(
    messages.map(message => message.author),
    ["user", "system"]
  );
  await harness.unmount();
});

test.serial("capability rotation aborts a stale reply and the next mounted send uses only the new value", async t => {
  const channel = new FakeHubChannel(CAPABILITY_A);
  const calls = [];
  const messages = [];
  let resolveFirst;
  const firstResponse = new Promise(resolve => (resolveFirst = resolve));
  const requestBotChat = (...args) => {
    calls.push(args);
    return calls.length === 1 ? firstResponse : Promise.resolve({ reply: "reply-from-b" });
  };
  const harness = await mountHarness(
    baseProps({
      hubChannel: channel,
      requestBotChat,
      onAppendMessage: message => messages.push(message)
    })
  );

  let firstSend;
  await act(async () => {
    firstSend = harness.latest.onSend(submitEvent);
    await Promise.resolve();
  });

  t.is(calls[0][2].bot_chat_capability, CAPABILITY_A);
  const firstSignal = calls[0][3].signal;

  await act(async () => channel.rotateCapability(CAPABILITY_B));
  t.true(firstSignal.aborted);

  await act(async () => {
    resolveFirst({ reply: "stale-reply-from-a" });
    await firstSend;
  });
  t.false(messages.some(message => message.text === "stale-reply-from-a"));

  await harness.render({ inputValue: "second message" });
  await act(async () => harness.latest.onSend(submitEvent));

  t.is(calls[1][2].bot_chat_capability, CAPABILITY_B);
  t.true(messages.some(message => message.text === "reply-from-b"));
  await harness.unmount();
});

test.serial("turning sendingDisabled on aborts transport and suppresses late replies and actions", async t => {
  let complete;
  let signal;
  const messages = [];
  const harness = await mountHarness(
    baseProps({
      requestBotChat: (_url, _method, _body, options) => {
        signal = options.signal;
        return new Promise(resolve => (complete = resolve));
      },
      onAppendMessage: message => messages.push(message)
    })
  );
  let pending;
  await act(async () => {
    pending = harness.latest.onSend(submitEvent);
  });
  await harness.render({ sendingDisabled: true });
  t.true(signal.aborted);
  t.false(harness.latest.canChat);
  t.false(harness.latest.sending);
  await act(async () => {
    complete({ reply: "late reply", action: { waypoint: "spawbot-lobby" } });
    await pending;
  });
  t.deepEqual(
    messages.map(message => message.author),
    ["user"]
  );
  await harness.unmount();
});

function actualModuleChannel() {
  const store = { state: { credentials: { token: "fixture-only" } }, addEventListener() {} };
  const hub = new HubChannel(store, "synthetic-hub");
  // Never connect/join: exercise actual Phoenix message dispatch, not a
  // network, authenticated Presence, provider or full browser acceptance.
  const socket = new Socket("wss://fixture-only.invalid/socket");
  const transport = socket.channel("hub:synthetic-hub", {});
  hub.setChannel(transport);
  hub.configureBotChatCapability(CAPABILITY_A);
  transport.trigger("product_modules_changed", { bots_enabled: true, ai_enabled: true, avaturn_enabled: true });
  return { hub, transport };
}

test.serial("actual Phoenix creator OFF-ON keeps an admitted mounted chat request and its epoch", async t => {
  const { hub, transport } = actualModuleChannel();
  const messages = [];
  let release;
  let signal;
  const harness = await mountHarness(
    baseProps({
      hubChannel: hub,
      requestBotChat: (_url, _method, _body, options) => {
        signal = options.signal;
        return new Promise(resolve => (release = resolve));
      },
      onAppendMessage: message => messages.push(message)
    })
  );
  t.teardown(async () => {
    release({ reply: "teardown-only", action: null });
    await harness.unmount();
    hub.disconnect();
  });
  let pending;
  await act(async () => {
    pending = harness.latest.onSend(submitEvent);
  });
  const epoch = hub.botChatCapabilityEpoch;
  const wireEvent = forwardedModuleEvents.get("avaturn_capabilities_changed");
  for (const enabled of [false, true]) {
    await act(async () =>
      transport.trigger(wireEvent, { bots_enabled: true, ai_enabled: true, avaturn_enabled: enabled })
    );
    t.is(hub.productModules.avaturn_enabled, enabled);
    t.false(signal.aborted);
    t.is(hub.botChatCapabilityEpoch, epoch);
    t.true(harness.latest.sending);
  }
  await act(async () => {
    release({ reply: "creator-independent-reply", action: null });
    await pending;
  });
  t.true(messages.some(message => message.text === "creator-independent-reply"));
  t.false(harness.latest.sending);
});

for (const [name, event, payloads] of [
  [
    "equal general snapshot",
    "product_modules_changed",
    [{ bots_enabled: true, ai_enabled: true, avaturn_enabled: true }]
  ],
  [
    "bots OFF-ON pulse",
    "product_modules_changed",
    [
      { bots_enabled: false, ai_enabled: false, avaturn_enabled: true },
      { bots_enabled: true, ai_enabled: true, avaturn_enabled: true }
    ]
  ],
  [
    "IA OFF-ON pulse",
    "product_modules_changed",
    [
      { bots_enabled: true, ai_enabled: false, avaturn_enabled: true },
      { bots_enabled: true, ai_enabled: true, avaturn_enabled: true }
    ]
  ],
  ["malformed creator snapshot", "avaturn_capabilities_changed", [{ bots_enabled: true, ai_enabled: true }]],
  [
    "creator bots drift",
    "avaturn_capabilities_changed",
    [{ bots_enabled: false, ai_enabled: false, avaturn_enabled: true }]
  ],
  [
    "contradictory creator snapshot",
    "avaturn_capabilities_changed",
    [{ bots_enabled: false, ai_enabled: true, avaturn_enabled: true }]
  ],
  ["channel error", "phx_error", [{}]],
  ["channel close", "phx_close", [{}]]
]) {
  test.serial(`actual Phoenix ${name} still aborts and suppresses a held mounted reply`, async t => {
    const { hub, transport } = actualModuleChannel();
    const messages = [];
    let release;
    let signal;
    const harness = await mountHarness(
      baseProps({
        hubChannel: hub,
        requestBotChat: (_url, _method, _body, options) => {
          signal = options.signal;
          return new Promise(resolve => (release = resolve));
        },
        onAppendMessage: message => messages.push(message)
      })
    );
    t.teardown(async () => {
      release({ reply: "teardown-only", action: null });
      await harness.unmount();
      hub.disconnect();
    });
    let pending;
    await act(async () => {
      pending = harness.latest.onSend(submitEvent);
    });
    const epoch = hub.botChatCapabilityEpoch;
    const wireEvent = forwardedModuleEvents.get(event) || event;
    await act(async () => {
      for (const payload of payloads) transport.trigger(wireEvent, payload);
    });
    t.true(hub.botChatCapabilityEpoch > epoch);
    t.true(signal.aborted);
    t.is(hub.botChatCapability, CAPABILITY_A, "equal-token events still revoke the local request");
    await act(async () => {
      release({ reply: "stale-held-reply", action: { waypoint: "spawbot-old" } });
      await pending;
    });
    t.deepEqual(
      messages.map(message => message.author),
      ["user"]
    );
    t.false(harness.latest.sending);
  });
}

test.serial("actual Phoenix modules control delivers in mounted hook", async t => {
  const { hub } = actualModuleChannel();
  const calls = [];
  const messages = [];
  const harness = await mountHarness(
    baseProps({
      hubChannel: hub,
      requestBotChat: async (...args) => {
        calls.push(args);
        return { reply: "current-control-reply", action: { waypoint: "spawbot-control" } };
      },
      onAppendMessage: message => messages.push(message)
    })
  );
  t.teardown(async () => {
    await harness.unmount();
    hub.disconnect();
  });
  t.true(hub.productModules.ai_enabled);
  t.true(harness.latest.canChat);
  await act(async () => harness.latest.onSend(submitEvent));
  t.is(calls.length, 1);
  t.is(calls[0][2].bot_chat_capability, CAPABILITY_A);
  t.false(calls[0][3].signal.aborted);
  t.deepEqual(
    messages.map(message => message.author),
    ["user", "bot", "system"]
  );
  t.is(messages[1].text, "current-control-reply");
  t.is(messages[2].text, "Movement requested toward spawbot-control.");
  t.false(harness.latest.sending);
});

test.serial("actual Phoenix modules OFF aborts held reply before re-enable", async t => {
  const { hub, transport } = actualModuleChannel();
  const calls = [];
  const messages = [];
  let release;
  const held = new Promise(resolve => (release = resolve));
  const harness = await mountHarness(
    baseProps({
      hubChannel: hub,
      requestBotChat: (...args) => {
        calls.push(args);
        return calls.length === 1 ? held : Promise.resolve({ reply: "new-current-reply", action: null });
      },
      onAppendMessage: message => messages.push(message)
    })
  );
  t.teardown(async () => {
    release({ reply: "teardown-only", action: null });
    await harness.unmount();
    hub.disconnect();
  });
  let pending;
  await act(async () => {
    pending = harness.latest.onSend(submitEvent);
  });
  t.is(calls.length, 1);
  t.true(harness.latest.sending);
  const signal = calls[0][3].signal;
  const initialEpoch = hub.botChatCapabilityEpoch;
  await act(async () => transport.trigger("product_modules_changed", { bots_enabled: true, ai_enabled: false }));
  t.false(hub.productModules.ai_enabled);
  t.true(hub.botChatCapabilityEpoch > initialEpoch);
  t.true(signal.aborted);
  t.false(harness.latest.sending);
  // The real parent supplies sendingDisabled from its effective module/room
  // state. Model that prop boundary explicitly; this is not a UIRoot mount.
  await harness.render({ sendingDisabled: true });
  t.false(harness.latest.canChat);
  await act(async () => harness.latest.onSend(submitEvent));
  t.is(calls.length, 1);
  const offEpoch = hub.botChatCapabilityEpoch;
  await act(async () => transport.trigger("product_modules_changed", { bots_enabled: true, ai_enabled: true }));
  t.true(hub.botChatCapabilityEpoch > offEpoch);
  await harness.render({ sendingDisabled: false, inputValue: "new message" });
  await act(async () => {
    release({ reply: "stale-after-ON", action: { waypoint: "spawbot-old" } });
    await pending;
  });
  t.true(signal.aborted);
  t.false(messages.some(message => message.author === "bot" || message.author === "system"));
  await act(async () => harness.latest.onSend(submitEvent));
  t.is(calls.length, 2);
  t.not(calls[1][3].signal, signal);
  t.false(calls[1][3].signal.aborted);
  t.is(messages.filter(message => message.author === "bot").length, 1);
  t.is(messages.find(message => message.author === "bot").text, "new-current-reply");
  t.false(messages.some(message => message.author === "system"));
});
