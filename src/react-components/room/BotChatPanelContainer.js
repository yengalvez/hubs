import React, { useCallback, useEffect, useMemo, useState } from "react";
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
    text
  };
}

export function BotChatPanelContainer({ scene, hubChannel, hubSid, botId, botName, onClose }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setMessages([]);
    setInputValue("");
  }, [botId]);

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
      const message = inputValue.trim();
      if (!message || sending) return;

      setInputValue("");
      setMessages(prev => [...prev, makeMessage("user", "You", message)]);

      if (!canChat) {
        setMessages(prev => [
          ...prev,
          makeMessage("system", "System", "Sign in is required before using private bot chat.")
        ]);
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
        setMessages(prev => [...prev, makeMessage("bot", botName || "Bot", reply)]);

        if (result && result.action) {
          sendCommandToRunner(result.action);
          setMessages(prev => [
            ...prev,
            makeMessage(
              "system",
              "System",
              `Action queued: ${result.action.type}${result.action.waypoint ? ` -> ${result.action.waypoint}` : ""}`
            )
          ]);
        }
      } catch (err) {
        setMessages(prev => [...prev, makeMessage("system", "System", err.message || "Bot chat request failed.")]);
      } finally {
        setSending(false);
      }
    },
    [inputValue, sending, canChat, hubSid, botId, botName, sendCommandToRunner]
  );

  return (
    <BotChatPanel
      botName={botName}
      messages={messages}
      inputValue={inputValue}
      sending={sending}
      onClose={onClose}
      onInputChange={e => setInputValue(e.target.value)}
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
  onClose: PropTypes.func.isRequired
};
