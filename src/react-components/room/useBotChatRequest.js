import { useCallback, useEffect, useRef, useState } from "react";
import { BotChatRequestLifecycle } from "../../utils/bot-chat-lifecycle";

let nextMessageId = 0;

function makeMessage(author, authorLabel, text) {
  nextMessageId += 1;
  return {
    id: `bot-chat-${nextMessageId}`,
    author,
    authorLabel,
    text,
    ts: Date.now()
  };
}

function collectKnownWaypoints(scene) {
  if (!scene?.querySelectorAll) return [];

  const names = new Set();
  const waypointEls = scene.querySelectorAll("[waypoint]");
  for (let i = 0; i < waypointEls.length && names.size < 64; i++) {
    const el = waypointEls[i];
    const name = String(el.getAttribute("name") || el.object3D?.name || "")
      .trim()
      .toLowerCase()
      .slice(0, 64);
    if (name.startsWith("spawbot-")) names.add(name);
  }

  return Array.from(names);
}

export function useBotChatRequest({
  scene,
  hubChannel,
  hubSid,
  botId,
  botName,
  inputValue,
  sendingDisabled,
  sessionEpoch,
  intl,
  requestBotChat,
  onInputChange,
  onAppendMessage
}) {
  const [sending, setSending] = useState(false);
  const [capabilityState, setCapabilityState] = useState(() => ({
    capability: hubChannel?.botChatCapability || null,
    epoch: hubChannel?.botChatCapabilityEpoch || 0
  }));
  const requestLifecycleRef = useRef(null);
  if (!requestLifecycleRef.current) requestLifecycleRef.current = new BotChatRequestLifecycle();

  const requestIdentity = {
    hubChannel,
    hubSid,
    botId,
    capability: capabilityState.capability,
    capabilityEpoch: capabilityState.epoch,
    sessionEpoch
  };
  const requestIdentityRef = useRef(requestIdentity);
  requestIdentityRef.current = requestIdentity;

  useEffect(() => {
    const syncCapability = () => {
      requestLifecycleRef.current.cancel();
      setSending(false);
      setCapabilityState({
        capability: hubChannel?.botChatCapability || null,
        epoch: hubChannel?.botChatCapabilityEpoch || 0
      });
    };
    syncCapability();

    if (!hubChannel) return undefined;
    hubChannel.addEventListener("bot_chat_capability_changed", syncCapability);
    return () => {
      hubChannel.removeEventListener("bot_chat_capability_changed", syncCapability);
      requestLifecycleRef.current.cancel();
    };
  }, [hubChannel]);

  useEffect(() => {
    requestLifecycleRef.current.cancel();
    setSending(false);
    return () => requestLifecycleRef.current.cancel();
  }, [hubChannel, hubSid, botId, capabilityState.epoch, sessionEpoch]);

  useEffect(() => () => requestLifecycleRef.current.cancel(), []);

  const canChat = !!(hubSid && botId && hubChannel && hubChannel.signedIn && capabilityState.capability);

  const onSend = useCallback(
    async e => {
      e.preventDefault();
      const message = (inputValue || "").trim();
      if (!message || sending || sendingDisabled) return;

      onInputChange("");
      onAppendMessage(
        makeMessage("user", intl.formatMessage({ id: "bot-chat-panel.author-you", defaultMessage: "You" }), message)
      );

      if (!canChat) {
        onAppendMessage(
          makeMessage(
            "system",
            intl.formatMessage({ id: "bot-chat-panel.author-system", defaultMessage: "System" }),
            intl.formatMessage({
              id: "bot-chat-panel.sign-in-required",
              defaultMessage: "Sign in is required before using private bot chat."
            })
          )
        );
        return;
      }

      const currentIdentity = requestIdentityRef.current;
      if (
        !hubChannel.signedIn ||
        hubChannel.botChatCapability !== currentIdentity.capability ||
        hubChannel.botChatCapabilityEpoch !== currentIdentity.capabilityEpoch
      ) {
        return;
      }

      const request = requestLifecycleRef.current.begin(currentIdentity);
      setSending(true);

      try {
        const payload = {
          message,
          bot_chat_capability: currentIdentity.capability,
          context: {
            waypoints: collectKnownWaypoints(scene)
          }
        };

        const result = await requestBotChat(
          `/api/v1/hubs/${currentIdentity.hubSid}/bots/${currentIdentity.botId}/chat`,
          "POST",
          payload,
          { signal: request.signal }
        );

        if (!requestLifecycleRef.current.isCurrent(request, requestIdentityRef.current)) return;

        if (typeof result === "string") {
          throw new Error("bot_chat_failed");
        }

        if (result && result.errors && result.errors.length) {
          throw new Error("bot_chat_failed");
        }

        const reply =
          (result && result.reply) ||
          intl.formatMessage({ id: "bot-chat-panel.no-reply", defaultMessage: "The bot did not return a reply." });
        onAppendMessage(makeMessage("bot", botName || "Bot", reply));

        if (result && result.action) {
          onAppendMessage(
            makeMessage(
              "system",
              intl.formatMessage({ id: "bot-chat-panel.author-system", defaultMessage: "System" }),
              intl.formatMessage(
                { id: "bot-chat-panel.action-queued", defaultMessage: "Movement requested toward {waypoint}." },
                { waypoint: result.action.waypoint || "" }
              )
            )
          );
        }
      } catch {
        if (!requestLifecycleRef.current.isCurrent(request, requestIdentityRef.current)) return;
        onAppendMessage(
          makeMessage(
            "system",
            intl.formatMessage({ id: "bot-chat-panel.author-system", defaultMessage: "System" }),
            intl.formatMessage({
              id: "bot-chat-panel.request-failed",
              defaultMessage: "The bot could not be reached. Try again later."
            })
          )
        );
      } finally {
        if (requestLifecycleRef.current.finish(request)) setSending(false);
      }
    },
    [
      inputValue,
      sending,
      sendingDisabled,
      canChat,
      intl,
      scene,
      botName,
      hubChannel,
      requestBotChat,
      onInputChange,
      onAppendMessage
    ]
  );

  return { canChat, sending, onSend };
}
