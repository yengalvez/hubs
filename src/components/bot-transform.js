const InterpolationBuffer = require("buffered-interpolation");

const { Vector3, Quaternion, Euler, MathUtils } = THREE;

const BUFFER_TIME_S = 0.35;
const SNAP_DISTANCE_M = 4;
const SNAP_DISTANCE_SQ = SNAP_DISTANCE_M * SNAP_DISTANCE_M;

// If the runner stalls (headless Chromium can hitch), allow short extrapolation to reduce visible "freeze then jump".
const STALE_EXTRAPOLATE_AFTER_MS = 450;
const MAX_EXTRAPOLATION_MS = 600;

AFRAME.registerComponent("bot-transform", {
  schema: {
    x: { type: "number", default: 0 },
    y: { type: "number", default: 0 },
    z: { type: "number", default: 0 },
    yaw: { type: "number", default: 0 } // degrees, Y axis
  },

  init() {
    this._buffer = new InterpolationBuffer(InterpolationBuffer.MODE_LERP, BUFFER_TIME_S);
    this._tmpPos = new Vector3();
    this._tmpQuat = new Quaternion();
    this._tmpEuler = new Euler(0, 0, 0, "YXZ");
    this._predictedPos = new Vector3();

    this._hasSample = false;
    this._lastReceivedAt = 0;
    this._lastReceivedPos = new Vector3();
    this._lastReceivedQuat = new Quaternion();

    this._prevSampleAt = 0;
    this._prevSamplePos = new Vector3();
    this._velocity = new Vector3(); // m/s
  },

  isMine() {
    const net = this.el.components && this.el.components.networked;
    return !!(net && net.initialized && net.isMine());
  },

  resetToSample(pos, quat, now) {
    this._buffer = new InterpolationBuffer(InterpolationBuffer.MODE_LERP, BUFFER_TIME_S);
    this._buffer.setPosition(pos);
    this._buffer.setQuaternion(quat);

    this._lastReceivedAt = now;
    this._lastReceivedPos.copy(pos);
    this._lastReceivedQuat.copy(quat);
    this._prevSampleAt = now;
    this._prevSamplePos.copy(pos);
    this._velocity.set(0, 0, 0);
    this._hasSample = true;

    if (this.el.object3D) {
      this.el.object3D.position.copy(pos);
      this.el.object3D.quaternion.copy(quat);
      this.el.object3D.matrixNeedsUpdate = true;
    }
  },

  update(oldData) {
    // The runner is authoritative for its own bots; do not fight its per-frame updates.
    if (this.isMine()) return;

    const data = this.data;
    if (oldData && data.x === oldData.x && data.y === oldData.y && data.z === oldData.z && data.yaw === oldData.yaw) {
      return;
    }

    const now = performance.now();

    this._tmpPos.set(Number(data.x) || 0, Number(data.y) || 0, Number(data.z) || 0);
    this._tmpEuler.set(0, MathUtils.degToRad(Number(data.yaw) || 0), 0);
    this._tmpQuat.setFromEuler(this._tmpEuler);

    if (this._hasSample) {
      const dx = this._tmpPos.x - this._lastReceivedPos.x;
      const dy = this._tmpPos.y - this._lastReceivedPos.y;
      const dz = this._tmpPos.z - this._lastReceivedPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq > SNAP_DISTANCE_SQ) {
        // Respawn/late instantiation: snap rather than gliding through walls.
        this.resetToSample(this._tmpPos, this._tmpQuat, now);
        return;
      }

      const dtMs = now - this._prevSampleAt;
      if (dtMs > 1) {
        const dtSec = dtMs / 1000;
        this._velocity
          .copy(this._tmpPos)
          .sub(this._prevSamplePos)
          .multiplyScalar(1 / dtSec);
        this._velocity.y = 0;
      }

      this._prevSampleAt = now;
      this._prevSamplePos.copy(this._tmpPos);
    } else {
      // First sample should be applied immediately so the bot doesn't flash at origin.
      this.resetToSample(this._tmpPos, this._tmpQuat, now);
      return;
    }

    this._lastReceivedAt = now;
    this._lastReceivedPos.copy(this._tmpPos);
    this._lastReceivedQuat.copy(this._tmpQuat);
    this._hasSample = true;

    this._buffer.setPosition(this._tmpPos);
    this._buffer.setQuaternion(this._tmpQuat);
  },

  tick(_t, dt) {
    if (this.isMine()) return;
    if (!this._hasSample) return;
    if (!this.el.object3D) return;

    const clampedDt = Math.max(1, Math.min(Number(dt) || 0, 200));
    this._buffer.update(clampedDt);

    let pos = this._buffer.getPosition();
    const quat = this._buffer.getQuaternion();

    const now = performance.now();
    const ageMs = now - this._lastReceivedAt;
    if (ageMs > STALE_EXTRAPOLATE_AFTER_MS && this._velocity.lengthSq() > 1e-6) {
      const extraMs = Math.min(ageMs, MAX_EXTRAPOLATION_MS);
      const extraSec = extraMs / 1000;
      this._predictedPos.copy(this._lastReceivedPos).addScaledVector(this._velocity, extraSec);
      pos = this._predictedPos;
    }

    this.el.object3D.position.copy(pos);
    this.el.object3D.quaternion.copy(quat);
    this.el.object3D.matrixNeedsUpdate = true;
  }
});
