import React, { useCallback, useMemo, useState } from "react";
import PropTypes from "prop-types";
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
  const [sending, setSending] = useState(false);

  const canChat = useMemo(() => {
    return !!(hubSid && botId && hubChannel && hubChannel.signedIn);
  }, [hubChannel, hubSid, botId]);

  const sendCommandToRunner = useCallback(
    action => {
      if (!action || action.type !== "go_to_waypoint" || !action.waypoint) return;

      const command = {
        type: "go_to_waypoint",
        bot_id: botId,
        waypoint: action.waypoint
      };

      hubChannel.sendMessage(command, "bot_command");

      const botRunnerSystem = scene?.systems?.["bot-runner-system"];
      if (botRunnerSystem?.handleBotCommand) {
        botRunnerSystem.handleBotCommand(command);
      }
    },
    [botId, hubChannel, scene]
  );

  const onSend = useCallback(
    async e => {
      e.preventDefault();
      const message = (inputValue || "").trim();
      if (!message || sending || sendingDisabled) return;

      onInputChange("");
      onAppendMessage(makeMessage("user", "You", message));

      if (!canChat) {
        onAppendMessage(makeMessage("system", "System", "Sign in is required before using private bot chat."));
        return;
      }

      setSending(true);

      try {
        const payload = {
          message,
          context: {
            source: "hubs-room",
            locale: navigator.language || "en-US"
          }
        };

        const result = await fetchReticulumAuthenticated(`/api/v1/hubs/${hubSid}/bots/${botId}/chat`, "POST", payload);

        if (typeof result === "string") {
          throw new Error(result || "Bot chat failed.");
        }

        if (result && result.errors && result.errors.length) {
          const detail = result.errors[0].detail || "Bot chat failed.";
          throw new Error(detail);
        }

        const reply = (result && result.reply) || "No reply from bot.";
        onAppendMessage(makeMessage("bot", botName || "Bot", reply));

        if (result && result.action) {
          sendCommandToRunner(result.action);
          onAppendMessage(
            makeMessage(
              "system",
              "System",
              `Action queued: ${result.action.type}${result.action.waypoint ? ` -> ${result.action.waypoint}` : ""}`
            )
          );
        }
      } catch (err) {
        onAppendMessage(makeMessage("system", "System", err.message || "Bot chat request failed."));
      } finally {
        setSending(false);
      }
    },
    [
      inputValue,
      sending,
      sendingDisabled,
      canChat,
      hubSid,
      botId,
      botName,
      sendCommandToRunner,
      onInputChange,
      onAppendMessage
    ]
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
