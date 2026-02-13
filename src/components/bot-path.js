const { Vector3, Euler, Quaternion, MathUtils } = THREE;

const TURN_DURATION_MS = 300;
const START_CORRECTION_MIN_M = 0.25;
const START_CORRECTION_MAX_M = 4.0;

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
    this._override = null;
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

    const o = this._override;

    const sx = o ? o.sx : Number(d.sx) || 0;
    const sy = o ? o.sy : Number(d.sy) || 0;
    const sz = o ? o.sz : Number(d.sz) || 0;
    const ex = Number(d.ex) || 0;
    const ey = Number(d.ey) || 0;
    const ez = Number(d.ez) || 0;

    this._tmpStart.set(sx, sy, sz);
    this._tmpEnd.set(ex, ey, ez);

    const t0 = o ? o.t0 : Number(d.t0) || 0;
    const dur = Math.max(0, o ? o.dur : Number(d.dur) || 0);

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
    const yaw0Raw = o ? o.yaw0 : Number(d.yaw0) || 0;
    const yaw0 = normalizeAngleDeg(yaw0Raw - yawOffset);
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

    this._override = null;

    // If we receive a new movement segment but our current rendered position is far from the segment start,
    // it means we missed/delayed an update. Snap-correct by treating the segment start as "where we are now"
    // so the next walk begins from the visible location instead of jumping.
    // Important: only do this after we've rendered at least one frame of a previous segment. Otherwise,
    // newly-instantiated bots start at the origin before their first path is applied.
    if (this.el.object3D && this._hasApplied) {
      const d = this.data;
      const dur = Math.max(0, Number(d.dur) || 0);

      if (dur > 0) {
        const startX = Number(d.sx) || 0;
        const startY = Number(d.sy) || 0;
        const startZ = Number(d.sz) || 0;

        const cur = this.el.object3D.position;
        const dx = cur.x - startX;
        const dy = cur.y - startY;
        const dz = cur.z - startZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist >= START_CORRECTION_MIN_M && dist <= START_CORRECTION_MAX_M) {
          const endX = Number(d.ex) || 0;
          const endY = Number(d.ey) || 0;
          const endZ = Number(d.ez) || 0;

          const origDx = endX - startX;
          const origDy = endY - startY;
          const origDz = endZ - startZ;
          const origDist = Math.sqrt(origDx * origDx + origDy * origDy + origDz * origDz);
          const newDx = endX - cur.x;
          const newDy = endY - cur.y;
          const newDz = endZ - cur.z;
          const newDist = Math.sqrt(newDx * newDx + newDy * newDy + newDz * newDz);

          const speedMPerMs = origDist > 1e-4 ? origDist / dur : 0;
          const newDur = speedMPerMs > 1e-6 ? Math.max(1, Math.round(newDist / speedMPerMs)) : dur;

          const now = this.getNowMs();

          this._tmpEuler.setFromQuaternion(this.el.object3D.quaternion);
          const yaw0 = normalizeAngleDeg(MathUtils.radToDeg(this._tmpEuler.y));

          this._override = {
            sx: cur.x,
            sy: cur.y,
            sz: cur.z,
            t0: now,
            dur: newDur,
            yaw0
          };
        }
      }
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
