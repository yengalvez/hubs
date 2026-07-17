import test from "ava";

import { isAuthenticatedBotRunnerPresence } from "../../../src/utils/bot-runner-auth-utils";

function authoritativeMeta(overrides = {}) {
  return {
    context: { bot_runner: true },
    bot_runner_authoritative: true,
    bot_runner_lease_id: "00000000-0000-4000-8000-000000000001:1",
    bot_runner_join_order: 1,
    bot_runner_authority_epoch: 1,
    ...overrides
  };
}

test("accepts a single explicitly authenticated meta for the local session", t => {
  const presenceState = {
    localSession: {
      metas: [authoritativeMeta()]
    }
  };

  t.true(isAuthenticatedBotRunnerPresence(presenceState, "localSession"));
});

test("selects the unique greatest join order independently of Presence array order", t => {
  const staleLeader = authoritativeMeta();
  const newFollower = authoritativeMeta({
    bot_runner_authoritative: false,
    bot_runner_lease_id: "00000000-0000-4000-8000-000000000002:2",
    bot_runner_join_order: 2
  });

  for (const metas of [
    [newFollower, staleLeader],
    [staleLeader, newFollower]
  ]) {
    t.false(isAuthenticatedBotRunnerPresence({ localSession: { metas } }, "localSession"));
  }
});

test("accepts a promoted latest connection while tolerating an older stale authority epoch", t => {
  const staleLeader = authoritativeMeta();
  const promotedFollower = authoritativeMeta({
    bot_runner_lease_id: "00000000-0000-4000-8000-000000000002:2",
    bot_runner_join_order: 2,
    bot_runner_authority_epoch: 3
  });

  for (const metas of [
    [staleLeader, promotedFollower],
    [promotedFollower, staleLeader]
  ]) {
    t.true(isAuthenticatedBotRunnerPresence({ localSession: { metas } }, "localSession"));
  }
});

test("rejects revocation, duplicate identities and contradictory current authority", t => {
  const current = authoritativeMeta({
    bot_runner_lease_id: "00000000-0000-4000-8000-000000000002:2",
    bot_runner_join_order: 2,
    bot_runner_authority_epoch: 2
  });
  const revoked = { ...current, bot_runner_authoritative: false };

  t.false(isAuthenticatedBotRunnerPresence({ localSession: { metas: [revoked] } }, "localSession"));
  t.false(
    isAuthenticatedBotRunnerPresence(
      { localSession: { metas: [current, { ...current, bot_runner_lease_id: "other" }] } },
      "localSession"
    )
  );
  t.false(
    isAuthenticatedBotRunnerPresence(
      {
        localSession: {
          metas: [authoritativeMeta(), { ...current, bot_runner_lease_id: authoritativeMeta().bot_runner_lease_id }]
        }
      },
      "localSession"
    )
  );
  t.false(
    isAuthenticatedBotRunnerPresence(
      {
        localSession: {
          metas: [authoritativeMeta({ bot_runner_authority_epoch: 2 }), current]
        }
      },
      "localSession"
    )
  );
  t.false(
    isAuthenticatedBotRunnerPresence(
      {
        localSession: {
          metas: [authoritativeMeta({ bot_runner_authoritative: false, bot_runner_authority_epoch: 3 }), current]
        }
      },
      "localSession"
    )
  );
});

test("fails closed when any candidate meta is absent or malformed", t => {
  const malformedOverrides = [
    { context: null },
    { context: [] },
    { context: { bot_runner: "true" } },
    { bot_runner_authoritative: 1 },
    { bot_runner_lease_id: "" },
    { bot_runner_lease_id: 7 },
    { bot_runner_join_order: 0 },
    { bot_runner_join_order: "2" },
    { bot_runner_join_order: 1.5 },
    { bot_runner_authority_epoch: 0 },
    { bot_runner_authority_epoch: "2" },
    { bot_runner_authority_epoch: Number.MAX_SAFE_INTEGER + 1 }
  ];

  t.false(isAuthenticatedBotRunnerPresence(undefined, "localSession"));
  t.false(isAuthenticatedBotRunnerPresence([], "localSession"));
  t.false(isAuthenticatedBotRunnerPresence({}, "localSession"));
  t.false(isAuthenticatedBotRunnerPresence({ localSession: [] }, "localSession"));
  t.false(isAuthenticatedBotRunnerPresence({ localSession: {} }, "localSession"));
  t.false(isAuthenticatedBotRunnerPresence({ localSession: { metas: [] } }, "localSession"));
  t.false(isAuthenticatedBotRunnerPresence({ localSession: { metas: [{}] } }, "localSession"));

  for (const overrides of malformedOverrides) {
    const malformed = authoritativeMeta({
      bot_runner_lease_id: "00000000-0000-4000-8000-000000000002:2",
      bot_runner_join_order: 2,
      bot_runner_authority_epoch: 2,
      ...overrides
    });
    t.false(
      isAuthenticatedBotRunnerPresence({ localSession: { metas: [authoritativeMeta(), malformed] } }, "localSession")
    );
  }
});

test("fails closed against the legacy context-only bot-runner presence contract", t => {
  const legacyPresenceState = {
    localSession: {
      metas: [{ context: { bot_runner: true } }]
    }
  };

  t.false(isAuthenticatedBotRunnerPresence(legacyPresenceState, "localSession"));
});

test("does not accept another session or truthy client-controlled values", t => {
  const presenceState = {
    localSession: { metas: [authoritativeMeta({ context: { bot_runner: "true" } })] },
    otherSession: { metas: [authoritativeMeta()] }
  };

  t.false(isAuthenticatedBotRunnerPresence(presenceState, "localSession"));
  t.false(isAuthenticatedBotRunnerPresence(presenceState, "missingSession"));
  t.false(isAuthenticatedBotRunnerPresence(presenceState, ""));
});
