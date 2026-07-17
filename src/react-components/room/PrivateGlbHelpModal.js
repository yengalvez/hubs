import React from "react";
import PropTypes from "prop-types";
import { FormattedMessage } from "react-intl";
import { Modal } from "../modal/Modal";
import { CloseButton } from "../input/CloseButton";
import { Column } from "../layout/Column";
import styles from "./PrivateGlbHelpModal.scss";

export function PrivateGlbHelpModal({ onClose }) {
  return (
    <Modal
      title={<FormattedMessage id="private-glb-help-modal.title" defaultMessage="How to upload a private GLB avatar" />}
      beforeTitle={<CloseButton onClick={onClose} />}
    >
      <Column padding className={styles.content}>
        <p className={styles.intro}>
          <FormattedMessage
            id="private-glb-help-modal.intro"
            defaultMessage="This flow uploads an avatar privately to your account so you can select it from My Avatars."
          />
        </p>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <FormattedMessage
              id="private-glb-help-modal.step-1"
              defaultMessage="Create or export a compatible avatar from the tool of your choice in .glb format."
            />
          </li>
          <li className={styles.step}>
            <FormattedMessage
              id="private-glb-help-modal.step-2"
              defaultMessage="In Hubs, open Change Avatar and choose Upload GLB (private)."
            />
          </li>
          <li className={styles.step}>
            <FormattedMessage
              id="private-glb-help-modal.step-3"
              defaultMessage="Enter a name, select the .glb file and save it."
            />
          </li>
          <li className={styles.step}>
            <FormattedMessage
              id="private-glb-help-modal.step-4"
              defaultMessage="Select the avatar from My Avatars to use it in the room."
            />
          </li>
        </ol>
        <p className={styles.note}>
          <FormattedMessage
            id="private-glb-help-modal.note"
            defaultMessage="This flow does not publish the avatar in featured listings. Review the license and privacy terms of the tool used to create it separately."
          />
        </p>
      </Column>
    </Modal>
  );
}

PrivateGlbHelpModal.propTypes = {
  onClose: PropTypes.func
};
