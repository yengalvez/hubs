import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import configs from "../../utils/configs";
import { registerDarkModeQuery } from "../../utils/theme";

function useDarkMode() {
  const [darkMode, setDarkMode] = useState(false);

  const changeListener = useCallback(
    event => {
      setDarkMode(event.matches);
    },
    [setDarkMode]
  );

  useEffect(() => {
    const [darkModeQuery, removeListener] = registerDarkModeQuery(changeListener);

    setDarkMode(darkModeQuery.matches);

    return removeListener;
  }, [changeListener]);

  return darkMode;
}

export function useTheme(themeId) {
  const darkMode = useDarkMode();

  useEffect(() => {
    // Custom theme variable injection is disabled so the metaverse glass theme stays consistent.
    document.body.setAttribute("data-theme", "dark");
  }, [themeId, darkMode]);
}

function getAppLogo() {
  return configs.image("logo_dark") || configs.image("logo");
}

export function useLogo() {
  return getAppLogo();
}

export function useThemeFromStore(store) {
  const [themeId, setThemeId] = useState(store?.state?.preferences?.theme);

  useEffect(() => {
    function onStoreChanged() {
      const nextThemeId = store.state?.preferences?.theme;

      if (themeId !== nextThemeId) {
        setThemeId(nextThemeId);
      }
    }

    if (store) {
      store.addEventListener("statechanged", onStoreChanged);
    }

    return () => {
      if (store) {
        store.removeEventListener("statechanged", onStoreChanged);
      }
    };
  });

  useTheme(themeId);
}

export function ThemeProvider({ store, children }) {
  useThemeFromStore(store);
  return children;
}

ThemeProvider.propTypes = {
  store: PropTypes.object,
  children: PropTypes.node
};
