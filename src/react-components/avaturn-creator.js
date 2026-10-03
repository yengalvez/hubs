import React, { Component } from "react";
import PropTypes from "prop-types";
import { FormattedMessage } from "react-intl";
import configs from "../utils/configs";
import { loadAvaturnSdk } from "../utils/avaturn-sdk";
import { avaturnExportToFile, normalizeAvaturnCreatorUrl, withAvaturnDeadline } from "../utils/avaturn-utils";

export default class AvaturnCreator extends Component {
  static propTypes = {
    creatorUrl: PropTypes.string.isRequired,
    disabled: PropTypes.bool,
    validationError: PropTypes.string,
    onExport: PropTypes.func.isRequired,
    onExportStart: PropTypes.func,
    onError: PropTypes.func
  };

  state = { status: "loading", error: null };

  componentDidMount() {
    this.unsubscribeProductModules = configs.subscribeToProductModules(this.onProductModulesChanged);
    return this.start();
  }

  onProductModulesChanged = () => {
    if (!this.isEnabled() || !this.session) this.start();
  };

  componentDidUpdate(previousProps) {
    if (previousProps.creatorUrl !== this.props.creatorUrl || (!this.isEnabled() && this.session)) {
      this.start();
    } else if (
      this.props.validationError &&
      this.props.validationError !== previousProps.validationError &&
      !this.props.disabled
    ) {
      // Header acceptance precedes rig/preview validation. A rejected preview
      // must permit a new export, but a saved/in-flight avatar stays locked.
      this.exportLocked = false;
      this.fail(this.props.validationError);
    }
  }

  isEnabled = () =>
    configs.feature("enable_avaturn_creator") === true && !!normalizeAvaturnCreatorUrl(this.props.creatorUrl);

  stop = () => {
    if (this.session) this.session.abort();
    this.session = null;
    if (this.sdk) this.sdk.destroy();
    this.sdk = null;
    if (this.container) this.container.replaceChildren();
  };

  start = async () => {
    this.stop();
    this.unmounted = false;
    this.exportLocked = false;
    const creatorUrl = normalizeAvaturnCreatorUrl(this.props.creatorUrl);
    if (!this.isEnabled()) {
      this.setState({ status: "unavailable", error: "El creador Avaturn no está disponible en esta instalación." });
      return;
    }
    const session = new AbortController();
    this.session = session;
    this.setState({ status: "loading", error: null });
    try {
      await withAvaturnDeadline(
        async signal => {
          const sdk = await loadAvaturnSdk(creatorUrl);
          if (signal.aborted || this.session !== session || !this.isEnabled()) {
            sdk.destroy();
            return;
          }
          this.sdk = sdk;
          await sdk.init(this.container, { url: creatorUrl, iframeClassName: "avaturn-sdk-frame" });
        },
        {
          signal: session.signal,
          timeoutMs: 30000,
          timeoutMessage: "Avaturn no respondió a tiempo. Inténtalo de nuevo."
        }
      );
      if (this.unmounted || this.session !== session || !this.isEnabled()) return;
      const sdk = this.sdk;
      if (!sdk) return;
      sdk.on("export", result => {
        if (this.unmounted || this.session !== session) return;
        return this.handleExport(result);
      });
      sdk.on("error", () => {
        if (this.session === session && !this.exportLocked) {
          this.fail("Avaturn no pudo completar el avatar. Inténtalo de nuevo.");
        }
      });
      this.setState({ status: "ready", error: null });
    } catch (error) {
      if (this.unmounted || this.session !== session) return;
      this.stop();
      this.fail(
        error.name === "TimeoutError"
          ? error.message
          : "No se pudo abrir Avaturn. Comprueba tu conexión e inténtalo de nuevo."
      );
    }
  };

  componentWillUnmount() {
    this.unmounted = true;
    this.unsubscribeProductModules?.();
    this.stop();
  }

  fail = message => {
    if (this.unmounted) return;
    this.setState({ status: "error", error: message });
    if (this.props.onError) this.props.onError(message);
  };

  handleExport = async result => {
    if (this.unmounted || !this.isEnabled() || !this.session || this.props.disabled || this.exportLocked) return;
    // Synchronous lock: React state is not a mutex for two callbacks in one tick.
    this.exportLocked = true;
    const session = this.session;
    if (this.props.onExportStart && this.props.onExportStart() === false) return;
    this.setState({ status: "exporting", error: null });

    try {
      const file = await avaturnExportToFile(result, this.props.creatorUrl, { signal: session.signal });
      if (this.unmounted || this.session !== session || !this.isEnabled()) return;
      const accepted = await this.props.onExport(file);
      if (accepted === false) throw new Error("Avaturn devolvió un avatar que YenHubs no puede usar.");
      if (this.props.validationError) throw new Error(this.props.validationError);
      if (!this.unmounted && this.session === session) this.setState({ status: "received", error: null });
    } catch (error) {
      if (this.unmounted || this.session !== session) return;
      this.exportLocked = false;
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
        {status === "error" && !this.props.disabled && (
          <button type="button" onClick={this.start}>
            <FormattedMessage id="avaturn-creator.retry" defaultMessage="Reintentar Avaturn" />
          </button>
        )}
        <div className="avaturn-sdk-container" ref={element => (this.container = element)} />
      </section>
    );
  }
}
