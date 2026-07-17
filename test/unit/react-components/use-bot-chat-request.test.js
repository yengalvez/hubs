import test from "ava";

require("../../../scripts/shim");

const React = require("react");
const PropTypes = require("prop-types");
const { createRoot } = require("react-dom/client");
const { act } = require("react-dom/test-utils");
const { useBotChatRequest } = require("../../../src/react-components/room/useBotChatRequest");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CAPABILITY_A = "A".repeat(32);
const CAPABILITY_B = "B".repeat(32);

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
