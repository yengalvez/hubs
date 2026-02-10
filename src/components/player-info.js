import { injectCustomShaderChunks } from "../utils/media-utils";
import { AVATAR_TYPES } from "../utils/avatar-utils";
import { registerComponentInstance, deregisterComponentInstance } from "../utils/component-utils";
import defaultAvatar from "../assets/models/DefaultAvatar.glb";
import { MediaDevicesEvents } from "../utils/media-devices-utils";
import { createHeadlessModelForSkinnedMesh } from "../utils/three-utils";
import { Layers } from "../camera-layers";
import { addComponent, removeComponent } from "bitecs";
import { LocalAvatar, RemoteAvatar } from "../bit-components";

function ensureAvatarNodes(json) {
  const { nodes } = json;

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

  const normalizeHumanoidNodeNames = () => {
    // These names are expected by Hubs templates/IK and by our basic full-body locomotion.
    const desiredNames = [
      "Hips",
      "Spine",
      "Spine1",
      "Spine2",
      "Neck",
      "Head",
      "LeftShoulder",
      "LeftArm",
      "LeftForeArm",
      "LeftHand",
      "RightShoulder",
      "RightArm",
      "RightForeArm",
      "RightHand",
      "LeftUpLeg",
      "LeftLeg",
      "LeftFoot",
      "LeftToeBase",
      "RightUpLeg",
      "RightLeg",
      "RightFoot",
      "RightToeBase"
    ];

    const desiredByLower = new Map(desiredNames.map(n => [n.toLowerCase(), n]));
    const existingLower = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const name = nodes[i].name;
      if (!name) continue;
      existingLower.set(name.toLowerCase(), i);
    }

    // Prefer renaming joints (bones) when there are multiple candidates with the same suffix name.
    const jointIndices = new Set();
    for (const skin of json.skins || []) {
      for (const joint of skin.joints || []) {
        jointIndices.add(joint);
      }
    }
    const candidatesByLower = new Map();

    for (let i = 0; i < nodes.length; i++) {
      const name = nodes[i].name;
      if (!name) continue;
      const normalized = normalizeNodeName(name);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (!desiredByLower.has(key)) continue;
      if (!candidatesByLower.has(key)) candidatesByLower.set(key, []);
      candidatesByLower.get(key).push(i);
    }

    for (const [desiredLower, desiredName] of desiredByLower.entries()) {
      const existingIndex = existingLower.get(desiredLower);
      const candidates = candidatesByLower.get(desiredLower) || [];

      // If we already have the desired name on a joint, keep it.
      if (existingIndex !== undefined && jointIndices.has(existingIndex)) {
        continue;
      }

      const jointCandidates = candidates.filter(i => jointIndices.has(i));
      const chosen = (jointCandidates.length ? jointCandidates : candidates)[0];
      if (chosen === undefined) continue;

      // If the desired name is currently taken by a non-joint node and we have a joint candidate,
      // move the non-joint aside so templates/IK bind to the bone.
      if (
        existingIndex !== undefined &&
        existingIndex !== chosen &&
        !jointIndices.has(existingIndex) &&
        jointIndices.has(chosen)
      ) {
        const existingName = nodes[existingIndex].name || desiredName;
        nodes[existingIndex].name = `${existingName}_nonjoint`;
        existingLower.delete(desiredLower);
      }

      nodes[chosen].name = desiredName;
      existingLower.set(desiredLower, chosen);
    }
  };

  // Hubs avatar functionality (IK, hover targets, etc) is attached via templates in hub.html,
  // which key off node names like "AvatarRoot", "Spine", "LeftHand", etc. Many RPM/Mixamo
  // GLBs prefix bone names (e.g. "mixamorig:Hips"), and often omit "AvatarRoot", which can
  // prevent avatar templates/IK from being applied and results in a static avatar.
  normalizeHumanoidNodeNames();

  if (!nodes.some(node => node.name === "AvatarRoot")) {
    // Note: We assume that the first node in the primary scene is the one we care about.
    const originalRoot = json.scenes[json.scene].nodes[0];

    // Keep this minimal; some valid skeletons won't match all Hubs-required bone names (for example full Mixamo arm chains).
    const requiredNodes = ["Hips", "Spine", "Neck", "Head"];
    const hasRequiredNodes = requiredNodes.every(n => nodes.some(node => node.name === n));

    if (!hasRequiredNodes) {
      // If the avatar model doesn't have the basic Hubs node names, the user has probably chosen a custom GLB.
      // Construct a suitable hierarchy for avatar functionality to work by wrapping the existing root.
      nodes.push({ name: "LeftEye", extensions: { MOZ_hubs_components: {} } });
      nodes.push({ name: "RightEye", extensions: { MOZ_hubs_components: {} } });
      nodes.push({
        name: "Head",
        children: [originalRoot, nodes.length - 1, nodes.length - 2],
        extensions: { MOZ_hubs_components: { "scale-audio-feedback": "" } }
      });
      nodes.push({ name: "Neck", children: [nodes.length - 1] });
      nodes.push({ name: "Spine", children: [nodes.length - 1] });
      nodes.push({ name: "Hips", children: [nodes.length - 1] });
      nodes.push({ name: "AvatarRoot", children: [nodes.length - 1] });
      json.scenes[json.scene].nodes[0] = nodes.length - 1;
      return json;
    }

    // Otherwise, we already have a humanoid-ish skeleton with the expected node names.
    // Just add an AvatarRoot wrapper so that hub.html templates attach ik-controller.
    nodes.push({ name: "AvatarRoot", children: [originalRoot] });
    json.scenes[json.scene].nodes[0] = nodes.length - 1;

    // Ensure LeftEye/RightEye exist so ik-controller doesn't break on skeletons without eye bones.
    const hasLeftEye = nodes.some(node => node.name === "LeftEye");
    const hasRightEye = nodes.some(node => node.name === "RightEye");
    if (!hasLeftEye || !hasRightEye) {
      const headIndex = nodes.findIndex(node => node.name === "Head");
      if (headIndex !== -1) {
        const eyeChildIndices = [];
        const eyeOffsetX = 0.03;
        const eyeOffsetY = 0.06;
        const eyeOffsetZ = 0.09;

        if (!hasLeftEye) {
          nodes.push({
            name: "LeftEye",
            translation: [-eyeOffsetX, eyeOffsetY, eyeOffsetZ],
            extensions: { MOZ_hubs_components: {} }
          });
          eyeChildIndices.push(nodes.length - 1);
        }

        if (!hasRightEye) {
          nodes.push({
            name: "RightEye",
            translation: [eyeOffsetX, eyeOffsetY, eyeOffsetZ],
            extensions: { MOZ_hubs_components: {} }
          });
          eyeChildIndices.push(nodes.length - 1);
        }

        if (eyeChildIndices.length > 0) {
          nodes[headIndex].children = (nodes[headIndex].children || []).concat(eyeChildIndices);
        }
      }
    }
  }

  return json;
}

AFRAME.registerComponent("player-info", {
  schema: {
    avatarSrc: { type: "string" },
    avatarType: { type: "string", default: AVATAR_TYPES.SKINNABLE },
    muted: { default: false },
    isSharingAvatarCamera: { default: false },
    isSitting: { default: false }
  },
  init() {
    this.applyProperties = this.applyProperties.bind(this);
    this.handleModelError = this.handleModelError.bind(this);
    this.handleRemoteModelError = this.handleRemoteModelError.bind(this);
    this.update = this.update.bind(this);
    this.onPresenceUpdated = this.onPresenceUpdated.bind(this);
    this.onMicStateChanged = this.onMicStateChanged.bind(this);
    this.onAvatarModelLoaded = this.onAvatarModelLoaded.bind(this);

    this.isLocalPlayerInfo = this.el.id === "avatar-rig";
    this.playerSessionId = null;
    this.displayName = null;

    if (!this.isLocalPlayerInfo) {
      NAF.utils.getNetworkedEntity(this.el).then(networkedEntity => {
        this.playerSessionId = NAF.utils.getCreator(networkedEntity);
        const playerPresence = window.APP.hubChannel.presence.state[this.playerSessionId];
        if (playerPresence) {
          this.permissions = playerPresence.metas[0].permissions;
          this.displayName = playerPresence.metas[0].profile.displayName;
        }
      });
    }

    registerComponentInstance(this, "player-info");
    addComponent(APP.world, this.isLocalPlayerInfo ? LocalAvatar : RemoteAvatar, this.el.object3D.eid);
  },

  remove() {
    const avatarEl = this.el.querySelector("[avatar-audio-source]");
    APP.isAudioPaused.delete(avatarEl);
    deregisterComponentInstance(this, "player-info");
    removeComponent(APP.world, this.isLocalPlayerInfo ? LocalAvatar : RemoteAvatar, this.el.object3D.eid);
  },

  onAvatarModelLoaded(e) {
    this.applyProperties(e);

    const modelEl = this.el.querySelector(".model");
    if (this.isLocalPlayerInfo && e.target === modelEl) {
      let isSkinnedAvatar = false;
      modelEl.object3D.traverse(function (o) {
        if (o.isSkinnedMesh) {
          const headlessMesh = createHeadlessModelForSkinnedMesh(o);
          if (headlessMesh) {
            isSkinnedAvatar = true;
            o.parent.add(headlessMesh);
          }
        }
      });
      // This is to support using arbitrary models as avatars.
      // TODO We can drop support for this when we go full VRM, or at least handle it earlier in the process.
      if (!isSkinnedAvatar) {
        modelEl.object3D.traverse(function (o) {
          if (o.isMesh) o.layers.set(Layers.CAMERA_LAYER_THIRD_PERSON_ONLY);
        });
      }
    }
  },

  play() {
    this.el.addEventListener("model-loaded", this.onAvatarModelLoaded);
    this.el.sceneEl.addEventListener("presence_updated", this.onPresenceUpdated);
    if (this.isLocalPlayerInfo) {
      this.el.querySelector(".model").addEventListener("model-error", this.handleModelError);
    } else {
      this.el.querySelector(".model").addEventListener("model-error", this.handleRemoteModelError);
    }
    window.APP.store.addEventListener("statechanged", this.update);

    this.el.sceneEl.addEventListener("stateadded", this.update);
    this.el.sceneEl.addEventListener("stateremoved", this.update);

    if (this.isLocalPlayerInfo) {
      APP.dialog.on("mic-state-changed", this.onMicStateChanged);
    }
  },

  pause() {
    this.el.removeEventListener("model-loaded", this.onAvatarModelLoaded);
    this.el.sceneEl.removeEventListener("presence_updated", this.onPresenceUpdated);
    if (this.isLocalPlayerInfo) {
      this.el.querySelector(".model").removeEventListener("model-error", this.handleModelError);
    } else {
      this.el.querySelector(".model").removeEventListener("model-error", this.handleRemoteModelError);
    }
    this.el.sceneEl.removeEventListener("stateadded", this.update);
    this.el.sceneEl.removeEventListener("stateremoved", this.update);
    window.APP.store.removeEventListener("statechanged", this.update);

    if (this.isLocalPlayerInfo) {
      APP.dialog.off("mic-state-changed", this.onMicStateChanged);
    }
  },

  onPresenceUpdated(e) {
    this.updateFromPresenceMeta(e.detail);
  },

  updateFromPresenceMeta(presenceMeta) {
    if (!this.playerSessionId && this.isLocalPlayerInfo) {
      this.playerSessionId = NAF.clientId;
    }
    if (!this.playerSessionId || this.playerSessionId !== presenceMeta.sessionId) return;

    this.permissions = presenceMeta.permissions;
  },

  update(oldData) {
    if (this.data.muted !== oldData.muted) {
      this.el.emit("remote_mute_updated", { muted: this.data.muted });
    }
    this.applyProperties();
  },

  can(perm) {
    return !!this.permissions && this.permissions[perm];
  },

  applyProperties(e) {
    const modelEl = this.el.querySelector(".model");
    if (this.data.avatarSrc && modelEl) {
      modelEl.components["gltf-model-plus"].jsonPreprocessor = ensureAvatarNodes;
      modelEl.setAttribute("gltf-model-plus", "src", this.data.avatarSrc);
    }

    if (!e || e.target === modelEl) {
      const uniforms = injectCustomShaderChunks(this.el.object3D);
      this.el.querySelectorAll("[hover-visuals]").forEach(el => {
        el.components["hover-visuals"].uniforms = uniforms;
      });
    }

    const videoTextureTargets = modelEl.querySelectorAll("[video-texture-target]");

    const sessionId = this.isLocalPlayerInfo ? NAF.clientId : this.playerSessionId;

    for (const el of Array.from(videoTextureTargets)) {
      el.setAttribute("video-texture-target", {
        src: this.data.isSharingAvatarCamera ? `hubs://clients/${sessionId}/video` : ""
      });

      if (this.isLocalPlayerInfo) {
        el.setAttribute("emit-scene-event-on-remove", `event:${MediaDevicesEvents.VIDEO_SHARE_ENDED}`);
      }
    }

    const avatarEl = this.el.querySelector("[avatar-audio-source]");
    if (this.data.muted) {
      APP.isAudioPaused.add(avatarEl);
    } else {
      APP.isAudioPaused.delete(avatarEl);
    }
  },

  handleModelError() {
    window.APP.store.resetToRandomDefaultAvatar();
  },

  handleRemoteModelError() {
    this.data.avatarSrc = defaultAvatar;
    this.applyProperties();
  },

  onMicStateChanged({ enabled }) {
    this.el.setAttribute("player-info", { muted: !enabled });
  }
});
