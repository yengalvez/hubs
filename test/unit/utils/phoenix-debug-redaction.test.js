import test from "ava";

import { redactPhoenixDebugData, redactPhoenixDebugText } from "../../../src/utils/phoenix-debug-redaction";

test("Phoenix debug data recursively redacts capabilities, authorization and token/access-key fields", t => {
  const secretCapability = "A".repeat(32);
  const secretToken = "header.payload.signature";
  const secretAccessKey = "super-secret-access-key-value";
  const input = {
    event: "bot_chat",
    payload: {
      bot_chat_capability: secretCapability,
      auth_token: secretToken,
      nested: [{ authorization: `Bearer ${secretToken}` }, { bot_runner_access_key: secretAccessKey }],
      public_value: "safe"
    }
  };

  const output = redactPhoenixDebugData(input);
  const serialized = JSON.stringify(output);

  t.false(serialized.includes(secretCapability));
  t.false(serialized.includes(secretToken));
  t.false(serialized.includes(secretAccessKey));
  t.is(output.payload.public_value, "safe");
  t.is(input.payload.bot_chat_capability, secretCapability);
});

test("Phoenix debug message text redacts bearer and serialized/query credentials", t => {
  const secretCapability = "B".repeat(32);
  const secretToken = "token-value-that-must-not-leak";
  const text =
    `push bot_chat_capability=${secretCapability} authorization=Bearer ${secretToken} ` +
    `wss://example.test/socket?auth_token=${secretToken}`;
  const output = redactPhoenixDebugText(text);

  t.false(output.includes(secretCapability));
  t.false(output.includes(secretToken));
  t.true(output.includes("[REDACTED]"));
});

test("Phoenix debug redaction handles cyclic values without throwing", t => {
  const value = { event: "safe" };
  value.self = value;

  t.deepEqual(redactPhoenixDebugData(value), { event: "safe", self: "[CIRCULAR]" });
});
