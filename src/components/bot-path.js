const { Vector3, Euler, Quaternion, MathUtils } = THREE;

const TURN_DURATION_MS = 300;
const BOT_RENDER_DELAY_MS = 250;
const SERVER_TIME_SMOOTHING = 0.1;

function getBotYawOffsetDeg(el) {
  const raw = el && el.dataset ? el.dataset.botYawOffsetDeg : null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function snapshotSegment(d) {
  if (!d) return null;
  return {
    sx: Number(d.sx) || 0,
    sy: Number(d.sy) || 0,
    sz: Number(d.sz) || 0,
    ex: Number(d.ex) || 0,
    ey: Number(d.ey) || 0,
    ez: Number(d.ez) || 0,
    t0: Number(d.t0) || 0,
    dur: Math.max(0, Number(d.dur) || 0),
    yaw0: Number(d.yaw0) || 0,
    yaw1: Number(d.yaw1) || 0
  };
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
    this._active = null;
    this._pending = null;
    this._hasApplied = false;
    this._hasShown = false;
    this._smoothedOffsetMs = 0;
    this._lastNowMs = 0;
  },

  isMine() {
    const net = this.el.components && this.el.components.networked;
    return !!(net && net.initialized && net.isMine());
  },

  getRawServerTimeMs() {
    const conn = window.NAF && window.NAF.connection;
    if (conn && typeof conn.getServerTime === "function") {
      return conn.getServerTime();
    }
    return performance.now();
  },

  getNowMs() {
    const perfNow = performance.now();
    const rawNow = this.getRawServerTimeMs();

    const offset = rawNow - perfNow;
    if (!Number.isFinite(this._smoothedOffsetMs)) {
      this._smoothedOffsetMs = Number.isFinite(offset) ? offset : 0;
    } else if (Number.isFinite(offset)) {
      this._smoothedOffsetMs += (offset - this._smoothedOffsetMs) * SERVER_TIME_SMOOTHING;
    }

    let now = perfNow + this._smoothedOffsetMs;
    if (!Number.isFinite(now)) now = rawNow;

    // Ensure time never goes backwards, even if the server time offset is corrected.
    if (now < this._lastNowMs) now = this._lastNowMs;
    this._lastNowMs = now;

    return now;
  },

  applyTransform() {
    if (!this.el.object3D) return;

    const now = this.getNowMs();
    const renderNow = now - BOT_RENDER_DELAY_MS;

    // Promote pending segment only once we're ready to start rendering it.
    if (this._pending && renderNow >= this._pending.t0) {
      this._active = this._pending;
      this._pending = null;
    }

    const seg = this._active;
    if (!seg) return;

    const sx = seg.sx;
    const sy = seg.sy;
    const sz = seg.sz;
    const ex = seg.ex;
    const ey = seg.ey;
    const ez = seg.ez;

    this._tmpStart.set(sx, sy, sz);
    this._tmpEnd.set(ex, ey, ez);

    const t0 = seg.t0;
    const dur = seg.dur;

    let alpha = 1;
    if (dur > 0) {
      if (renderNow <= t0) {
        alpha = 0;
      } else {
        alpha = (renderNow - t0) / dur;
      }
      alpha = MathUtils.clamp(alpha, 0, 1);
    }

    this._tmpPos.lerpVectors(this._tmpStart, this._tmpEnd, alpha);

    const yawOffset = getBotYawOffsetDeg(this.el);
    const yaw0 = normalizeAngleDeg((seg.yaw0 || 0) - yawOffset);
    const yaw1 = normalizeAngleDeg((seg.yaw1 || 0) - yawOffset);
    let yawDeg = yaw1;
    if (dur > 0) {
      if (renderNow <= t0) {
        yawDeg = yaw0;
      } else {
        const turnT = MathUtils.clamp((renderNow - t0) / TURN_DURATION_MS, 0, 1);
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

    if (!this._hasShown) {
      // Keep the bot hidden until we've applied its first transform so there is no flash at the origin.
      this._hasShown = true;
      this.el.object3D.visible = true;
      this.el.setAttribute("visible", true);
    }
  },

  update() {
    // Runner is authoritative; don't fight its local transforms. Remote clients render via this component.
    if (this.isMine()) return;

    const seg = snapshotSegment(this.data);
    if (!seg) return;

    // The server sends one segment at a time. Keep the previous segment active and stage the new one
    // as "pending" until it's time to render it. Combined with BOT_RENDER_DELAY_MS, this prevents
    // visible snapping at segment boundaries even if there is jitter in update arrival.
    if (!this._active) {
      this._active = seg;
      this._pending = null;
    } else if (seg.t0 >= this._active.t0) {
      this._pending = seg;
    } else {
      // If we somehow receive an older segment, just take it as authoritative.
      this._active = seg;
      this._pending = null;
    }

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
