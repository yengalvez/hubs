import { MathUtils, Quaternion } from "three";

// The bundled forward walk travels 1.787 m in one 1 s source cycle. Bot movement
// is authored separately on the navmesh, so its visual cycle must follow that
// distance. A shorter leg swing makes the effective stride about 1.1 m.
export const BOT_WALK_SWING_FACTOR = 0.62;
export const BOT_WALK_ARM_SWING_FACTOR = 0.65;
export const BOT_WALK_STRIDE_METERS = 1.1;
export const BOT_WALK_HIP_MOTION_FACTOR = 0.2;

const LEG_BONES = /^(Left|Right)(UpLeg|Leg|Foot|ToeBase)\.quaternion$/;
const ARM_BONES = /^(Left|Right)(Shoulder|Arm|ForeArm)\.quaternion$/;

function closeBotWalkLoop(clip) {
  const first = new Quaternion();
  const last = new Quaternion();
  const middle = new Quaternion();
  for (const track of clip.tracks) {
    if ((!LEG_BONES.test(track.name) && !ARM_BONES.test(track.name)) || track.values.length < 8) continue;
    const end = track.values.length - 4;
    first.fromArray(track.values, 0);
    last.fromArray(track.values, end);
    middle.copy(first).slerp(last, 0.5).toArray(track.values, 0);
    middle.toArray(track.values, end);
  }
}

export function shortenBotWalkStride(walkClip, idleClip) {
  const idleTracks = new Map(idleClip.tracks.map(track => [track.name, track]));
  const shortened = walkClip.clone();
  const neutral = new Quaternion();
  const sample = new Quaternion();
  const scaled = new Quaternion();

  for (const track of shortened.tracks) {
    const factor = LEG_BONES.test(track.name)
      ? BOT_WALK_SWING_FACTOR
      : ARM_BONES.test(track.name)
        ? BOT_WALK_ARM_SWING_FACTOR
        : null;
    if (factor === null) continue;
    const idleTrack = idleTracks.get(track.name);
    if (!idleTrack || idleTrack.values.length < 4) continue;

    neutral.fromArray(idleTrack.values, 0);
    for (let i = 0; i < track.values.length; i += 4) {
      sample.fromArray(track.values, i);
      scaled.slerpQuaternions(neutral, sample, factor);
      scaled.toArray(track.values, i);
    }
  }

  return shortened;
}

// The source Mixamo walk includes a smooth vertical Hips.position rhythm,
// dropped for player avatars to avoid camera motion. For bots, restoring a
// reduced version of that authored rhythm lowers the whole stance naturally.
// It does not pitch a toe down or alter the navmesh path/root transform.
export function addBotWalkHipMotion(walkClip, root) {
  const hips = root.getObjectByName("Hips");
  const sourceTrack = walkClip.tracks.find(track => track.name === "Hips.position");
  if (!hips || !sourceTrack || sourceTrack.getValueSize() !== 3 || sourceTrack.times.length < 2) return walkClip;

  const result = walkClip.clone();
  const track = result.tracks.find(item => item.name === "Hips.position");
  const sourceY = sourceTrack.values[1];
  const heightRatio = Math.abs(sourceY) > 1e-4 ? Math.abs(hips.position.y / sourceY) : 1;
  const scale = MathUtils.clamp(heightRatio, 0.5, 1.5) * BOT_WALK_HIP_MOTION_FACTOR;
  for (let i = 0; i < track.values.length; i += 3) {
    track.values[i] = hips.position.x;
    track.values[i + 1] = hips.position.y + (sourceTrack.values[i + 1] - sourceY) * scale;
    track.values[i + 2] = hips.position.z;
  }
  // The source clip is nearly, but not perfectly, periodic.
  const end = track.values.length - 3;
  const seamY = (track.values[1] + track.values[end + 1]) / 2;
  track.values[1] = seamY;
  track.values[end + 1] = seamY;
  closeBotWalkLoop(result);
  return result;
}

export function botWalkCycleTimeScale(speedMetersPerSecond, clipDurationSeconds) {
  if (!Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond <= 0) return 0;
  if (!Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) return 0;
  return MathUtils.clamp((speedMetersPerSecond * clipDurationSeconds) / BOT_WALK_STRIDE_METERS, 0.08, 2.2);
}
