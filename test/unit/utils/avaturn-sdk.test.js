import test from "ava";

require("../../../scripts/shim");
const { createGuardedAvaturnSdk } = require("../../../src/utils/avaturn-sdk");
// Exercise the installed, pinned ESM SDK without copying its dispatcher into
// a mock. AVA's CommonJS Babel setup cannot require this ESM package directly.
const { transformFileSync } = require("@babel/core");
const { runInNewContext } = require("node:vm");
const sdkExports = {};
const { code } = transformFileSync(require.resolve("@avaturn/sdk"), {
  babelrc: false,
  configFile: false,
  plugins: ["@babel/plugin-transform-modules-commonjs"]
});
runInNewContext(code, { exports: sdkExports, window, document, URL, console });

test.serial("installed SDK gates forged handshake, export and error before dispatch", async t => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const origin = "https://yenhubs.avaturn.dev";
  const sdk = createGuardedAvaturnSdk(sdkExports.AvaturnSDK, origin);
  let ready = false;
  let exports = 0;
  let errors = 0;
  const init = sdk.init(container, { url: origin }).then(() => {
    ready = true;
  });
  const frame = container.querySelector("iframe");
  t.truthy(frame);
  const send = (data, source = frame.contentWindow, messageOrigin = origin) =>
    window.dispatchEvent(new window.MessageEvent("message", { data, source, origin: messageOrigin }));
  const handshake = { source: "v1.avaturn-sdk-server", type: "RESPONSE", key: "sdk_handshake", isOk: true };
  send(handshake, window);
  send(handshake, frame.contentWindow, "https://other.avaturn.dev");
  send(handshake, frame.contentWindow, "https://yenhubs.avaturn.dev.evil.example");
  send(null);
  await Promise.resolve();
  t.false(ready);
  send(handshake);
  await init;
  t.true(ready);
  sdk.on("export", () => exports++);
  sdk.on("error", () => errors++);
  const exported = {
    source: "v1.avaturn-sdk-server",
    type: "MESSAGE",
    eventName: "callback_event",
    key: "export",
    data: {}
  };
  const error = { ...exported, eventName: "report_error" };
  for (const payload of [exported, error]) {
    send(payload, window);
    send(payload, frame.contentWindow, "https://other.avaturn.dev");
    send(payload, frame.contentWindow, "null");
  }
  t.is(exports, 0);
  t.is(errors, 0);
  send(exported);
  send(error);
  t.is(exports, 1);
  t.is(errors, 1);
  sdk.destroy();
  send(exported);
  t.is(exports, 1);
  container.remove();
});

test("an incompatible SDK or invalid creator fails closed", t => {
  t.throws(() => createGuardedAvaturnSdk(class {}, "https://yenhubs.avaturn.dev"));
  t.throws(() => createGuardedAvaturnSdk(sdkExports.AvaturnSDK, "https://evil.example"));
});
