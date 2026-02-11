import React from "react";
import PropTypes from "prop-types";
import classNames from "classnames";
import { FormattedMessage } from "react-intl";
import { Sidebar } from "../sidebar/Sidebar";
import { CloseButton } from "../input/CloseButton";
import { Button } from "../input/Button";
import styles from "./BotChatPanel.scss";

export function BotChatPanel({ botName, messages, inputValue, sending, onClose, onInputChange, onSend }) {
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
        <div className={styles.messages}>
          {messages.map(message => (
            <div
              key={message.id}
              className={classNames(styles.message, {
                [styles.user]: message.author === "user",
                [styles.bot]: message.author === "bot",
                [styles.system]: message.author === "system"
              })}
            >
              <div className={styles.messageAuthor}>{message.authorLabel}</div>
              <div className={styles.messageBody}>{message.text}</div>
            </div>
          ))}
          {!messages.length && (
            <div className={styles.emptyState}>
              <FormattedMessage
                id="bot-chat-panel.empty"
                defaultMessage="Ask this bot something. Replies are private to you."
              />
            </div>
          )}
        </div>

        <form className={styles.composer} onSubmit={onSend}>
          <textarea
            className={styles.input}
            rows={3}
            value={inputValue}
            onChange={onInputChange}
            placeholder="Write a private message..."
            disabled={sending}
          />
          <Button type="submit" preset="primary" disabled={sending || !inputValue.trim()}>
            <FormattedMessage id="bot-chat-panel.send" defaultMessage="Send" />
          </Button>
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
  onClose: PropTypes.func.isRequired,
  onInputChange: PropTypes.func.isRequired,
  onSend: PropTypes.func.isRequired
};
