export function isAuthenticatedBotRunnerPresence(presenceState, sessionId) {
  if (!sessionId || !presenceState || typeof presenceState !== "object") return false;

  const presence = presenceState[sessionId];
  const metas = presence && Array.isArray(presence.metas) ? presence.metas : [];
  if (metas.length === 0) return false;

  const currentMeta = metas[metas.length - 1];
  return !!(currentMeta && currentMeta.context && currentMeta.context.bot_runner === true);
}
