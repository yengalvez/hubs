import test from "ava";

import { getAvatarSkeletonMetadata } from "../../../src/utils/avatar-skeleton-utils";

const upperBodyBones = [
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

const fullBodyBones = ["LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"];

const objectWithBones = boneNames => ({
  traverse(callback) {
    callback({
      isSkinnedMesh: true,
      skeleton: { bones: boneNames.map(name => ({ name })) }
    });
  }
});

test("detects a prefixed RPM full-body skeleton", t => {
  const metadata = getAvatarSkeletonMetadata(
    objectWithBones([...upperBodyBones, ...fullBodyBones].map(name => `mixamorig:${name}`))
  );

  t.true(metadata.hasSkeleton);
  t.true(metadata.hasRequiredUpperBody);
  t.true(metadata.isFullBody);
  t.true(metadata.isRpmLike);
  t.deepEqual(metadata.missingUpperBodyBones, []);
});

test("reports the required bones missing from an incompatible skeleton", t => {
  const metadata = getAvatarSkeletonMetadata(objectWithBones(["Hips", "Spine", "Head"]));

  t.true(metadata.hasSkeleton);
  t.false(metadata.hasRequiredUpperBody);
  t.false(metadata.isFullBody);
  t.true(metadata.missingUpperBodyBones.includes("Neck"));
  t.true(metadata.missingUpperBodyBones.includes("LeftHand"));
  t.true(metadata.missingUpperBodyBones.includes("RightHand"));
});

test("handles a scene without a skinned mesh", t => {
  const metadata = getAvatarSkeletonMetadata(objectWithBones([]));

  t.false(metadata.hasSkeleton);
  t.false(metadata.hasRequiredUpperBody);
  t.is(metadata.boneCount, 0);
});
