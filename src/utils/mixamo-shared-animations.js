import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

import idleGlbUrl from "../assets/animations/mixamo/idle.glb";
import walkGlbUrl from "../assets/animations/mixamo/walk.glb";

// We deliberately do NOT animate hips/spine/neck/head or any translations so we don't
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

function filterAndRetargetLocomotionClip(clip) {
  const tracks = [];

  for (let i = 0; i < clip.tracks.length; i++) {
    const track = clip.tracks[i];
    const parts = track.name.split(".");
    if (parts.length < 2) continue;

    const property = parts[parts.length - 1];
    // Avoid root motion / translation. IK drives avatar position and head offset.
    if (property !== "quaternion") continue;

    const rawNodeName = parts.slice(0, -1).join(".");
    const nodeName = normalizeNodeName(rawNodeName);
    if (!LOCOMOTION_BONES.has(nodeName)) continue;

    const cloned = track.clone();
    cloned.name = `${nodeName}.quaternion`;
    tracks.push(cloned);
  }

  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  out.optimize();
  return out;
}

let locomotionPromise = null;

export async function getSharedMixamoLocomotionClips() {
  if (locomotionPromise) return locomotionPromise;

  locomotionPromise = (async () => {
    const [idleClipRaw, walkClipRaw] = await Promise.all([
      loadFirstClip(idleGlbUrl, "idle"),
      loadFirstClip(walkGlbUrl, "walk")
    ]);

    const idle = filterAndRetargetLocomotionClip(idleClipRaw);
    idle.name = "mixamo-idle";

    const walk = filterAndRetargetLocomotionClip(walkClipRaw);
    walk.name = "mixamo-walk";

    return { idle, walk };
  })();

  return locomotionPromise;
}
