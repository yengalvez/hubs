const InterpolationBuffer = require("buffered-interpolation");

import { getAvatarSrc } from "../utils/avatar-utils";
import { ensureAvatarNodes } from "../utils/avatar-gltf-normalizer";

const { Vector3, Quaternion, Euler, MathUtils } = THREE;

const SNAP_DISTANCE_M = 4;
const SNAP_DISTANCE_SQ = SNAP_DISTANCE_M * SNAP_DISTANCE_M;

AFRAME.registerComponent("bot-info", {
  schema: {
    botId: { type: "string" },
    avatarId: { type: "string" },
    displayName: { type: "string", default: "Bot" },
    isBot: { default: true }
  },

  init() {
    this._avatarLoadVersion = 0;
    this._interp = null;
    this._interpTargetPos = new Vector3();
    this._interpTargetQuat = new Quaternion();
    this._interpEuler = new Euler();
    this._lastNetworkPos = null;
    this._lastNetworkYaw = null;

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

  ensureInterp() {
    if (this._interp) return this._interp;
    // 80ms buffer smooths 10Hz network updates without feeling laggy.
    this._interp = new InterpolationBuffer(undefined, 0.08);
    return this._interp;
  },

  tick(_t, dt) {
    const net = this.el.components && this.el.components.networked;
    if (!net || !net.initialized || net.isMine()) return;

    const pos = this.el.getAttribute("position");
    const rot = this.el.getAttribute("rotation");
    if (!pos || !rot) return;

    const yaw = Number(rot.y) || 0;

    const hasPrev = !!this._lastNetworkPos;
    const posChanged =
      !hasPrev ||
      Math.abs(pos.x - this._lastNetworkPos.x) > 0.001 ||
      Math.abs(pos.y - this._lastNetworkPos.y) > 0.001 ||
      Math.abs(pos.z - this._lastNetworkPos.z) > 0.001;
    const yawChanged = this._lastNetworkYaw === null || Math.abs(yaw - this._lastNetworkYaw) > 0.05;

    if (posChanged || yawChanged) {
      if (!this._lastNetworkPos) {
        this._lastNetworkPos = new Vector3(pos.x, pos.y, pos.z);
      }

      const dx = pos.x - this._lastNetworkPos.x;
      const dy = pos.y - this._lastNetworkPos.y;
      const dz = pos.z - this._lastNetworkPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      // Large jumps (respawn/late instantiation) should snap instead of "gliding" through walls.
      if (distSq > SNAP_DISTANCE_SQ) {
        this._interp = null;
        this._lastNetworkPos.set(pos.x, pos.y, pos.z);
        this._lastNetworkYaw = yaw;
        this.el.object3D.position.set(pos.x, pos.y, pos.z);
        this.el.object3D.rotation.set(0, MathUtils.degToRad(yaw), 0);
        this.el.object3D.matrixNeedsUpdate = true;
        return;
      }

      this._lastNetworkPos.set(pos.x, pos.y, pos.z);
      this._lastNetworkYaw = yaw;

      const interp = this.ensureInterp();
      this._interpTargetPos.set(pos.x, pos.y, pos.z);
      this._interpEuler.set(0, MathUtils.degToRad(yaw), 0);
      this._interpTargetQuat.setFromEuler(this._interpEuler);
      interp.setTarget(this._interpTargetPos, null, this._interpTargetQuat, null);
    }

    if (!this._interp) return;

    const interp = this._interp;
    const clampedDt = Math.max(1, Math.min(dt || 0, 100));
    interp.update(clampedDt);

    this.el.object3D.position.copy(interp.getPosition());
    this.el.object3D.quaternion.copy(interp.getQuaternion());
    this.el.object3D.matrixNeedsUpdate = true;
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
