import { getAvatarSrc } from "../utils/avatar-utils";
import { ensureAvatarNodes } from "../utils/avatar-gltf-normalizer";

AFRAME.registerComponent("bot-info", {
  schema: {
    botId: { type: "string" },
    avatarId: { type: "string" },
    displayName: { type: "string", default: "Bot" },
    isBot: { default: true }
  },

  init() {
    this._avatarLoadVersion = 0;
    this.el.classList.add("hubs-room-bot");
    this.applyMetadata();
  },

  update(oldData) {
    if (this.data.botId !== oldData.botId || this.data.displayName !== oldData.displayName) {
      this.applyMetadata();
    }

    if (this.data.avatarId !== oldData.avatarId) {
      this.applyAvatar();
    }
  },

  applyMetadata() {
    this.el.dataset.botId = this.data.botId || "";
    this.el.dataset.botName = this.data.displayName || "Bot";
  },

  async applyAvatar() {
    const avatarId = this.data.avatarId;
    if (!avatarId) return;

    const modelEl = this.el.querySelector(".model");
    if (!modelEl) return;

    const gltfModelPlus = modelEl.components && modelEl.components["gltf-model-plus"];
    if (gltfModelPlus) {
      gltfModelPlus.jsonPreprocessor = ensureAvatarNodes;
    }

    const loadVersion = ++this._avatarLoadVersion;
    let avatarSrc;

    try {
      avatarSrc = await getAvatarSrc(avatarId);
    } catch (e) {
      console.warn("Failed to resolve bot avatar source", avatarId, e);
      return;
    }

    if (loadVersion !== this._avatarLoadVersion || !avatarSrc) return;

    modelEl.setAttribute("gltf-model-plus", "src", avatarSrc);
    this.el.object3D.visible = true;
  }
});
