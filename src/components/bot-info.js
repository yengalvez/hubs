import { getAvatarSrc } from "../utils/avatar-utils";
import { ensureAvatarNodes } from "../utils/avatar-gltf-normalizer";

const { Vector3, MathUtils } = THREE;

function normalizeAngleDeg(deg) {
  const n = Number(deg) || 0;
  return ((n % 360) + 360) % 360;
}

AFRAME.registerComponent("bot-info", {
  schema: {
    botId: { type: "string" },
    avatarId: { type: "string" },
    displayName: { type: "string", default: "Bot" },
    isBot: { default: true }
  },

  init() {
    this._avatarLoadVersion = 0;
    this._modelEl = null;
    this._onModelLoaded = null;
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

    if (this._modelEl && this._onModelLoaded) {
      this._modelEl.removeEventListener("model-loaded", this._onModelLoaded);
    }
    this._modelEl = modelEl;

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

    // Default to 0 until we can infer the avatar's actual forward axis.
    this.el.dataset.botYawOffsetDeg = "0";

    this._onModelLoaded = () => {
      if (loadVersion !== this._avatarLoadVersion) return;
      this.updateYawOffsetFromModel(modelEl);

      // Hide the placeholder once the real model is loaded.
      const placeholder = this.el.querySelector(".bot-placeholder");
      if (placeholder) {
        placeholder.object3D.visible = false;
        placeholder.setAttribute("visible", false);
      }
    };
    modelEl.addEventListener("model-loaded", this._onModelLoaded, { once: true });

    modelEl.setAttribute("gltf-model-plus", "src", avatarSrc);
    this.el.object3D.visible = true;
  },

  updateYawOffsetFromModel(modelEl) {
    const root = modelEl && modelEl.object3D;
    if (!root) return;

    if (typeof root.updateMatrixWorld === "function") {
      root.updateMatrixWorld(true);
    }

    // Try to infer the model's "forward" axis from the skeleton:
    // - up: hips -> head
    // - right: left leg -> right leg
    // - forward: right x up (right-handed), then projected onto XZ.
    const hips =
      root.getObjectByName("Hips") ||
      root.getObjectByName("hips") ||
      root.getObjectByName("mixamorigHips") ||
      root.getObjectByName("mixamorig:Hips");
    const head =
      root.getObjectByName("Head") ||
      root.getObjectByName("head") ||
      root.getObjectByName("Neck") ||
      root.getObjectByName("Spine2") ||
      root.getObjectByName("Spine1") ||
      root.getObjectByName("Spine");
    const leftLeg =
      root.getObjectByName("LeftUpLeg") ||
      root.getObjectByName("LeftLeg") ||
      root.getObjectByName("mixamorigLeftUpLeg") ||
      root.getObjectByName("mixamorig:LeftUpLeg");
    const rightLeg =
      root.getObjectByName("RightUpLeg") ||
      root.getObjectByName("RightLeg") ||
      root.getObjectByName("mixamorigRightUpLeg") ||
      root.getObjectByName("mixamorig:RightUpLeg");

    if (!hips || !head || !leftLeg || !rightLeg) {
      this.el.dataset.botYawOffsetDeg = "0";
      return;
    }

    const hipsPos = new Vector3();
    const headPos = new Vector3();
    const leftPos = new Vector3();
    const rightPos = new Vector3();
    hips.getWorldPosition(hipsPos);
    head.getWorldPosition(headPos);
    leftLeg.getWorldPosition(leftPos);
    rightLeg.getWorldPosition(rightPos);

    const up = headPos.sub(hipsPos);
    const right = rightPos.sub(leftPos);
    if (up.lengthSq() < 1e-6 || right.lengthSq() < 1e-6) {
      this.el.dataset.botYawOffsetDeg = "0";
      return;
    }
    up.normalize();
    right.normalize();

    const forwardWorld = new Vector3().copy(right).cross(up);
    if (forwardWorld.lengthSq() < 1e-6) {
      this.el.dataset.botYawOffsetDeg = "0";
      return;
    }
    forwardWorld.normalize();

    // Disambiguate the "front" direction using the eyes (real or injected by the GLTF normalizer).
    // Many rigs have a consistent left/right/up basis but may still be flipped 180deg relative to
    // their visible facing direction. The midpoint between the eyes should always be "in front"
    // of the hips for humanoids. If our computed forward points away from the eyes, flip it.
    const leftEye = root.getObjectByName("LeftEye");
    const rightEye = root.getObjectByName("RightEye");
    if (leftEye && rightEye) {
      const leftEyePos = new Vector3();
      const rightEyePos = new Vector3();
      leftEye.getWorldPosition(leftEyePos);
      rightEye.getWorldPosition(rightEyePos);
      const eyeMid = leftEyePos.add(rightEyePos).multiplyScalar(0.5);
      const faceDir = eyeMid.sub(hipsPos);
      faceDir.y = 0;
      if (faceDir.lengthSq() > 1e-6) {
        faceDir.normalize();
        const f = forwardWorld.clone();
        f.y = 0;
        if (f.lengthSq() > 1e-6) {
          f.normalize();
          if (f.dot(faceDir) < 0) {
            forwardWorld.multiplyScalar(-1);
          }
        }
      }
    }

    // Convert to bot-local space so this works regardless of the bot's current yaw.
    const botRoot = this.el.object3D;
    if (!botRoot) {
      this.el.dataset.botYawOffsetDeg = "0";
      return;
    }
    const invBotQuat = botRoot.quaternion.clone().invert();
    const forwardLocal = forwardWorld.applyQuaternion(invBotQuat);
    forwardLocal.y = 0;
    if (forwardLocal.lengthSq() < 1e-6) {
      this.el.dataset.botYawOffsetDeg = "0";
      return;
    }
    forwardLocal.normalize();

    // `bot-runner-system` defines yaw such that +Z faces the direction of travel. If the model's
    // natural forward is rotated, compensate here so bots always face forward while moving.
    const forwardYawDeg = MathUtils.radToDeg(Math.atan2(forwardLocal.x, forwardLocal.z));
    this.el.dataset.botYawOffsetDeg = String(normalizeAngleDeg(forwardYawDeg));
  }
});
