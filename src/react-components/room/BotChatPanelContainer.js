import React from "react";
import PropTypes from "prop-types";
import { useIntl } from "react-intl";
import { fetchReticulumAuthenticated } from "../../utils/phoenix-utils";
import { BotChatPanel } from "./BotChatPanel";
import { useBotChatRequest } from "./useBotChatRequest";

export function BotChatPanelContainer({
  scene,
  hubChannel,
  hubSid,
  botId,
  botName,
  messages,
  inputValue,
  sendingDisabled,
  sessionEpoch,
  conversations,
  activeBotId,
  onSelectConversation,
  onClose,
  onInputChange,
  onAppendMessage
}) {
  const intl = useIntl();
  const { sending, onSend } = useBotChatRequest({
    scene,
    hubChannel,
    hubSid,
    botId,
    botName,
    inputValue,
    sendingDisabled,
    sessionEpoch,
    intl,
    requestBotChat: fetchReticulumAuthenticated,
    onInputChange,
    onAppendMessage
  });

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
  sessionEpoch: PropTypes.number.isRequired,
  conversations: PropTypes.array,
  activeBotId: PropTypes.string,
  onSelectConversation: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  onInputChange: PropTypes.func.isRequired,
  onAppendMessage: PropTypes.func.isRequired
};
