import test from "ava";

require("../../../scripts/shim");

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { IntlProvider } = require("react-intl");
const Module = require("module");
let logoUrl;
const originalLoad = Module._load;
Module._load = function loadAvatarPageLogoWithIsolatedConfig(request, parent, isMain) {
  if (request === "../utils/configs") return { image: () => logoUrl };
  return originalLoad.call(this, request, parent, isMain);
};
let AvatarPageLogo;
try {
  AvatarPageLogo = require("../../../src/react-components/avatar-page-logo").AvatarPageLogo;
} finally {
  Module._load = originalLoad;
}

function renderLogo(messages = {}, locale = "es") {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale, messages },
      React.createElement(AvatarPageLogo, { className: "approved-logo-layout" })
    )
  );
}

test.serial("avatar landing omits the logo when config suppresses the placeholder", t => {
  for (const value of [null, undefined, ""]) {
    logoUrl = value;
    t.is(renderLogo(), "");
  }
});

test.serial("configured avatar branding keeps its URL and layout with a translated text alt", t => {
  logoUrl = "/files/approved-brand.png";
  const container = document.createElement("div");
  container.innerHTML = renderLogo({ "avatar-page.logo": "Logotipo" });
  const image = container.querySelector("img");
  t.is(image.getAttribute("src"), logoUrl);
  t.is(image.className, "approved-logo-layout");
  t.is(image.getAttribute("alt"), "Logotipo");
  t.false(container.innerHTML.includes("[object Object]"));
});

test.serial("configured avatar branding has a plain-text default alt", t => {
  logoUrl = "/files/approved-brand.png";
  const container = document.createElement("div");
  container.innerHTML = renderLogo({}, "en");
  t.is(container.querySelector("img").getAttribute("alt"), "Logo");
});
