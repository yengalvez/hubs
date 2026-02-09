/**
 * Basic procedural locomotion for full-body avatars (e.g. RPM/Mixamo).
 *
 * Hubs' default IK setup drives hips/head/hands but does not provide a walk cycle.
 * This component adds a light-weight leg swing based on avatar root velocity.
 *
 * If shared Mixamo locomotion clips are available, we prefer those over the
 * procedural swing for better-looking results across RPM/Mixamo avatars.
 *
 * Safe-by-default:
 * - If leg bones are not found, it becomes a no-op.
 * - Only touches lower-body bones.
 */

import { getSharedMixamoLocomotionClips } from "../utils/mixamo-shared-animations";

const { Vector3, MathUtils } = THREE;

AFRAME.registerComponent("fullbody-locomotion", {
  schema: {
    enabled: { type: "boolean", default: true },
    useSharedAnimations: { type: "boolean", default: true },
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

    this._destroyed = false;
    this._shared = {
      loading: null,
      ready: false,
      mixer: null,
      actions: null,
      current: null
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

      if (this.data.useSharedAnimations && !this._shared.loading) {
        this._shared.loading = this.setupSharedAnimations();
      }

      return true;
    }

    return false;
  },

  async setupSharedAnimations() {
    try {
      const { idle, walk } = await getSharedMixamoLocomotionClips();
      if (this._destroyed) return;

      const root = this.el.object3D;
      if (!root) return;

      const mixer = new THREE.AnimationMixer(root);
      const actions = {
        idle: mixer.clipAction(idle),
        walk: mixer.clipAction(walk)
      };

      for (const name of Object.keys(actions)) {
        const action = actions[name];
        action.enabled = true;
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      }

      this._shared.mixer = mixer;
      this._shared.actions = actions;
      this._shared.ready = true;

      this.playSharedAction("idle", 0);
    } catch (e) {
      if (this.data.debug) {
        console.warn("[fullbody-locomotion] Shared Mixamo animations unavailable, using procedural swing.", e);
      }
    }
  },

  playSharedAction(name, fadeSeconds) {
    if (!this._shared.ready || !this._shared.actions) return;

    const next = this._shared.actions[name];
    if (!next) return;

    const prevName = this._shared.current;
    const prev = prevName ? this._shared.actions[prevName] : null;
    if (prev && prev !== next) {
      prev.fadeOut(fadeSeconds);
    }

    next.reset().fadeIn(fadeSeconds).play();
    this._shared.current = name;
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

    if (this.data.useSharedAnimations && this._shared.ready && this._shared.mixer && this._shared.actions) {
      this._shared.mixer.update(dtSeconds);

      const target = moving ? "walk" : "idle";
      if (target !== this._shared.current) {
        this.playSharedAction(target, 0.12);
      }

      // Scale the walk cycle speed loosely with movement speed to reduce moonwalking.
      if (target === "walk" && this._shared.actions.walk) {
        this._shared.actions.walk.timeScale = MathUtils.clamp(speed / 1.4, 0.6, 2.2);
      } else if (this._shared.actions.idle) {
        this._shared.actions.idle.timeScale = 1.0;
      }

      return;
    }

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
  },

  remove() {
    this._destroyed = true;

    if (this._shared.mixer) {
      this._shared.mixer.stopAllAction();
      this._shared.mixer.uncacheRoot(this.el.object3D);
    }

    this._shared.mixer = null;
    this._shared.actions = null;
    this._shared.ready = false;
    this._shared.current = null;
  }
});
