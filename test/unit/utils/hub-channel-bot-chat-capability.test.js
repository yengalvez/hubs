import test from "ava";

import {
  BotChatCapabilityState,
  BotChatRequestLifecycle,
  botChatResetStatePatch,
  normalizeBotChatCapability
} from "../../../src/utils/bot-chat-lifecycle";

const CAPABILITY_A = "A".repeat(32);
const CAPABILITY_B = "b_-C".repeat(8);

function identity(overrides = {}) {
  return {
    hubChannel: overrides.hubChannel || { id: "channel-a" },
    hubSid: "hub-a",
    botId: "bot-a",
    capability: CAPABILITY_A,
    capabilityEpoch: 1,
    sessionEpoch: 7,
    ...overrides
  };
}

test("server bot-chat capabilities must be exactly 32 base64url characters", t => {
  t.is(normalizeBotChatCapability(CAPABILITY_A), CAPABILITY_A);
  t.is(normalizeBotChatCapability(CAPABILITY_B), CAPABILITY_B);

  for (const invalid of [
    null,
    7,
    {},
    "A".repeat(31),
    "A".repeat(33),
    `${"A".repeat(31)}=`,
    `${"A".repeat(31)}+`,
    `${"A".repeat(31)}/`,
    `${"A".repeat(31)} `,
    `${"A".repeat(31)}é`
  ]) {
    t.is(normalizeBotChatCapability(invalid), null);
  }
});

test("capability configuration rotates a non-secret epoch even when a value repeats or fails closed", t => {
  const changes = [];
  const state = new BotChatCapabilityState(change => changes.push(change));

  state.configure(CAPABILITY_A);
  t.is(state.capability, CAPABILITY_A);
  t.is(state.epoch, 1);

  state.configure(CAPABILITY_A);
  state.configure("invalid");

  t.is(state.capability, null);
  t.is(state.epoch, 3);
  t.deepEqual(changes, [
    { available: true, epoch: 1 },
    { available: true, epoch: 2 },
    { available: false, epoch: 3 }
  ]);
  t.false(JSON.stringify(changes).includes(CAPABILITY_A));
});

test("an async reply is current only for its exact bot, hub, channel, capability and UI epoch", t => {
  const lifecycle = new BotChatRequestLifecycle();
  const channel = { id: "channel-a" };
  const requestIdentity = identity({ hubChannel: channel });
  const request = lifecycle.begin(requestIdentity);

  t.true(lifecycle.isCurrent(request, identity({ hubChannel: channel })));
  t.false(lifecycle.isCurrent(request, identity({ hubChannel: channel, botId: "bot-b" })));
  t.false(lifecycle.isCurrent(request, identity({ hubChannel: channel, hubSid: "hub-b" })));
  t.false(lifecycle.isCurrent(request, identity({ hubChannel: { id: "channel-b" } })));
  t.false(lifecycle.isCurrent(request, identity({ hubChannel: channel, capability: CAPABILITY_B })));
  t.false(lifecycle.isCurrent(request, identity({ hubChannel: channel, capabilityEpoch: 2 })));
  t.false(lifecycle.isCurrent(request, identity({ hubChannel: channel, sessionEpoch: 8 })));
});

test("switching conversations or signing out aborts and invalidates the pending request", t => {
  const lifecycle = new BotChatRequestLifecycle();
  const channel = { id: "channel-a" };
  const requestA = lifecycle.begin(identity({ hubChannel: channel }));

  const requestB = lifecycle.begin(identity({ hubChannel: channel, botId: "bot-b" }));
  t.true(requestA.signal.aborted);
  t.false(lifecycle.isCurrent(requestA, identity({ hubChannel: channel })));
  t.true(lifecycle.isCurrent(requestB, identity({ hubChannel: channel, botId: "bot-b" })));

  lifecycle.cancel();
  t.true(requestB.signal.aborted);
  t.false(lifecycle.isCurrent(requestB, identity({ hubChannel: channel, botId: "bot-b" })));
  t.false(lifecycle.finish(requestB));
});

test("identity reset atomically removes history, drafts, selection and the private sidebar", t => {
  t.deepEqual(botChatResetStatePatch("bot-chat"), {
    botChatSessions: {},
    selectedBotForChat: null,
    nearestBot: null,
    sidebarId: null
  });

  t.deepEqual(botChatResetStatePatch("people"), {
    botChatSessions: {},
    selectedBotForChat: null,
    nearestBot: null,
    sidebarId: "people"
  });
});
