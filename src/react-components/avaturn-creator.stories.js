import React from "react";

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
          <AvaturnCreator creatorUrl="https://demo.avaturn.dev" onExportStart={() => {}} onExport={async () => true} />
        </div>
      </div>
    </div>
  </div>
);
