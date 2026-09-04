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
        ["short01", "Corto con raya"],
        ["short02", "Corto natural"],
        ["bob01", "Media melena"],
        ["ponytail01", "Coleta"],
        ["afro01", "Afro"]
      ])}
      {select("top", "Prenda superior", [
        ["polo", "Polo"],
        ["blazer", "Americana y corbata"],
        ["doublebreasted", "Chaqueta cruzada"],
        ["sweater", "Jersey"],
        ["tshirt", "Camiseta"]
      ])}
      {select("bottom", "Pantalones", [
        ["suit", "Traje"],
        ["denim", "Denim entallado"],
        ["chinos", "Corte recto"],
        ["jeans", "Vaqueros clásicos"],
        ["wool", "Lana"]
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
            defaultMessage="MakeHuman, Margaret Toigo y Namuhekam · CC0. Pantalones de Mindfront y punkduck · CC BY 4.0. Adaptados para YenHubs."
          />{" "}
          <a
            href="https://static.makehumancommunity.org/assets/assetpacks.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Fuentes
          </a>
          {" · "}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
            Licencia CC BY 4.0
          </a>
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
