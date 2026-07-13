import React, { useCallback, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useIntl } from "react-intl";
import { fetchReticulumAuthenticated } from "../../utils/phoenix-utils";
import { BotChatPanel } from "./BotChatPanel";

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

export function BotChatPanelContainer({
  scene,
  hubChannel,
  hubSid,
  botId,
  botName,
  messages,
  inputValue,
  sendingDisabled,
  conversations,
  activeBotId,
  onSelectConversation,
  onClose,
  onInputChange,
  onAppendMessage
}) {
  const intl = useIntl();
  const [sending, setSending] = useState(false);

  const canChat = useMemo(() => {
    return !!(hubSid && botId && hubChannel && hubChannel.signedIn);
  }, [hubChannel, hubSid, botId]);

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

      setSending(true);

      try {
        const payload = {
          message,
          context: {
            waypoints: collectKnownWaypoints(scene)
          }
        };

        const result = await fetchReticulumAuthenticated(`/api/v1/hubs/${hubSid}/bots/${botId}/chat`, "POST", payload);

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
        setSending(false);
      }
    },
    [inputValue, sending, sendingDisabled, canChat, intl, scene, hubSid, botId, botName, onInputChange, onAppendMessage]
  );

  return (
    <BotChatPanel
      botName={botName}
      messages={messages}
      inputValue={inputValue}
      sending={sending}
      sendingDisabled={sendingDisabled}
      conversations={conversations}
      activeBotId={activeBotId}
      onSelectConversation={onSelectConversation}
      onClose={onClose}
      onInputChange={e => onInputChange(e.target.value)}
      onSend={onSend}
    />
  );
}

BotChatPanelContainer.propTypes = {
  scene: PropTypes.object,
  hubChannel: PropTypes.object.isRequired,
  hubSid: PropTypes.string,
  botId: PropTypes.string,
  botName: PropTypes.string,
  messages: PropTypes.array.isRequired,
  inputValue: PropTypes.string.isRequired,
  sendingDisabled: PropTypes.bool,
  conversations: PropTypes.array,
  activeBotId: PropTypes.string,
  onSelectConversation: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  onInputChange: PropTypes.func.isRequired,
  onAppendMessage: PropTypes.func.isRequired
};
