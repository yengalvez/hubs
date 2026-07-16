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
      title={<FormattedMessage id="private-glb-help-modal.title" defaultMessage="Cómo subir un avatar GLB privado" />}
      beforeTitle={<CloseButton onClick={onClose} />}
    >
      <Column padding className={styles.content}>
        <p className={styles.intro}>
          <FormattedMessage
            id="private-glb-help-modal.intro"
            defaultMessage="Este flujo sube tu avatar como privado en tu cuenta, para elegirlo desde Mis avatares."
          />
        </p>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <FormattedMessage
              id="private-glb-help-modal.step-1"
              defaultMessage="Crea o exporta un avatar compatible desde la herramienta que elijas en formato .glb."
            />
          </li>
          <li className={styles.step}>
            <FormattedMessage
              id="private-glb-help-modal.step-2"
              defaultMessage="En Hubs, abre Cambiar avatar y pulsa Subir GLB (privado)."
            />
          </li>
          <li className={styles.step}>
            <FormattedMessage
              id="private-glb-help-modal.step-3"
              defaultMessage="Pon un nombre, selecciona tu archivo .glb y guarda."
            />
          </li>
          <li className={styles.step}>
            <FormattedMessage
              id="private-glb-help-modal.step-4"
              defaultMessage="Selecciona el avatar en Mis avatares para usarlo en la sala."
            />
          </li>
        </ol>
        <p className={styles.note}>
          <FormattedMessage
            id="private-glb-help-modal.note"
            defaultMessage="Este flujo no publica el avatar en listados destacados. Revisa por separado la licencia y privacidad de la herramienta con la que lo creaste."
          />
        </p>
      </Column>
    </Modal>
  );
}

PrivateGlbHelpModal.propTypes = {
  onClose: PropTypes.func
};
