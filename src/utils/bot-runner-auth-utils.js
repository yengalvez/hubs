function isObjectRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validatedBotRunnerMeta(meta) {
  if (!isObjectRecord(meta) || !isObjectRecord(meta.context)) return null;

  const leaseId = meta.bot_runner_lease_id;
  const joinOrder = meta.bot_runner_join_order;
  const authorityEpoch = meta.bot_runner_authority_epoch;
  const authoritative = meta.bot_runner_authoritative;

  if (
    meta.context.bot_runner !== true ||
    typeof authoritative !== "boolean" ||
    typeof leaseId !== "string" ||
    leaseId.length === 0 ||
    !Number.isSafeInteger(joinOrder) ||
    joinOrder <= 0 ||
    !Number.isSafeInteger(authorityEpoch) ||
    authorityEpoch <= 0
  ) {
    return null;
  }

  return { leaseId, joinOrder, authorityEpoch, authoritative };
}

export function isAuthenticatedBotRunnerPresence(presenceState, sessionId) {
  if (typeof sessionId !== "string" || sessionId.length === 0 || !isObjectRecord(presenceState)) return false;

  const presence = presenceState[sessionId];
  const metas = isObjectRecord(presence) && Array.isArray(presence.metas) ? presence.metas : [];
  if (metas.length === 0) return false;

  const candidates = [];
  const joinOrders = new Set();
  const leaseIds = new Set();
  for (const meta of metas) {
    const candidate = validatedBotRunnerMeta(meta);
    if (!candidate || joinOrders.has(candidate.joinOrder) || leaseIds.has(candidate.leaseId)) return false;
    candidates.push(candidate);
    joinOrders.add(candidate.joinOrder);
    leaseIds.add(candidate.leaseId);
  }

  const current = candidates.reduce((latest, candidate) =>
    !latest || candidate.joinOrder > latest.joinOrder ? candidate : latest
  );
  const currentAuthorityEpoch = candidates.reduce(
    (maximum, candidate) => Math.max(maximum, candidate.authorityEpoch),
    0
  );
  if (!current.authoritative || current.authorityEpoch !== currentAuthorityEpoch) return false;

  const authoritiesAtCurrentEpoch = candidates.filter(
    candidate => candidate.authorityEpoch === currentAuthorityEpoch && candidate.authoritative
  );
  return authoritiesAtCurrentEpoch.length === 1 && authoritiesAtCurrentEpoch[0] === current;
}
