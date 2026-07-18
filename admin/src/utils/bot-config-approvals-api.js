const APPROVAL_PROTOCOL = 1;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const FINGERPRINT_PATTERN = /^v1:[0-9a-f]{64}$/;
const CURSOR_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const HUB_SID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

const APPROVAL_KEYS = [
  "approved_at",
  "approved_by_account_id",
  "approved_config_fingerprint",
  "candidate_config_fingerprint",
  "candidate_summary",
  "created_by_account_id",
  "current_config_fingerprint",
  "current_summary",
  "entry_mode",
  "hub_sid",
  "last_quarantine_reason",
  "last_quarantined_at",
  "last_quarantined_by_account_id",
  "runtime_approved",
  "state",
  "updated_at"
];

const SUMMARY_KEYS = [
  "chat_enabled",
  "count",
  "enabled",
  "mobility",
  "prompt_bytes",
  "prompt_codepoints",
  "prompt_present"
];
const QUARANTINE_REASONS = new Set([
  "admin_quarantine",
  "bots_disabled",
  "bots_removed",
  "legacy_migration",
  "room_closed",
  "unapproved_bot_config_change"
]);
const API_ERROR_CODES = new Set([
  "approval_unavailable",
  "config_too_large",
  "fingerprint_mismatch",
  "forbidden",
  "inactive_candidate",
  "invalid_candidate",
  "invalid_config",
  "invalid_request",
  "not_found",
  "room_limit",
  "unavailable"
]);

export class BotConfigApprovalApiError extends Error {
  constructor(code, { status = 0, ambiguous = false, cause } = {}) {
    super(code);
    this.name = "BotConfigApprovalApiError";
    this.code = code;
    this.status = status;
    this.ambiguous = ambiguous;
    if (cause) this.cause = cause;
  }
}

function contractError(code) {
  return new BotConfigApprovalApiError(code, { status: 502 });
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isTimestamp(value, nullable = true) {
  if (value === null) return nullable;
  return (
    typeof value === "string" &&
    UTC_TIMESTAMP_PATTERN.test(value) &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function isAccountId(value, nullable = true) {
  if (value === null) return nullable;
  return Number.isSafeInteger(value) && value > 0;
}

function isFingerprint(value, nullable = true) {
  if (value === null) return nullable;
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

function validateSummary(summary, { nullable = false } = {}) {
  if (summary === null && nullable) return null;
  if (!exactKeys(summary, SUMMARY_KEYS)) throw contractError("invalid_candidate_summary");
  if (typeof summary.enabled !== "boolean" || typeof summary.chat_enabled !== "boolean") {
    throw contractError("invalid_candidate_summary");
  }
  if (!Number.isSafeInteger(summary.count) || summary.count < 0 || summary.count > 10) {
    throw contractError("invalid_candidate_summary");
  }
  if (!["static", "low", "medium", "high"].includes(summary.mobility)) {
    throw contractError("invalid_candidate_summary");
  }
  if (typeof summary.prompt_present !== "boolean") throw contractError("invalid_candidate_summary");
  if (!Number.isSafeInteger(summary.prompt_bytes) || summary.prompt_bytes < 0) {
    throw contractError("invalid_candidate_summary");
  }
  if (!Number.isSafeInteger(summary.prompt_codepoints) || summary.prompt_codepoints < 0) {
    throw contractError("invalid_candidate_summary");
  }
  if (
    summary.prompt_codepoints > summary.prompt_bytes ||
    summary.prompt_present !== summary.prompt_bytes > 0 ||
    summary.prompt_present !== summary.prompt_codepoints > 0
  ) {
    throw contractError("invalid_candidate_summary");
  }
  return Object.freeze({ ...summary });
}

export function validateApprovalEntry(value) {
  if (!exactKeys(value, APPROVAL_KEYS)) throw contractError("invalid_approval_entry");
  if (typeof value.hub_sid !== "string" || !HUB_SID_PATTERN.test(value.hub_sid)) {
    throw contractError("invalid_hub_sid");
  }
  if (!["approved", "quarantined"].includes(value.state)) throw contractError("invalid_approval_state");
  if (typeof value.runtime_approved !== "boolean") throw contractError("invalid_runtime_approval");
  if (!isFingerprint(value.candidate_config_fingerprint)) throw contractError("invalid_candidate_fingerprint");
  if (!isFingerprint(value.approved_config_fingerprint)) throw contractError("invalid_approved_fingerprint");
  if (!isFingerprint(value.current_config_fingerprint)) throw contractError("invalid_current_fingerprint");
  if (
    !isAccountId(value.created_by_account_id) ||
    !isAccountId(value.approved_by_account_id) ||
    !isAccountId(value.last_quarantined_by_account_id)
  ) {
    throw contractError("invalid_actor_id");
  }
  if (!["allow", "invite", "deny"].includes(value.entry_mode)) throw contractError("invalid_entry_mode");
  if (
    !isTimestamp(value.approved_at) ||
    !isTimestamp(value.last_quarantined_at) ||
    !isTimestamp(value.updated_at, false)
  ) {
    throw contractError("invalid_audit_timestamp");
  }
  if (
    value.last_quarantine_reason !== null &&
    (typeof value.last_quarantine_reason !== "string" || !QUARANTINE_REASONS.has(value.last_quarantine_reason))
  ) {
    throw contractError("invalid_quarantine_reason");
  }

  const summary = validateSummary(value.candidate_summary);
  const currentSummary = validateSummary(value.current_summary, { nullable: true });
  const candidate = value.candidate_config_fingerprint;
  const approved = value.approved_config_fingerprint;
  const current = value.current_config_fingerprint;

  if (currentSummary === null && current !== null) throw contractError("contradictory_current_summary");
  if (
    (value.last_quarantine_reason === null) !== (value.last_quarantined_at === null) ||
    (value.last_quarantined_by_account_id !== null && value.last_quarantined_at === null)
  ) {
    throw contractError("contradictory_quarantine_audit");
  }

  if (value.state === "approved") {
    if (!candidate || !approved || !current || !currentSummary || candidate !== approved || approved !== current) {
      throw contractError("contradictory_approved_state");
    }
    if (!value.approved_by_account_id || !value.approved_at) throw contractError("missing_approval_audit");
  } else {
    if (approved !== null || value.approved_by_account_id !== null || value.approved_at !== null) {
      throw contractError("contradictory_quarantine_state");
    }
    if (!value.last_quarantine_reason || !value.last_quarantined_at) {
      throw contractError("missing_quarantine_audit");
    }
    if (value.runtime_approved) throw contractError("contradictory_runtime_state");
  }

  if (value.runtime_approved && (value.state !== "approved" || approved !== current)) {
    throw contractError("contradictory_runtime_state");
  }

  return Object.freeze({ ...value, candidate_summary: summary, current_summary: currentSummary });
}

export function validateCapabilityResponse(value) {
  const capability = value && value.bot_config_approval;
  if (
    !exactKeys(capability, ["legacy_default", "protocol", "runtime_match"]) ||
    capability.protocol !== APPROVAL_PROTOCOL ||
    capability.legacy_default !== "quarantined" ||
    capability.runtime_match !== "exact_jsonb"
  ) {
    throw contractError("unsupported_bot_config_approval_capability");
  }
  return Object.freeze({ ...capability });
}

export function validateInventoryPage(value) {
  if (!exactKeys(value, ["approvals", "next_cursor", "protocol"])) {
    throw contractError("invalid_inventory_response");
  }
  if (value.protocol !== APPROVAL_PROTOCOL || !Array.isArray(value.approvals) || value.approvals.length > PAGE_SIZE) {
    throw contractError("invalid_inventory_response");
  }
  if (
    value.next_cursor !== null &&
    (typeof value.next_cursor !== "string" || !CURSOR_PATTERN.test(value.next_cursor))
  ) {
    throw contractError("invalid_inventory_cursor");
  }
  return Object.freeze({
    protocol: value.protocol,
    approvals: Object.freeze(value.approvals.map(validateApprovalEntry)),
    next_cursor: value.next_cursor
  });
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).length;
}

function hasNoStore(headers) {
  const value = headers && headers.get && headers.get("cache-control");
  return (
    typeof value === "string" &&
    value
      .toLowerCase()
      .split(",")
      .some(token => token.trim() === "no-store")
  );
}

function hasJsonContentType(headers) {
  const value = headers && headers.get && headers.get("content-type");
  return typeof value === "string" && /^application\/json(?:\s*;|$)/i.test(value.trim());
}

async function parseJsonResponse(response, { ambiguous = false } = {}) {
  if (!response || typeof response.status !== "number") throw contractError("invalid_http_response");
  if (!hasNoStore(response.headers)) {
    throw new BotConfigApprovalApiError("missing_no_store", { status: response.status });
  }
  if (!hasJsonContentType(response.headers)) {
    throw new BotConfigApprovalApiError("invalid_content_type", { status: response.status });
  }

  let text;
  try {
    text = await response.text();
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    throw new BotConfigApprovalApiError("network_error", {
      status: response.status,
      ambiguous,
      cause: error
    });
  }
  if (utf8ByteLength(text) > MAX_RESPONSE_BYTES) throw contractError("response_too_large");

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw contractError("invalid_json");
  }

  if (!response.ok) {
    const code =
      exactKeys(json, ["error"]) && typeof json.error === "string" && API_ERROR_CODES.has(json.error)
        ? json.error
        : "unexpected_api_error";
    throw new BotConfigApprovalApiError(code, { status: response.status });
  }
  return json;
}

function validateActionResponse(value, expectedStatus, hubSid) {
  if (!exactKeys(value, ["hub_sid", "status"]) || value.status !== expectedStatus || value.hub_sid !== hubSid) {
    throw contractError("invalid_action_response");
  }
  return Object.freeze({ ...value });
}

function assertSignal(signal) {
  if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean")) {
    throw new TypeError("signal must be an AbortSignal");
  }
}

function compareDecimalStrings(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function createBotConfigApprovalClient({ fetchImpl, getToken, buildUrl }) {
  if (typeof fetchImpl !== "function" || typeof getToken !== "function" || typeof buildUrl !== "function") {
    throw new TypeError("fetchImpl, getToken and buildUrl are required");
  }

  async function request(path, { method = "GET", body, signal } = {}) {
    assertSignal(signal);
    const token = getToken();
    if (typeof token !== "string" || token.length === 0) {
      throw new BotConfigApprovalApiError("missing_auth_token", { status: 401 });
    }

    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    });
    const options = {
      cache: "no-store",
      credentials: "same-origin",
      headers,
      method,
      redirect: "error",
      referrerPolicy: "same-origin",
      signal
    };
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetchImpl(buildUrl(path), options);
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      throw new BotConfigApprovalApiError("network_error", { ambiguous: method !== "GET", cause: error });
    }
    return parseJsonResponse(response, { ambiguous: method !== "GET" });
  }

  return Object.freeze({
    async assertCapability({ signal } = {}) {
      return validateCapabilityResponse(await request("/health/capabilities", { signal }));
    },

    async listAll({ signal } = {}) {
      const approvals = [];
      const seenHubSids = new Set();
      const seenCursors = new Set();
      let cursor = null;

      for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
        const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor !== null) query.set("cursor", cursor);
        const page = validateInventoryPage(await request(`/api/v1/bot_config_approvals?${query}`, { signal }));

        for (const approval of page.approvals) {
          if (seenHubSids.has(approval.hub_sid)) throw contractError("duplicate_inventory_hub");
          seenHubSids.add(approval.hub_sid);
          approvals.push(approval);
        }

        if (page.next_cursor === null) return Object.freeze([...approvals]);
        if (seenCursors.has(page.next_cursor) || page.next_cursor === cursor) {
          throw contractError("repeated_inventory_cursor");
        }
        if (cursor !== null && compareDecimalStrings(page.next_cursor, cursor) <= 0) {
          throw contractError("non_increasing_inventory_cursor");
        }
        seenCursors.add(page.next_cursor);
        cursor = page.next_cursor;
      }

      throw contractError("inventory_page_limit_exceeded");
    },

    async approve(hubSid, expectedFingerprint, { signal } = {}) {
      if (typeof hubSid !== "string" || !HUB_SID_PATTERN.test(hubSid)) throw contractError("invalid_hub_sid");
      if (typeof expectedFingerprint !== "string" || !FINGERPRINT_PATTERN.test(expectedFingerprint)) {
        throw contractError("invalid_candidate_fingerprint");
      }
      const response = await request(`/api/v1/bot_config_approvals/${encodeURIComponent(hubSid)}/approve`, {
        method: "POST",
        body: { expected_config_fingerprint: expectedFingerprint },
        signal
      });
      return validateActionResponse(response, "approved", hubSid);
    },

    async quarantine(hubSid, { signal } = {}) {
      if (typeof hubSid !== "string" || !HUB_SID_PATTERN.test(hubSid)) throw contractError("invalid_hub_sid");
      const response = await request(`/api/v1/bot_config_approvals/${encodeURIComponent(hubSid)}/quarantine`, {
        method: "POST",
        body: {},
        signal
      });
      return validateActionResponse(response, "quarantined", hubSid);
    }
  });
}

export const botConfigApprovalContract = Object.freeze({
  APPROVAL_PROTOCOL,
  FINGERPRINT_PATTERN,
  MAX_PAGES,
  PAGE_SIZE
});
