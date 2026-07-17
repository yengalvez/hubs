const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;
const MAX_COLLECTION_ITEMS = 200;

function isSensitiveKey(key) {
  const normalized = String(key).toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return (
    compact === "authorization" ||
    compact.includes("credential") ||
    compact === "botchatcapability" ||
    compact.includes("token") ||
    compact.includes("accesskey") ||
    compact.includes("password") ||
    compact.includes("secret")
  );
}

export function redactPhoenixDebugText(value) {
  if (typeof value !== "string") return value;

  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(
      /((?:authorization|credentials?|bot_?chat_?capability|[a-z0-9_]*(?:token|access_?key|password|secret))["']?\s*[:=]\s*)["']?[^\s,;}\]]+["']?/gi,
      `$1${REDACTED}`
    )
    .replace(
      /([?&](?:authorization|credentials?|bot_?chat_?capability|[a-z0-9_]*(?:token|access_?key|password|secret))=)[^&#\s]+/gi,
      `$1${REDACTED}`
    );
}

export function redactPhoenixDebugData(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === "string") return redactPhoenixDebugText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (seen.has(value)) return "[CIRCULAR]";

  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_COLLECTION_ITEMS).map(item => redactPhoenixDebugData(item, depth + 1, seen));
  }

  const redacted = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_COLLECTION_ITEMS)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED : redactPhoenixDebugData(item, depth + 1, seen);
  }
  return redacted;
}
