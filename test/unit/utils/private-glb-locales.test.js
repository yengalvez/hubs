import test from "ava";
import path from "path";

import spanish from "../../../src/assets/locales/es.json";

const { extract } = require("@formatjs/cli-lib");

const expectedEnglish = {
  "avatar-editor.private-glb-info":
    "This avatar is uploaded privately to your account and is not published in featured listings.",
  "avatar-editor.field.private-glb": "Custom GLB file",
  "private-glb-help-modal.intro":
    "This flow uploads an avatar privately to your account so you can select it from My Avatars.",
  "private-glb-help-modal.note":
    "This flow does not publish the avatar in featured listings. Review the license and privacy terms of the tool used to create it separately.",
  "private-glb-help-modal.step-1": "Create or export a compatible avatar from the tool of your choice in .glb format.",
  "private-glb-help-modal.step-2": "In Hubs, open Change Avatar and choose Upload GLB (private).",
  "private-glb-help-modal.step-3": "Enter a name, select the .glb file and save it.",
  "private-glb-help-modal.step-4": "Select the avatar from My Avatars to use it in the room.",
  "private-glb-help-modal.title": "How to upload a private GLB avatar",
  "media-browser.private-glb-help": "GLB guide",
  "media-browser.create-private-glb": "Upload GLB (private)"
};

const expectedSpanish = {
  "avatar-editor.private-glb-info":
    "Este avatar se sube como privado para tu cuenta y no se publica en listados destacados.",
  "avatar-editor.field.private-glb": "Archivo GLB personalizado",
  "private-glb-help-modal.intro":
    "Este flujo sube tu avatar como privado en tu cuenta, para elegirlo desde Mis avatares.",
  "private-glb-help-modal.note":
    "Este flujo no publica el avatar en listados destacados. Revisa por separado la licencia y privacidad de la herramienta con la que lo creaste.",
  "private-glb-help-modal.step-1":
    "Crea o exporta un avatar compatible desde la herramienta que elijas en formato .glb.",
  "private-glb-help-modal.step-2": "En Hubs, abre Cambiar avatar y pulsa Subir GLB (privado).",
  "private-glb-help-modal.step-3": "Pon un nombre, selecciona tu archivo .glb y guarda.",
  "private-glb-help-modal.step-4": "Selecciona el avatar en Mis avatares para usarlo en la sala.",
  "private-glb-help-modal.title": "Cómo subir un avatar GLB privado",
  "media-browser.private-glb-help": "Guía GLB",
  "media-browser.create-private-glb": "Subir GLB (privado)"
};

const legacyProviderMessageIds = [
  "avatar-editor.avaturn-private-info",
  "avatar-editor.field.avaturn-glb",
  "avaturn-help-modal.intro",
  "avaturn-help-modal.link",
  "avaturn-help-modal.note",
  "avaturn-help-modal.step-1",
  "avaturn-help-modal.step-2",
  "avaturn-help-modal.step-3",
  "avaturn-help-modal.step-4",
  "avaturn-help-modal.title",
  "media-browser.avaturn-help",
  "media-browser.create-avaturn-private"
];

async function extractPrivateGlbSourceMessages() {
  const sourceFiles = [
    "src/react-components/avatar-editor.js",
    "src/react-components/media-browser.js",
    "src/react-components/room/PrivateGlbHelpModal.js"
  ].map(file => path.resolve(__dirname, "../../..", file));

  const output = await extract(sourceFiles, {
    extractSourceLocation: false,
    extractFromFormatMessageCall: true,
    removeDefaultMessage: false,
    format: {
      format(messages) {
        return Object.fromEntries(Object.entries(messages).map(([id, message]) => [id, message.defaultMessage]));
      }
    }
  });

  return JSON.parse(output);
}

test("private GLB source defaults and tracked Spanish translations are complete", async t => {
  const english = await extractPrivateGlbSourceMessages();

  for (const [id, defaultMessage] of Object.entries(expectedEnglish)) {
    t.is(english[id], defaultMessage, `${id} has the provider-neutral English source default`);
    t.is(spanish[id], expectedSpanish[id], `${id} has the reviewed Spanish translation`);
  }
});

test("active private GLB messages contain no legacy provider UI ids or copy", async t => {
  const english = await extractPrivateGlbSourceMessages();

  for (const id of legacyProviderMessageIds) {
    t.false(Object.prototype.hasOwnProperty.call(english, id));
    t.false(Object.prototype.hasOwnProperty.call(spanish, id));
  }
  for (const id of Object.keys(expectedEnglish)) {
    t.false(/avaturn/i.test(english[id]));
    t.false(/avaturn/i.test(spanish[id]));
  }
});
