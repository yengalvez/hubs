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
    this._smoothTargetEl = null;
    this._tmpInvRootQuat = new Quaternion();
    this._tmpLocalQuat = new Quaternion();
    this._tmpWorldDiff = new Vector3();
    this._tmpLocalDiff = new Vector3();

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
    // Use a buffer > the publish interval (10Hz ~= 100ms) to avoid visible stutter on packet jitter.
    this._interp = new InterpolationBuffer(undefined, 0.15);
    return this._interp;
  },

  tick(_t, dt) {
    const net = this.el.components && this.el.components.networked;
    if (!net || !net.initialized || net.isMine()) {
      this.resetSmoothingOffsets();
      return;
    }

    // Note: In Hubs, the A-Frame `position` component's data is a *reference* to `object3D.position`.
    // Reading `getAttribute("position")` here would therefore read our own smoothed value and create feedback.
    // Use the root object's transform as the networked raw target, and smooth a child offset instead.
    const pos = this.el.object3D && this.el.object3D.position;
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
        this.resetSmoothingOffsets();
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

    if (!this._interp) {
      this.resetSmoothingOffsets();
      return;
    }

    const interp = this._interp;
    const clampedDt = Math.max(1, Math.min(dt || 0, 100));
    interp.update(clampedDt);

    // Smooth the visible model via a local offset, so the root entity keeps its raw networked transform.
    const smoothEl = this.getSmoothTargetEl();
    if (!smoothEl || !smoothEl.object3D) return;

    const rootQuat = this.el.object3D.quaternion;
    this._tmpInvRootQuat.copy(rootQuat).invert();

    const smoothPos = interp.getPosition();
    const smoothQuat = interp.getQuaternion();

    // localOffsetPos = inv(rootRot) * (smoothWorldPos - rawWorldPos)
    this._tmpWorldDiff.copy(smoothPos).sub(pos);
    this._tmpLocalDiff.copy(this._tmpWorldDiff).applyQuaternion(this._tmpInvRootQuat);
    smoothEl.object3D.position.copy(this._tmpLocalDiff);

    // localOffsetRot = inv(rootRot) * smoothWorldRot
    this._tmpLocalQuat.copy(this._tmpInvRootQuat).multiply(smoothQuat);
    smoothEl.object3D.quaternion.copy(this._tmpLocalQuat);

    smoothEl.object3D.matrixNeedsUpdate = true;
  },

  getSmoothTargetEl() {
    if (this._smoothTargetEl && this._smoothTargetEl.isConnected) return this._smoothTargetEl;
    this._smoothTargetEl = this.el.querySelector(".model") || null;
    return this._smoothTargetEl;
  },

  resetSmoothingOffsets() {
    this._interp = null;
    this._lastNetworkPos = null;
    this._lastNetworkYaw = null;
    const smoothEl = this.getSmoothTargetEl();
    if (!smoothEl || !smoothEl.object3D) return;
    smoothEl.object3D.position.set(0, 0, 0);
    smoothEl.object3D.quaternion.set(0, 0, 0, 1);
    smoothEl.object3D.matrixNeedsUpdate = true;
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
