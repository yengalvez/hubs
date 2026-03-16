// Shared GLTF JSON preprocessor for avatar models (player avatars + bot avatars).
//
// Hubs attaches templates/IK/locomotion by matching node names (AvatarRoot, Hips, LeftUpLeg, ...).
// Many RPM/Mixamo exports prefix bone names (e.g. "mixamorig:Hips") and sometimes omit AvatarRoot/Eyes.
// This normalizer makes those assets compatible with the existing hub.html templates.

export function ensureAvatarNodes(json) {
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

  // Hubs avatar functionality (templates, IK, locomotion) keys off node names like
  // "AvatarRoot", "Spine", "LeftHand", etc.
  normalizeHumanoidNodeNames();

  if (!nodes.some(node => node.name === "AvatarRoot")) {
    // Note: We assume that the first node in the primary scene is the one we care about.
    const originalRoot = json.scenes[json.scene].nodes[0];

    // Keep this minimal; some valid skeletons won't match all Hubs-required bone names.
    const requiredNodes = ["Hips", "Spine", "Neck", "Head"];
    const hasRequiredNodes = requiredNodes.every(n => nodes.some(node => node.name === n));

    if (!hasRequiredNodes) {
      // If the model doesn't have basic Hubs node names, construct a suitable hierarchy
      // by wrapping the existing root.
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
    // Just add an AvatarRoot wrapper so that hub.html templates can attach components.
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
            extras: { hubsInjectedEye: true },
            extensions: { MOZ_hubs_components: {} }
          });
          eyeChildIndices.push(nodes.length - 1);
        }

        if (!hasRightEye) {
          nodes.push({
            name: "RightEye",
            translation: [eyeOffsetX, eyeOffsetY, eyeOffsetZ],
            extras: { hubsInjectedEye: true },
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
