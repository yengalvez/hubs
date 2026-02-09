const REQUIRED_UPPER_BODY_BONES = [
  "Hips",
  "Spine",
  "Neck",
  "Head",
  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightShoulder",
  "RightArm",
  "RightForeArm",
  "RightHand"
];

const REQUIRED_FULLBODY_BONES = ["LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"];

const RPM_NAME_HINTS = ["mixamorig", "wolf3d", "readyplayerme", "armature"];

const normalizeBoneName = name => {
  return (name || "")
    .toLowerCase()
    .replace(/^mixamorig[:_]?/g, "")
    .replace(/[^a-z0-9]/g, "");
};

const normalizedUpperBodyBones = REQUIRED_UPPER_BODY_BONES.map(normalizeBoneName);
const normalizedFullbodyBones = REQUIRED_FULLBODY_BONES.map(normalizeBoneName);

const collectSkeletonBones = object3D => {
  const bones = new Set();
  object3D.traverse(node => {
    if (node.isSkinnedMesh && node.skeleton && Array.isArray(node.skeleton.bones)) {
      node.skeleton.bones.forEach(bone => bones.add(bone));
    }
  });
  return Array.from(bones);
};

const hasAllRequiredBones = (requiredBones, normalizedBoneNames) => {
  return requiredBones.every(requiredBone => normalizedBoneNames.has(requiredBone));
};

export const getAvatarSkeletonMetadata = object3D => {
  if (!object3D) {
    return {
      hasSkeleton: false,
      hasRequiredUpperBody: false,
      isFullBody: false,
      isRpmLike: false,
      boneCount: 0,
      missingUpperBodyBones: REQUIRED_UPPER_BODY_BONES
    };
  }

  const bones = collectSkeletonBones(object3D);
  const boneNames = bones.map(bone => bone.name).filter(Boolean);
  const normalizedBoneNames = new Set(boneNames.map(normalizeBoneName));
  const hasRequiredUpperBody = hasAllRequiredBones(normalizedUpperBodyBones, normalizedBoneNames);
  const isFullBody = hasAllRequiredBones(normalizedFullbodyBones, normalizedBoneNames);
  const isRpmLike =
    boneNames.some(name => RPM_NAME_HINTS.some(hint => name.toLowerCase().includes(hint))) ||
    boneNames.some(name => name.toLowerCase().startsWith("mixamorig"));

  return {
    hasSkeleton: boneNames.length > 0,
    hasRequiredUpperBody,
    isFullBody,
    isRpmLike,
    boneCount: boneNames.length,
    missingUpperBodyBones: REQUIRED_UPPER_BODY_BONES.filter(
      requiredBone => !normalizedBoneNames.has(normalizeBoneName(requiredBone))
    )
  };
};
