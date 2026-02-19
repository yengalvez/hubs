import React from "react";
import PropTypes from "prop-types";
import { FormattedMessage } from "react-intl";
import { Modal } from "../modal/Modal";
import { CloseButton } from "../input/CloseButton";
import { Button } from "../input/Button";
import { Column } from "../layout/Column";

export function AvaturnHelpModal({ onClose }) {
  return (
    <Modal
      title={<FormattedMessage id="avaturn-help-modal.title" defaultMessage="Como subir tu avatar de Avaturn" />}
      beforeTitle={<CloseButton onClick={onClose} />}
    >
      <Column padding>
        <p>
          <FormattedMessage
            id="avaturn-help-modal.intro"
            defaultMessage="Este flujo sube tu avatar como privado en tu cuenta, para elegirlo desde Mis avatares."
          />
        </p>
        <ol>
          <li>
            <FormattedMessage
              id="avaturn-help-modal.step-1"
              defaultMessage="Crea o abre tu avatar en Avaturn y exportalo como .glb."
            />
          </li>
          <li>
            <FormattedMessage
              id="avaturn-help-modal.step-2"
              defaultMessage="En Hubs, abre Cambiar avatar y pulsa Subir Avaturn (privado)."
            />
          </li>
          <li>
            <FormattedMessage
              id="avaturn-help-modal.step-3"
              defaultMessage="Pon un nombre, selecciona tu archivo .glb y guarda."
            />
          </li>
          <li>
            <FormattedMessage
              id="avaturn-help-modal.step-4"
              defaultMessage="Selecciona el avatar en Mis avatares para usarlo en la sala."
            />
          </li>
        </ol>
        <p>
          <FormattedMessage
            id="avaturn-help-modal.note"
            defaultMessage="Nota: este flujo no publica el avatar en listados destacados."
          />
        </p>
        <Button as="a" href="https://docs.avaturn.me/docs" target="_blank" rel="noopener noreferrer" preset="primary">
          <FormattedMessage id="avaturn-help-modal.link" defaultMessage="Abrir documentacion oficial de Avaturn" />
        </Button>
      </Column>
    </Modal>
  );
}

AvaturnHelpModal.propTypes = {
  onClose: PropTypes.func
};
