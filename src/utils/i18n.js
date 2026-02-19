import configs from "./configs";
import { AVAILABLE_LOCALES, FALLBACK_LOCALES } from "../assets/locales/locale_config";

// These are set in the admin panel and are only included as fallbacks.
const defaultLocaleData = {
  "app-name": location.hostname,
  "editor-name": "Editor de Escenas",
  "contact-email": "app@company.com",
  "company-name": "Comunidad",
  "share-hashtag": "#app",
  // what you can do here
  "app-description": "Reúnete, comparte y colabora en un espacio virtual privado y seguro.",
  "app-tagline": "VR social privada en tu navegador"
};

const DEFAULT_LOCALE = "es";
const cachedMessages = new Map();
const cachedLocaleData = new Map();

let _locale = DEFAULT_LOCALE;
let _localeData = defaultLocaleData;
let _localeRequestId = 0;

function findLocale(locale) {
  const locales = (() => {
    if (navigator.languages) {
      return [...navigator.languages];
    }
    if (navigator.language) {
      return [navigator.language];
    }
    if (navigator.userLanguage) {
      return [navigator.userLanguage];
    }
  })();

  if (locale && locale !== "browser") {
    locales.unshift(locale);
  }

  for (let i = 0; i < locales.length; i++) {
    const curLocale = locales[i];
    if (Object.prototype.hasOwnProperty.call(AVAILABLE_LOCALES, curLocale)) {
      return curLocale;
    }
    if (Object.prototype.hasOwnProperty.call(FALLBACK_LOCALES, curLocale)) {
      return FALLBACK_LOCALES[curLocale];
    }
    // Also check the primary language subtag in case
    // we do not have an entry for full tag
    // See https://en.wikipedia.org/wiki/IETF_language_tag#Syntax_of_language_tags
    // and https://github.com/Hubs-Foundation/hubs/pull/3350/files#diff-70ef5717d3da03ef288e8d15c2fda32c5237d7f37074421496f22403e4475bf1R16
    const primaryLanguageSubtag = curLocale.split("-")[0].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(AVAILABLE_LOCALES, primaryLanguageSubtag)) {
      return primaryLanguageSubtag;
    }
    if (Object.prototype.hasOwnProperty.call(FALLBACK_LOCALES, primaryLanguageSubtag)) {
      return FALLBACK_LOCALES[primaryLanguageSubtag];
    }
  }
  return DEFAULT_LOCALE;
}

function mergeLocaleData(localeData) {
  return { ...defaultLocaleData, ...(localeData || {}) };
}

function loadLocaleData(locale) {
  if (cachedLocaleData.has(locale)) {
    return Promise.resolve(cachedLocaleData.get(locale));
  }

  return import(`../assets/locales/${locale}.json`)
    .then(({ default: localeData }) => {
      const mergedLocaleData = mergeLocaleData(localeData);
      cachedLocaleData.set(locale, mergedLocaleData);
      return mergedLocaleData;
    })
    .catch(error => {
      console.warn(`Failed loading locale "${locale}", falling back to defaults.`, error);
      const fallbackLocaleData = mergeLocaleData();
      cachedLocaleData.set(locale, fallbackLocaleData);
      return fallbackLocaleData;
    });
}

export function setLocale(locale) {
  const resolvedLocale = findLocale(locale);
  const requestId = ++_localeRequestId;

  loadLocaleData(resolvedLocale).then(localeData => {
    // Ignore stale async locale responses.
    if (requestId !== _localeRequestId) return;

    _locale = resolvedLocale;
    _localeData = localeData;
    cachedMessages.delete(_locale);
    window.dispatchEvent(new CustomEvent("locale-updated"));
  });
}

const interval = window.setInterval(() => {
  if (window.APP && window.APP.store) {
    window.clearInterval(interval);
    setLocale("es");
    window.APP.store.addEventListener("statechanged", () => {
      setLocale("es");
    });
  }
}, 100);

export const getLocale = () => {
  return _locale;
};

export const getMessage = key => {
  return _localeData[key];
};

// TODO: This should be removed, lets not inject app config data up front but rather via variables so that defaultMessage works properly.
export const getMessages = () => {
  if (cachedMessages.has(_locale)) {
    return cachedMessages.get(_locale);
  }

  // Swap in translations specified via the admin panel
  if (configs.APP_CONFIG && configs.APP_CONFIG.translations && configs.APP_CONFIG.translations[_locale]) {
    const configTranslations = configs.APP_CONFIG.translations[_locale];
    for (const messageKey in configTranslations) {
      if (!Object.prototype.hasOwnProperty.call(configTranslations, messageKey)) continue;
      if (!configTranslations[messageKey]) continue;
      _localeData[messageKey] = configTranslations[messageKey];
    }
  }

  const entries = [];
  for (const key in _localeData) {
    if (!Object.prototype.hasOwnProperty.call(_localeData, key)) continue;
    entries.push([key, _localeData[key]]);
  }

  const messages = entries
    .map(([key, message]) => [
      key,
      // Replace nested message keys (e.g. %app-name%) with their messages.
      message.replace(/%([\w-.]+)%/i, (_match, subkey) => _localeData[subkey])
    ])
    .reduce((acc, entry) => {
      acc[entry[0]] = entry[1];
      return acc;
    }, {});

  cachedMessages.set(_locale, messages);
  return messages;
};
