import test from "ava";

import { isAuthenticatedBotRunnerPresence } from "../../../src/utils/bot-runner-auth-utils";

test("accepts only an explicitly authenticated current meta for the local session", t => {
  const presenceState = {
    localSession: {
      metas: [{ context: { bot_runner: false } }, { context: { bot_runner: true } }]
    }
  };

  t.true(isAuthenticatedBotRunnerPresence(presenceState, "localSession"));
});

test("fails closed while the local presence is unavailable", t => {
  t.false(isAuthenticatedBotRunnerPresence(undefined, "localSession"));
  t.false(isAuthenticatedBotRunnerPresence({}, "localSession"));
  t.false(isAuthenticatedBotRunnerPresence({ localSession: {} }, "localSession"));
  t.false(isAuthenticatedBotRunnerPresence({ localSession: { metas: [] } }, "localSession"));
  t.false(isAuthenticatedBotRunnerPresence({ localSession: { metas: [{}] } }, "localSession"));
});

test("does not accept another session or truthy client-controlled values", t => {
  const presenceState = {
    localSession: { metas: [{ context: { bot_runner: "true" } }] },
    otherSession: { metas: [{ context: { bot_runner: true } }] }
  };

  t.false(isAuthenticatedBotRunnerPresence(presenceState, "localSession"));
  t.false(isAuthenticatedBotRunnerPresence(presenceState, "missingSession"));
  t.false(isAuthenticatedBotRunnerPresence(presenceState, ""));
});

test("uses the latest meta and rejects a revoked authorization", t => {
  const presenceState = {
    localSession: {
      metas: [{ context: { bot_runner: true } }, { context: { bot_runner: false } }]
    }
  };

  t.false(isAuthenticatedBotRunnerPresence(presenceState, "localSession"));
});
