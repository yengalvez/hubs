import React, { useEffect, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import classNames from "classnames";
import { FormattedMessage, useIntl } from "react-intl";
import { Sidebar } from "../sidebar/Sidebar";
import { CloseButton } from "../input/CloseButton";
import { Button } from "../input/Button";
import styles from "./BotChatPanel.scss";

export function BotChatPanel({
  botName,
  messages,
  inputValue,
  sending,
  sendingDisabled,
  conversations,
  activeBotId,
  onSelectConversation,
  onClose,
  onInputChange,
  onSend
}) {
  const messagesEndRef = useRef(null);
  const intl = useIntl();
  const conversationsAriaLabel = intl.formatMessage({
    id: "bot-chat-panel.conversations.aria",
    defaultMessage: "Bot conversations"
  });

  const conversationTabs = useMemo(() => {
    const list = Array.isArray(conversations) ? conversations : [];
    if (list.length <= 1) return null;

    return (
      <div className={styles.conversations} role="tablist" aria-label={conversationsAriaLabel}>
        {list.map(c => {
          const selected = c.botId === activeBotId;
          return (
            <button
              key={c.botId}
              type="button"
              role="tab"
              aria-selected={selected}
              className={classNames(styles.conversationTab, { [styles.conversationTabSelected]: selected })}
              onClick={() => onSelectConversation && onSelectConversation(c.botId)}
            >
              {c.botName || c.botId}
            </button>
          );
        })}
      </div>
    );
  }, [conversations, activeBotId, onSelectConversation, conversationsAriaLabel]);

  useEffect(() => {
    if (!messagesEndRef.current) return;
    messagesEndRef.current.scrollIntoView({ block: "end" });
  }, [messages.length, sending]);

  return (
    <Sidebar
      title={
        <FormattedMessage
          id="bot-chat-panel.title"
          defaultMessage="Chat with {name}"
          values={{ name: botName || "Bot" }}
        />
      }
      beforeTitle={<CloseButton onClick={onClose} />}
    >
      <div className={styles.wrapper}>
        {conversationTabs}

        <div className={styles.messages}>
          {messages.map((message, index) => {
            const prev = index > 0 ? messages[index - 1] : null;
            const showAuthor = !prev || prev.author !== message.author;

            return (
              <div
                key={message.id}
                className={classNames(styles.messageRow, {
                  [styles.rowUser]: message.author === "user",
                  [styles.rowBot]: message.author === "bot",
                  [styles.rowSystem]: message.author === "system"
                })}
              >
                <div
                  className={classNames(styles.bubble, {
                    [styles.bubbleUser]: message.author === "user",
                    [styles.bubbleBot]: message.author === "bot",
                    [styles.bubbleSystem]: message.author === "system"
                  })}
                >
                  {showAuthor && message.author !== "system" && (
                    <div className={styles.messageAuthor}>{message.authorLabel}</div>
                  )}
                  <div className={styles.messageBody}>{message.text}</div>
                </div>
              </div>
            );
          })}

          {sending && (
            <div className={classNames(styles.messageRow, styles.rowBot)}>
              <div className={classNames(styles.bubble, styles.bubbleBot, styles.typing)}>
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
              </div>
            </div>
          )}

          {!messages.length && (
            <div className={styles.emptyState}>
              <FormattedMessage
                id="bot-chat-panel.empty"
                defaultMessage="Ask this bot something. Replies are private to you."
              />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className={styles.composer} onSubmit={onSend}>
          <textarea
            className={styles.input}
            rows={3}
            value={inputValue}
            onChange={onInputChange}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend(e);
              }
            }}
            placeholder="Write a private message..."
            disabled={sending || sendingDisabled}
          />
          <div className={styles.composerFooter}>
            <div className={styles.hint}>
              <FormattedMessage id="bot-chat-panel.hint" defaultMessage="Enter to send. Shift+Enter for a new line." />
            </div>
            <Button type="submit" preset="primary" disabled={sending || sendingDisabled || !inputValue.trim()}>
              <FormattedMessage id="bot-chat-panel.send" defaultMessage="Send" />
            </Button>
          </div>
        </form>
      </div>
    </Sidebar>
  );
}

BotChatPanel.propTypes = {
  botName: PropTypes.string,
  messages: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      author: PropTypes.oneOf(["user", "bot", "system"]).isRequired,
      authorLabel: PropTypes.string.isRequired,
      text: PropTypes.string.isRequired
    })
  ).isRequired,
  inputValue: PropTypes.string.isRequired,
  sending: PropTypes.bool,
  sendingDisabled: PropTypes.bool,
  conversations: PropTypes.array,
  activeBotId: PropTypes.string,
  onSelectConversation: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  onInputChange: PropTypes.func.isRequired,
  onSend: PropTypes.func.isRequired
};
