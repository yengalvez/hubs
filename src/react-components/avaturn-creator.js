import React, { Component } from "react";
import PropTypes from "prop-types";
import { FormattedMessage } from "react-intl";
import { AvaturnSDK } from "@avaturn/sdk";

import { avaturnExportToFile, normalizeAvaturnCreatorUrl } from "../utils/avaturn-utils";

export default class AvaturnCreator extends Component {
  static propTypes = {
    creatorUrl: PropTypes.string.isRequired,
    disabled: PropTypes.bool,
    onExport: PropTypes.func.isRequired,
    onExportStart: PropTypes.func,
    onError: PropTypes.func
  };

  state = { status: "loading", error: null };

  async componentDidMount() {
    this.unmounted = false;
    const creatorUrl = normalizeAvaturnCreatorUrl(this.props.creatorUrl);
    if (!creatorUrl) {
      this.fail("La dirección configurada para Avaturn no es válida.");
      return;
    }

    const sdk = new AvaturnSDK();
    this.sdk = sdk;
    try {
      await sdk.init(this.container, { url: creatorUrl, iframeClassName: "avaturn-sdk-frame" });
      if (this.unmounted || this.sdk !== sdk) {
        sdk.destroy();
        return;
      }
      sdk.on("export", this.handleExport);
      sdk.on("error", () => this.fail("Avaturn no pudo completar el avatar. Inténtalo de nuevo."));
      this.setState({ status: "ready", error: null });
    } catch {
      this.fail("No se pudo abrir Avaturn. Comprueba tu conexión e inténtalo de nuevo.");
    }
  }

  componentWillUnmount() {
    this.unmounted = true;
    if (this.sdk) this.sdk.destroy();
    this.sdk = null;
    if (this.container) this.container.replaceChildren();
  }

  fail = message => {
    if (this.unmounted) return;
    this.setState({ status: "error", error: message });
    if (this.props.onError) this.props.onError(message);
  };

  handleExport = async result => {
    if (this.unmounted || this.props.disabled || this.state.status === "exporting") return;
    this.setState({ status: "exporting", error: null });
    if (this.props.onExportStart) this.props.onExportStart();

    try {
      const file = await avaturnExportToFile(result, this.props.creatorUrl);
      const accepted = await this.props.onExport(file);
      if (accepted === false) throw new Error("Avaturn devolvió un avatar que YenHubs no puede usar.");
      if (!this.unmounted) this.setState({ status: "received", error: null });
    } catch (error) {
      this.fail(error && error.message ? error.message : "No se pudo importar el avatar desde Avaturn.");
    }
  };

  render() {
    const { status, error } = this.state;
    return (
      <section className="avaturn-creator" aria-busy={status === "loading" || status === "exporting"}>
        <div className="avaturn-intro">
          <strong>
            <FormattedMessage id="avaturn-creator.title" defaultMessage="Crea tu avatar realista" />
          </strong>
          <p>
            <FormattedMessage
              id="avaturn-creator.help"
              defaultMessage="Sign in to Avaturn with Google or email, create your character and press Next. YenHubs will save it automatically."
            />
          </p>
          <small>
            <FormattedMessage
              id="avaturn-creator.privacy"
              defaultMessage="Your photo and Avaturn account are processed by Avaturn under its own privacy terms."
            />
          </small>
        </div>
        {status === "loading" && (
          <p className="avaturn-status">
            <FormattedMessage id="avaturn-creator.loading" defaultMessage="Opening Avaturn..." />
          </p>
        )}
        {status === "exporting" && (
          <p className="avaturn-status">
            <FormattedMessage
              id="avaturn-creator.importing"
              defaultMessage="Receiving and checking your avatar. It will be saved automatically..."
            />
          </p>
        )}
        {status === "received" && (
          <p className="avaturn-status" role="status">
            <FormattedMessage
              id="avaturn-creator.received"
              defaultMessage="Avatar received correctly. YenHubs is checking it and will save it to your account."
            />
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="avaturn-sdk-container" ref={element => (this.container = element)} />
      </section>
    );
  }
}
