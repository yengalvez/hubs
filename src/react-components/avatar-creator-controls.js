import React, { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { FormattedMessage, useIntl } from "react-intl";
import { composeAvatar, CREATOR_DEFAULTS } from "../utils/avatar-creator";
import maleUrl from "../assets/models/avatar-creator/male.glb";
import femaleUrl from "../assets/models/avatar-creator/female.glb";

const urls = { male: maleUrl, female: femaleUrl };

export default function AvatarCreatorControls({ onGenerate, onLoading, onError, disabled }) {
  const intl = useIntl();
  const [options, setOptions] = useState(CREATOR_DEFAULTS);
  const cache = useRef({});
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    onLoading();
    (async () => {
      try {
        if (!cache.current[options.body]) {
          const response = await fetch(urls[options.body], { signal: controller.signal });
          if (!response.ok) throw new Error("No se pudo descargar la plantilla. Vuelve a intentarlo.");
          cache.current[options.body] = await response.arrayBuffer();
        }
        if (cancelled) return;
        const bytes = composeAvatar(cache.current[options.body], options);
        onGenerate(new File([bytes], "mi-avatar.glb", { type: "model/gltf-binary" }));
      } catch (error) {
        if (!cancelled) onError(error.message);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [options, onGenerate, onLoading, onError]);
  const select = (key, title, choices) => (
    <label style={{ display: "block", marginBottom: 16 }}>
      {title}
      <select
        aria-label={title}
        value={options[key]}
        disabled={disabled}
        onChange={e => setOptions({ ...options, [key]: e.target.value })}
        style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }}
      >
        {choices.map(([value, label]) => (
          <option value={value} key={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0 }}>
      <legend>
        <FormattedMessage id="avatar-creator.title" defaultMessage="Crea tu avatar" />
      </legend>
      <p>
        <FormattedMessage
          id="avatar-creator.help"
          defaultMessage="Personaliza tu personaje y guárdalo en Mis avatares. Sin cuenta externa."
        />
      </p>
      {select("body", "Personaje", [
        ["male", "Masculino"],
        ["female", "Femenino"]
      ])}
      {select("hair", "Peinado", [
        ["none", "Sin pelo"],
        ["simpleparted", "Raya lateral"],
        ["buzzed", "Corto"],
        ["buzzedfemale", "Corto lateral"],
        ["buns", "Recogido"],
        ["long", "Largo"]
      ])}
      {select("outfit", "Ropa", [
        ["peasant", "Túnica"],
        ["ranger", "Explorador"]
      ])}
      <label>
        <FormattedMessage id="avatar-creator.hair-color" defaultMessage="Color del pelo" />{" "}
        <input
          aria-label={intl.formatMessage({ id: "avatar-creator.hair-color", defaultMessage: "Color del pelo" })}
          type="color"
          value={options.hairColor}
          onChange={e => setOptions({ ...options, hairColor: e.target.value })}
        />
      </label>
      <p>
        <small>
          <FormattedMessage
            id="avatar-creator.credit"
            defaultMessage="Modelos de Quaternius · CC0. Adaptados para YenHubs."
          />
        </small>
      </p>
    </fieldset>
  );
}
AvatarCreatorControls.propTypes = {
  onGenerate: PropTypes.func.isRequired,
  onLoading: PropTypes.func.isRequired,
  onError: PropTypes.func.isRequired,
  disabled: PropTypes.bool
};
