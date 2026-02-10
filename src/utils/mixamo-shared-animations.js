import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

import idleGlbUrl from "../assets/animations/mixamo/idle.glb";
import walkGlbUrl from "../assets/animations/mixamo/walk.glb";
import walkBackwardsGlbUrl from "../assets/animations/mixamo/walk-backwards.glb";
import walkStrafeLeftGlbUrl from "../assets/animations/mixamo/walk-strafe-left.glb";
import walkStrafeRightGlbUrl from "../assets/animations/mixamo/walk-strafe-right.glb";
import sitGlbUrl from "../assets/animations/mixamo/sit.glb";

// For locomotion, we deliberately avoid hips/spine/neck/head and any translations so we don't
// fight ik-controller's head-offset math (which assumes a mostly-static head chain).
// The goal is "looks alive while moving" without risking avatar/camera alignment bugs.
const LOCOMOTION_BONES = new Set([
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "LeftToeBase",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
  "RightToeBase",
  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "RightShoulder",
  "RightArm",
  "RightForeArm"
]);

// Sitting needs a bit more of the torso chain to look convincing, but we still
// avoid neck/head and translations to prevent fighting ik-controller.
const SITTING_BONES = new Set(["Hips", "Spine", "Spine1", "Spine2", ...LOCOMOTION_BONES]);

const normalizeNodeName = name => {
  if (!name) return name;

  // Remove common namespace separators (e.g. "mixamorig:Hips", "Armature|Hips")
  const lastNsSep = Math.max(name.lastIndexOf(":"), name.lastIndexOf("|"));
  let out = lastNsSep >= 0 ? name.slice(lastNsSep + 1) : name;

  // Some exporters strip ':' but keep the prefix (e.g. "mixamorigHips")
  const lower = out.toLowerCase();
  if (lower.startsWith("mixamorig") && out.length > "mixamorig".length) {
    out = out.slice("mixamorig".length);
    out = out.replace(/^[_-]+/, "");
  }

  return out;
};

const loader = new GLTFLoader();

function loadFirstClip(url, expectedName) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      gltf => {
        const clip = gltf && gltf.animations && gltf.animations[0];
        if (!clip) {
          reject(new Error(`[mixamo-shared-animations] No animation clips in ${expectedName} (${url})`));
          return;
        }
        resolve(clip);
      },
      undefined,
      err => reject(err)
    );
  });
}

function filterAndRetargetClip(clip, allowedBones, opts = {}) {
  const tracks = [];

  for (let i = 0; i < clip.tracks.length; i++) {
    const track = clip.tracks[i];
    const parts = track.name.split(".");
    if (parts.length < 2) continue;

    const property = parts[parts.length - 1];
    const rawNodeName = parts.slice(0, -1).join(".");
    const nodeName = normalizeNodeName(rawNodeName);

    if (property === "quaternion") {
      if (!allowedBones.has(nodeName)) continue;

      const cloned = track.clone();
      cloned.name = `${nodeName}.quaternion`;
      tracks.push(cloned);
      continue;
    }

    // Locomotion explicitly avoids translations (root motion and bone position) to prevent
    // fighting IK and camera alignment. Sitting is a special case: the Mixamo "Stand To Sit"
    // clip uses a vertical Hips.position track to lower the body into the chair pose. If we
    // drop that translation, the avatar looks like it "floats" while sitting.
    if (opts.allowHipsPositionY && property === "position" && nodeName === "Hips") {
      const cloned = track.clone();
      cloned.name = "Hips.position";

      // Preserve only the Y component; keep X/Z constant to avoid any sideways drift baked into the clip.
      const values = cloned.values;
      if (values && values.length >= 3) {
        const x0 = values[0];
        const z0 = values[2];
        for (let j = 0; j < values.length; j += 3) {
          values[j] = x0; // x
          values[j + 2] = z0; // z
        }
      }

      tracks.push(cloned);
    }
  }

  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  out.optimize();
  return out;
}

let locomotionPromise = null;

export async function getSharedMixamoLocomotionClips() {
  if (locomotionPromise) return locomotionPromise;

  locomotionPromise = (async () => {
    const [idleClipRaw, walkClipRaw, walkBackClipRaw, strafeLeftClipRaw, strafeRightClipRaw, sitClipRaw] =
      await Promise.all([
        loadFirstClip(idleGlbUrl, "idle"),
        loadFirstClip(walkGlbUrl, "walk"),
        loadFirstClip(walkBackwardsGlbUrl, "walk-backwards"),
        loadFirstClip(walkStrafeLeftGlbUrl, "walk-strafe-left"),
        loadFirstClip(walkStrafeRightGlbUrl, "walk-strafe-right"),
        loadFirstClip(sitGlbUrl, "sit")
      ]);

    const idle = filterAndRetargetClip(idleClipRaw, LOCOMOTION_BONES);
    idle.name = "mixamo-idle";

    const walk = filterAndRetargetClip(walkClipRaw, LOCOMOTION_BONES);
    walk.name = "mixamo-walk";

    const walkBack = filterAndRetargetClip(walkBackClipRaw, LOCOMOTION_BONES);
    walkBack.name = "mixamo-walk-back";

    const strafeLeft = filterAndRetargetClip(strafeLeftClipRaw, LOCOMOTION_BONES);
    strafeLeft.name = "mixamo-walk-strafe-left";

    const strafeRight = filterAndRetargetClip(strafeRightClipRaw, LOCOMOTION_BONES);
    strafeRight.name = "mixamo-walk-strafe-right";

    const sit = filterAndRetargetClip(sitClipRaw, SITTING_BONES, { allowHipsPositionY: true });
    sit.name = "mixamo-sit";

    return { idle, walk, walkBack, strafeLeft, strafeRight, sit };
  })();

  return locomotionPromise;
}
