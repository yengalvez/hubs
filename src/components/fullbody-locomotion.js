/**
 * Basic procedural locomotion for full-body avatars (e.g. RPM/Mixamo).
 *
 * Hubs' default IK setup drives hips/head/hands but does not provide a walk cycle.
 * This component adds a light-weight leg swing based on avatar root velocity.
 *
 * Safe-by-default:
 * - If leg bones are not found, it becomes a no-op.
 * - Only touches lower-body bones.
 */

const { Vector3, MathUtils } = THREE;

AFRAME.registerComponent("fullbody-locomotion", {
  schema: {
    enabled: { type: "boolean", default: true },
    speedThreshold: { type: "number", default: 0.15 }, // m/s
    runThreshold: { type: "number", default: 2.2 }, // m/s
    walkSwing: { type: "number", default: Math.PI / 8 }, // ~22.5deg
    runSwing: { type: "number", default: Math.PI / 5 }, // ~36deg
    responsiveness: { type: "number", default: 0.35 }, // [0..1] lerp per tick
    debug: { type: "boolean", default: false }
  },

  init() {
    this._tmpPos = new Vector3();
    this._prevPos = new Vector3();
    this._hadFirstTick = false;
    this._phase = 0;
    this._isFullBody = false;

    this._bones = {
      leftUpLeg: null,
      leftLeg: null,
      rightUpLeg: null,
      rightLeg: null
    };
  },

  maybeResolveBones() {
    if (this._isFullBody) return true;

    const root = this.el.object3D;
    if (!root) return false;

    const leftUpLeg = root.getObjectByName("LeftUpLeg");
    const leftLeg = root.getObjectByName("LeftLeg");
    const rightUpLeg = root.getObjectByName("RightUpLeg");
    const rightLeg = root.getObjectByName("RightLeg");

    if (leftUpLeg && leftLeg && rightUpLeg && rightLeg) {
      this._bones.leftUpLeg = leftUpLeg;
      this._bones.leftLeg = leftLeg;
      this._bones.rightUpLeg = rightUpLeg;
      this._bones.rightLeg = rightLeg;
      this._isFullBody = true;

      if (this.data.debug) {
        console.log("[fullbody-locomotion] Full-body leg bones detected on", this.el);
      }

      return true;
    }

    return false;
  },

  tick(time, dt) {
    if (!this.data.enabled) return;

    const root = this.el.object3D;
    if (!root) return;

    // Resolve bones lazily, since this component may attach before the model is fully inflated.
    if (!this.maybeResolveBones()) return;

    const dtSeconds = Math.max(0.001, dt / 1000);

    root.getWorldPosition(this._tmpPos);

    if (!this._hadFirstTick) {
      this._prevPos.copy(this._tmpPos);
      this._hadFirstTick = true;
      return;
    }

    const dx = this._tmpPos.x - this._prevPos.x;
    const dz = this._tmpPos.z - this._prevPos.z;
    const speed = Math.sqrt(dx * dx + dz * dz) / dtSeconds;

    this._prevPos.copy(this._tmpPos);

    const moving = speed > this.data.speedThreshold;
    const running = speed > this.data.runThreshold;
    const maxSwing = running ? this.data.runSwing : this.data.walkSwing;

    // Step rate scales with speed but is clamped to avoid absurd values.
    const stepRate = MathUtils.clamp(speed * 2.2, 0, running ? 10 : 7); // radians/sec
    this._phase = (this._phase + stepRate * dtSeconds) % (Math.PI * 2);

    const targetLeft = moving ? Math.sin(this._phase) * maxSwing : 0;
    const targetRight = moving ? Math.sin(this._phase + Math.PI) * maxSwing : 0;

    const { leftUpLeg, leftLeg, rightUpLeg, rightLeg } = this._bones;
    const a = MathUtils.clamp(this.data.responsiveness, 0.01, 1.0);

    // Upper legs swing.
    leftUpLeg.rotation.x = MathUtils.lerp(leftUpLeg.rotation.x, targetLeft, a);
    rightUpLeg.rotation.x = MathUtils.lerp(rightUpLeg.rotation.x, targetRight, a);

    // Knees bend slightly when the leg goes back.
    const leftKneeTarget = moving ? Math.max(0, -targetLeft) * 1.2 : 0;
    const rightKneeTarget = moving ? Math.max(0, -targetRight) * 1.2 : 0;
    leftLeg.rotation.x = MathUtils.lerp(leftLeg.rotation.x, leftKneeTarget, a);
    rightLeg.rotation.x = MathUtils.lerp(rightLeg.rotation.x, rightKneeTarget, a);
  }
});
