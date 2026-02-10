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
    this._tmpVel = new Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._hadFirstTick = false;
    this._phase = 0;
    this._isFullBody = false;
    this._playerInfoEl = null;

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

  getIsSitting() {
    if (!this._playerInfoEl) {
      // fullbody-locomotion is attached under the AvatarRoot template. player-info lives on the avatar entity.
      this._playerInfoEl = this.el.closest("[player-info]");
    }

    const playerInfo =
      this._playerInfoEl && this._playerInfoEl.components && this._playerInfoEl.components["player-info"];
    return !!(playerInfo && playerInfo.data && playerInfo.data.isSitting);
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
      const { idle, walk, walkBack, strafeLeft, strafeRight, sit } = await getSharedMixamoLocomotionClips();
      if (this._destroyed) return;

      const root = this.el.object3D;
      if (!root) return;

      // Mixamo exports "Hips.position" in centimeters-like units (e.g. ~103 at standing height).
      // Applying that translation verbatim to arbitrary RPM/Mixamo avatars can shove the skeleton far away,
      // making the avatar appear to disappear when sitting.
      //
      // We retarget the sit clip's hips translation per-avatar by:
      // - anchoring the first keyframe to the avatar's current hips local position
      // - scaling the Y delta by (avatarHipsY / mixamoHipsY0) to convert units + match avatar scale
      const retargetedSit = (() => {
        const clip = sit.clone();

        const hips = root.getObjectByName("Hips");
        if (!hips) return clip;

        const hipsPosTrack = clip.tracks.find(t => t && t.name === "Hips.position");
        if (!hipsPosTrack || !hipsPosTrack.values || hipsPosTrack.values.length < 3) return clip;

        const values = hipsPosTrack.values;
        const mixamoY0 = values[1];
        const avatarHipsX = hips.position.x;
        const avatarHipsY = hips.position.y;
        const avatarHipsZ = hips.position.z;

        const scale = Math.abs(mixamoY0) > 1e-4 ? avatarHipsY / mixamoY0 : 0;

        for (let i = 0; i < values.length; i += 3) {
          const y = values[i + 1];
          values[i] = avatarHipsX;
          values[i + 1] = avatarHipsY + (y - mixamoY0) * scale;
          values[i + 2] = avatarHipsZ;
        }

        return clip;
      })();

      const mixer = new THREE.AnimationMixer(root);
      const actions = {
        idle: mixer.clipAction(idle),
        walk: mixer.clipAction(walk),
        walkBack: mixer.clipAction(walkBack),
        strafeLeft: mixer.clipAction(strafeLeft),
        strafeRight: mixer.clipAction(strafeRight),
        sit: mixer.clipAction(retargetedSit)
      };

      // Default looping actions.
      for (const name of ["idle", "walk", "walkBack", "strafeLeft", "strafeRight"]) {
        const action = actions[name];
        action.enabled = true;
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      }

      // One-shot sit action that holds the final pose.
      actions.sit.enabled = true;
      actions.sit.setLoop(THREE.LoopOnce, 1);
      actions.sit.clampWhenFinished = true;

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

    const isSitting = this.getIsSitting();

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

      if (isSitting) {
        if (this._shared.current !== "sit") {
          this.playSharedAction("sit", 0.12);
        }
        return;
      }

      let target = "idle";
      if (moving) {
        // Decide between forward/back/strafe based on horizontal velocity in avatar-local space.
        //
        // Convention: in three.js, an object's "forward" is typically -Z in local space.
        this._tmpVel.set(dx / dtSeconds, 0, dz / dtSeconds);

        const dirRoot = (this._playerInfoEl && this._playerInfoEl.object3D) || root;
        dirRoot.getWorldQuaternion(this._tmpQuat);
        this._tmpQuat.invert();
        this._tmpVel.applyQuaternion(this._tmpQuat);
        this._tmpVel.y = 0;

        const angle = Math.atan2(this._tmpVel.x, -this._tmpVel.z); // [-pi..pi], 0 = forward
        const abs = Math.abs(angle);

        if (abs <= Math.PI / 4) {
          target = "walk";
        } else if (abs >= (3 * Math.PI) / 4) {
          target = "walkBack";
        } else if (angle > 0) {
          target = "strafeRight";
        } else {
          target = "strafeLeft";
        }
      }

      if (!this._shared.actions[target]) {
        target = moving ? "walk" : "idle";
      }

      if (target !== this._shared.current) {
        this.playSharedAction(target, 0.12);
      }

      // Scale the walk cycle speed loosely with movement speed to reduce moonwalking.
      if (moving && target !== "idle" && this._shared.actions[target]) {
        this._shared.actions[target].timeScale = MathUtils.clamp(speed / 1.4, 0.6, 2.2);
      } else if (this._shared.actions.idle) {
        this._shared.actions.idle.timeScale = 1.0;
      }

      return;
    }

    if (isSitting) {
      // Procedural fallback: stop leg swing while sitting.
      const { leftUpLeg, leftLeg, rightUpLeg, rightLeg } = this._bones;
      const a = MathUtils.clamp(this.data.responsiveness, 0.01, 1.0);
      leftUpLeg.rotation.x = MathUtils.lerp(leftUpLeg.rotation.x, 0, a);
      rightUpLeg.rotation.x = MathUtils.lerp(rightUpLeg.rotation.x, 0, a);
      leftLeg.rotation.x = MathUtils.lerp(leftLeg.rotation.x, 0, a);
      rightLeg.rotation.x = MathUtils.lerp(rightLeg.rotation.x, 0, a);
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
