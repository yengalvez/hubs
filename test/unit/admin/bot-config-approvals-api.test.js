import test from "ava";

import {
  BotConfigApprovalApiError,
  createBotConfigApprovalClient,
  validateApprovalEntry,
  validateCapabilityResponse,
  validateInventoryPage
} from "../../../admin/src/utils/bot-config-approvals-api";

const FINGERPRINT_A = `v1:${"a".repeat(64)}`;
const FINGERPRINT_B = `v1:${"b".repeat(64)}`;

const BACKEND_CONTRACT_ENTRY = Object.freeze({
  approved_at: null,
  approved_by_account_id: null,
  approved_config_fingerprint: null,
  candidate_config_fingerprint: FINGERPRINT_A,
  candidate_summary: {
    chat_enabled: true,
    count: 2,
    enabled: true,
    mobility: "low",
    prompt_bytes: 41,
    prompt_codepoints: 37,
    prompt_present: true
  },
  created_by_account_id: 7,
  current_config_fingerprint: FINGERPRINT_B,
  current_summary: {
    chat_enabled: true,
    count: 2,
    enabled: false,
    mobility: "low",
    prompt_bytes: 41,
    prompt_codepoints: 37,
    prompt_present: true
  },
  entry_mode: "allow",
  hub_sid: "room-a",
  last_quarantine_reason: "legacy_migration",
  last_quarantined_at: "2026-07-18T10:00:00.000000Z",
  last_quarantined_by_account_id: null,
  runtime_approved: false,
  state: "quarantined",
  updated_at: "2026-07-18T10:00:00.000000Z"
});

function approval(overrides = {}) {
  return {
    ...BACKEND_CONTRACT_ENTRY,
    candidate_summary: { ...BACKEND_CONTRACT_ENTRY.candidate_summary },
    current_summary: { ...BACKEND_CONTRACT_ENTRY.current_summary },
    ...overrides
  };
}

function approved(overrides = {}) {
  return approval({
    approved_at: "2026-07-18T11:00:00.000000Z",
    approved_by_account_id: 12,
    approved_config_fingerprint: FINGERPRINT_A,
    current_config_fingerprint: FINGERPRINT_A,
    current_summary: { ...BACKEND_CONTRACT_ENTRY.candidate_summary },
    runtime_approved: true,
    state: "approved",
    ...overrides
  });
}

function response(body, { status = 200, cacheControl = "private, no-store", contentType = "application/json" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": cacheControl,
      "content-type": contentType
    }
  });
}

function capability() {
  return {
    bot_config_approval: {
      legacy_default: "quarantined",
      protocol: 1,
      runtime_match: "exact_jsonb"
    },
    waypoint_reservation: { protocol: 2 }
  };
}

function createClient(fetchImpl) {
  return createBotConfigApprovalClient({
    fetchImpl,
    getToken: () => "admin-token",
    buildUrl: path => `https://reticulum.test${path}`
  });
}

test("authenticated requests are no-store, redirect-safe and traverse the complete cursor inventory", async t => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/health/capabilities")) return response(capability());
    if (url.includes("cursor=10")) {
      return response({ approvals: [approved({ hub_sid: "room-b" })], next_cursor: null, protocol: 1 });
    }
    return response({ approvals: [approval()], next_cursor: "10", protocol: 1 });
  };
  const client = createClient(fetchImpl);

  await client.assertCapability();
  const inventory = await client.listAll();

  t.deepEqual(
    inventory.map(row => row.hub_sid),
    ["room-a", "room-b"]
  );
  t.is(requests.length, 3);
  for (const { options } of requests) {
    t.is(options.cache, "no-store");
    t.is(options.credentials, "same-origin");
    t.is(options.redirect, "error");
    t.is(options.referrerPolicy, "same-origin");
    t.is(options.headers.get("accept"), "application/json");
    t.is(options.headers.get("authorization"), "Bearer admin-token");
  }
  t.true(requests[1].url.includes("limit=100"));
  t.false(requests[1].url.includes("cursor="));
  t.true(requests[2].url.includes("cursor=10"));
});

test("approve and quarantine emit only their closed protocol bodies and never retry", async t => {
  const requests = [];
  const client = createClient(async (url, options) => {
    requests.push({ url, options });
    const body = JSON.parse(options.body);
    return response({
      hub_sid: "room-a",
      status: Object.prototype.hasOwnProperty.call(body, "expected_config_fingerprint") ? "approved" : "quarantined"
    });
  });

  await client.approve("room-a", FINGERPRINT_A);
  await client.quarantine("room-a");

  t.is(requests.length, 2);
  t.deepEqual(JSON.parse(requests[0].options.body), { expected_config_fingerprint: FINGERPRINT_A });
  t.deepEqual(JSON.parse(requests[1].options.body), {});
  t.is(requests[0].options.method, "POST");
  t.is(requests[0].options.headers.get("content-type"), "application/json");
});

test("a transport failure is ambiguous for POST and is attempted exactly once", async t => {
  let calls = 0;
  const client = createClient(async () => {
    calls += 1;
    throw new TypeError("connection lost");
  });

  const error = await t.throwsAsync(() => client.approve("room-a", FINGERPRINT_A), {
    instanceOf: BotConfigApprovalApiError,
    message: "network_error"
  });
  t.true(error.ambiguous);
  t.is(calls, 1);
});

test("a response body stream failure remains an ambiguous one-shot POST", async t => {
  let calls = 0;
  const client = createClient(async () => {
    calls += 1;
    return {
      headers: new Headers({
        "cache-control": "no-store",
        "content-type": "application/json"
      }),
      ok: true,
      status: 200,
      text: async () => {
        throw new TypeError("response stream reset");
      }
    };
  });

  const error = await t.throwsAsync(() => client.approve("room-a", FINGERPRINT_A), {
    instanceOf: BotConfigApprovalApiError,
    message: "network_error"
  });
  t.true(error.ambiguous);
  t.is(error.status, 200);
  t.is(calls, 1);
});

test("HTTP errors preserve the closed code and status without retry", async t => {
  let calls = 0;
  const client = createClient(async () => {
    calls += 1;
    return response({ error: "fingerprint_mismatch" }, { status: 409 });
  });

  const error = await t.throwsAsync(() => client.approve("room-a", FINGERPRINT_A), {
    instanceOf: BotConfigApprovalApiError,
    message: "fingerprint_mismatch"
  });
  t.is(error.status, 409);
  t.false(error.ambiguous);
  t.is(calls, 1);
});

test("missing no-store and non-JSON responses fail closed while retaining auth status", async t => {
  const missingNoStore = createClient(async () => response(capability(), { cacheControl: "private" }));
  const cacheError = await t.throwsAsync(() => missingNoStore.assertCapability(), {
    instanceOf: BotConfigApprovalApiError,
    message: "missing_no_store"
  });
  t.is(cacheError.status, 200);

  const nonJson401 = createClient(async () => response({}, { status: 401, contentType: "text/plain" }));
  const authError = await t.throwsAsync(() => nonJson401.assertCapability(), {
    instanceOf: BotConfigApprovalApiError,
    message: "invalid_content_type"
  });
  t.is(authError.status, 401);
});

test("the exact backend contract accepts legacy redaction but rejects extra or contradictory fields", t => {
  t.deepEqual(validateApprovalEntry(BACKEND_CONTRACT_ENTRY), BACKEND_CONTRACT_ENTRY);
  t.notThrows(() =>
    validateApprovalEntry(
      approval({
        candidate_config_fingerprint: null,
        candidate_summary: {
          ...BACKEND_CONTRACT_ENTRY.candidate_summary,
          prompt_bytes: 12_000,
          prompt_codepoints: 8_000
        },
        created_by_account_id: null,
        current_config_fingerprint: null,
        current_summary: null,
        entry_mode: "invite"
      })
    )
  );
  t.throws(() =>
    validateCapabilityResponse({ bot_config_approval: { ...capability().bot_config_approval, extra: 1 } })
  );
  t.throws(() => validateApprovalEntry({ ...approval(), prompt: "must-never-arrive" }));
  t.throws(() =>
    validateApprovalEntry({ ...approved(), runtime_approved: true, current_config_fingerprint: FINGERPRINT_B })
  );
  t.throws(() =>
    validateInventoryPage({
      approvals: [{ ...approval(), current_summary: { ...approval().current_summary, prompt: "hidden" } }],
      next_cursor: null,
      protocol: 1
    })
  );
  t.throws(() => validateApprovalEntry(approval({ updated_at: "1" })), { message: "invalid_audit_timestamp" });
  t.throws(
    () =>
      validateInventoryPage({
        approvals: Array.from({ length: 101 }, (_value, index) => approval({ hub_sid: `room-${index}` })),
        next_cursor: null,
        protocol: 1
      }),
    { message: "invalid_inventory_response" }
  );
});

test("duplicate rooms and repeated cursors make the whole inventory unavailable", async t => {
  let page = 0;
  const duplicateClient = createClient(async () => {
    page += 1;
    return response({
      approvals: [approval()],
      next_cursor: page === 1 ? "10" : null,
      protocol: 1
    });
  });
  await t.throwsAsync(() => duplicateClient.listAll(), { message: "duplicate_inventory_hub" });

  let cursorPage = 0;
  const repeatedCursorClient = createClient(async () => {
    cursorPage += 1;
    return response({
      approvals: [approval({ hub_sid: `room-${cursorPage}` })],
      next_cursor: "10",
      protocol: 1
    });
  });
  await t.throwsAsync(() => repeatedCursorClient.listAll(), { message: "repeated_inventory_cursor" });

  let descendingPage = 0;
  const descendingCursorClient = createClient(async () => {
    descendingPage += 1;
    return response({
      approvals: [approval({ hub_sid: `descending-room-${descendingPage}` })],
      next_cursor: descendingPage === 1 ? "10" : "9",
      protocol: 1
    });
  });
  await t.throwsAsync(() => descendingCursorClient.listAll(), { message: "non_increasing_inventory_cursor" });
});

test("missing tokens and invalid path inputs fail before fetch", async t => {
  let calls = 0;
  const client = createBotConfigApprovalClient({
    fetchImpl: async () => {
      calls += 1;
      return response({});
    },
    getToken: () => "",
    buildUrl: path => path
  });

  await t.throwsAsync(() => client.listAll(), { message: "missing_auth_token" });
  t.is(calls, 0);

  const authenticated = createClient(async () => response({}));
  await t.throwsAsync(() => authenticated.approve("../room", FINGERPRINT_A), { message: "invalid_hub_sid" });
  await t.throwsAsync(() => authenticated.approve("room-a", "bad"), { message: "invalid_candidate_fingerprint" });
});
