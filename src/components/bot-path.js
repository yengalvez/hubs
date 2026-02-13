const { Vector3, Euler, Quaternion, MathUtils } = THREE;

const TURN_DURATION_MS = 300;

function getBotYawOffsetDeg(el) {
  const raw = el && el.dataset ? el.dataset.botYawOffsetDeg : null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAngleDeg(deg) {
  const n = Number(deg) || 0;
  return ((n % 360) + 360) % 360;
}

function shortestAngleDeltaDeg(fromDeg, toDeg) {
  const from = normalizeAngleDeg(fromDeg);
  const to = normalizeAngleDeg(toDeg);
  return ((to - from + 540) % 360) - 180;
}

function lerpAngleDeg(fromDeg, toDeg, t) {
  const from = normalizeAngleDeg(fromDeg);
  const delta = shortestAngleDeltaDeg(from, toDeg);
  return normalizeAngleDeg(from + delta * t);
}

AFRAME.registerComponent("bot-path", {
  schema: {
    sx: { type: "number", default: 0 },
    sy: { type: "number", default: 0 },
    sz: { type: "number", default: 0 },
    ex: { type: "number", default: 0 },
    ey: { type: "number", default: 0 },
    ez: { type: "number", default: 0 },
    t0: { type: "number", default: 0 }, // server time in ms
    dur: { type: "number", default: 0 }, // duration in ms
    yaw0: { type: "number", default: 0 }, // degrees
    yaw1: { type: "number", default: 0 } // degrees
  },

  init() {
    this._tmpStart = new Vector3();
    this._tmpEnd = new Vector3();
    this._tmpPos = new Vector3();
    this._tmpEuler = new Euler(0, 0, 0, "YXZ");
    this._tmpQuat = new Quaternion();
    this._hasApplied = false;
  },

  isMine() {
    const net = this.el.components && this.el.components.networked;
    return !!(net && net.initialized && net.isMine());
  },

  getNowMs() {
    const conn = window.NAF && window.NAF.connection;
    if (conn && typeof conn.getServerTime === "function") {
      return conn.getServerTime();
    }
    return performance.now();
  },

  applyTransform() {
    if (!this.el.object3D) return;

    const now = this.getNowMs();
    const d = this.data;

    this._tmpStart.set(Number(d.sx) || 0, Number(d.sy) || 0, Number(d.sz) || 0);
    this._tmpEnd.set(Number(d.ex) || 0, Number(d.ey) || 0, Number(d.ez) || 0);

    const t0 = Number(d.t0) || 0;
    const dur = Math.max(0, Number(d.dur) || 0);

    let alpha = 1;
    if (dur > 0) {
      if (now <= t0) {
        alpha = 0;
      } else {
        alpha = (now - t0) / dur;
      }
      alpha = MathUtils.clamp(alpha, 0, 1);
    }

    this._tmpPos.lerpVectors(this._tmpStart, this._tmpEnd, alpha);

    const yawOffset = getBotYawOffsetDeg(this.el);
    const yaw0 = normalizeAngleDeg((Number(d.yaw0) || 0) - yawOffset);
    const yaw1 = normalizeAngleDeg((Number(d.yaw1) || 0) - yawOffset);
    let yawDeg = yaw1;
    if (dur > 0) {
      if (now <= t0) {
        yawDeg = yaw0;
      } else {
        const turnT = MathUtils.clamp((now - t0) / TURN_DURATION_MS, 0, 1);
        yawDeg = lerpAngleDeg(yaw0, yaw1, turnT);
      }
    } else {
      yawDeg = yaw1;
    }

    this._tmpEuler.set(0, MathUtils.degToRad(yawDeg), 0);
    this._tmpQuat.setFromEuler(this._tmpEuler);

    this.el.object3D.position.copy(this._tmpPos);
    this.el.object3D.quaternion.copy(this._tmpQuat);
    this.el.object3D.matrixNeedsUpdate = true;
  },

  update() {
    // Runner is authoritative; don't fight its local transforms. Remote clients render via this component.
    if (this.isMine()) return;

    // Apply immediately to avoid a one-frame flash at the origin on instantiation.
    this.applyTransform();
    this._hasApplied = true;
  },

  tick() {
    if (this.isMine()) return;
    if (!this._hasApplied) {
      this.applyTransform();
      this._hasApplied = true;
      return;
    }
    this.applyTransform();
  }
});
