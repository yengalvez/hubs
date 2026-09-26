import test from "ava";

require("../../../scripts/shim");

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { IntlProvider } = require("react-intl");
const Module = require("module");
const originalLoad = Module._load;
Module._load = function loadMediaTilesWithIsolatedIcons(request, parent, isMain) {
  if (request.startsWith("../icons/") && request.endsWith(".svg")) {
    return { ReactComponent: () => React.createElement("svg") };
  }
  return originalLoad.call(this, request, parent, isMain);
};
let MediaTile;
try {
  MediaTile = require("../../../src/react-components/room/MediaTiles").MediaTile;
} finally {
  Module._load = originalLoad;
}

function entry(type = "avatar_listing", previewType = "png") {
  return {
    id: "catalog-avatar",
    type,
    name: "Approved avatar",
    url: "/avatars/catalog-avatar",
    images: {
      preview: { url: "/files/approved-preview.png", type: previewType, width: 720, height: 1280 }
    }
  };
}

function renderTile(props) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    React.createElement(IntlProvider, { locale: "en" }, React.createElement(MediaTile, props))
  );
  return container;
}

test("catalog thumbnails default to native lazy loading with async decoding and unchanged framing", t => {
  const avatar = entry();
  const container = renderTile({ entry: avatar });
  const image = container.querySelector("img");
  t.is(image.getAttribute("loading"), "lazy");
  t.is(image.getAttribute("decoding"), "async");
  t.is(image.getAttribute("src"), avatar.images.preview.url);
  t.is(image.getAttribute("alt"), avatar.name);
  t.is(image.getAttribute("width"), "185");
  t.is(image.getAttribute("height"), "330");
  t.is(image.parentElement.getAttribute("href"), avatar.url);
});

test("above-fold thumbnails support eager loading without leaking the control prop onto the tile", t => {
  const container = renderTile({ entry: entry(), thumbnailLoading: "eager" });
  const image = container.querySelector("img");
  t.is(image.getAttribute("loading"), "eager");
  t.is(image.getAttribute("decoding"), "async");
  t.is(container.querySelector("[thumbnailloading]"), null);
});

test("the existing thumbnail URL processor still receives exactly the original dimensions", t => {
  const avatar = entry();
  const calls = [];
  const container = renderTile({
    entry: avatar,
    thumbnailLoading: "lazy",
    processThumbnailUrl: (...args) => {
      calls.push(args);
      return "/existing-transform?width=185&height=330";
    }
  });
  t.deepEqual(calls, [[avatar, 185, 330]]);
  t.is(container.querySelector("img").getAttribute("src"), "/existing-transform?width=185&height=330");
});

test("video previews retain their existing playback behavior without image-only loading attributes", t => {
  const preview = entry("avatar_listing", "mp4");
  preview.images.preview.url = "/files/existing-preview.mp4";
  const container = renderTile({ entry: preview, thumbnailLoading: "lazy" });
  const video = container.querySelector("video");
  t.is(container.querySelector("img"), null);
  t.is(video.getAttribute("src"), preview.images.preview.url);
  t.true(video.hasAttribute("autoplay"));
  t.true(video.hasAttribute("playsinline"));
  t.true(video.hasAttribute("loop"));
  t.false(video.hasAttribute("loading"));
  t.false(video.hasAttribute("decoding"));
  t.is(video.getAttribute("width"), "185");
  t.is(video.getAttribute("height"), "330");
});
