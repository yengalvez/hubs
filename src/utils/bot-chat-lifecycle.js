const BOT_CHAT_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function normalizeBotChatCapability(value) {
  return typeof value === "string" && BOT_CHAT_CAPABILITY_PATTERN.test(value) ? value : null;
}

export class BotChatCapabilityState {
  constructor(onChange) {
    this._capability = null;
    this._epoch = 0;
    this._onChange = onChange;
  }

  configure(value) {
    this._capability = normalizeBotChatCapability(value);
    this._epoch += 1;

    if (this._onChange) {
      this._onChange({
        available: this._capability !== null,
        epoch: this._epoch
      });
    }
  }

  get capability() {
    return this._capability;
  }

  get epoch() {
    return this._epoch;
  }
}

function sameRequestIdentity(a, b) {
  return !!(
    a &&
    b &&
    a.hubChannel === b.hubChannel &&
    a.hubSid === b.hubSid &&
    a.botId === b.botId &&
    a.capability === b.capability &&
    a.capabilityEpoch === b.capabilityEpoch &&
    a.sessionEpoch === b.sessionEpoch
  );
}

export class BotChatRequestLifecycle {
  constructor() {
    this._active = null;
    this._nextRequestId = 0;
  }

  begin(identity) {
    this.cancel();

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const request = {
      id: ++this._nextRequestId,
      identity: { ...identity },
      controller,
      signal: controller ? controller.signal : undefined
    };

    this._active = request;
    return request;
  }

  isCurrent(request, currentIdentity) {
    return this._active === request && sameRequestIdentity(request.identity, currentIdentity);
  }

  finish(request) {
    if (this._active !== request) return false;
    this._active = null;
    return true;
  }

  cancel() {
    if (!this._active) return false;

    const { controller } = this._active;
    this._active = null;
    if (controller && !controller.signal.aborted) controller.abort();
    return true;
  }
}

export function botChatResetStatePatch(sidebarId) {
  return {
    botChatSessions: {},
    selectedBotForChat: null,
    nearestBot: null,
    sidebarId: sidebarId === "bot-chat" ? null : sidebarId
  };
}
