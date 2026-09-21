import React from "react";
import { FormattedMessage } from "react-intl";

import AvaturnCreator from "./avaturn-creator";
import styles from "../assets/stylesheets/avatar-editor.scss";

export default {
  title: "Avatar/Avaturn creator",
  component: AvaturnCreator,
  parameters: { layout: "fullscreen" }
};

export const LoginAndCreator = () => (
  <div className={`${styles.avatarEditor} avaturn-mode`}>
    <div className="center">
      <div className="split">
        <div className="form-body">
          <p className="mode-info">
            <FormattedMessage
              id="avaturn-story.preview-note"
              defaultMessage="Local preview: you can review Avaturn and confirm YenHubs receives the character, but this isolated screen does not upload it to your account."
            />
          </p>
          <AvaturnCreator creatorUrl="https://demo.avaturn.dev" onExportStart={() => {}} onExport={async () => true} />
        </div>
      </div>
    </div>
  </div>
);
