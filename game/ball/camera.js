// Pure third-person orbit math for the ball rig. No three.js dependency, so
// node tests (game/ball/tests/camera.test.mjs) guard the conventions.
//
// Mouse-style look: the phone sends per-update deltas (deflection units the
// finger travelled since the last delivered sample), NOT a held deflection.
// The camera moves exactly as far/fast as the finger and rests when it rests:
// holding a drag delivers dx=dy=0 and the camera stays put (unlike a stick,
// where held deflection means continuous turning).
//
// Sign conventions (match the phone controller + XInput right stick):
//   dy = +1  <=>  finger moved UP    <=>  look up (pitch decreases)
//   dx = +1  <=>  finger moved RIGHT <=>  look right (yaw decreases)
// Pitch is the camera's elevation angle: higher pitch raises the camera,
// which (looking at a fixed point on the ball) tilts the view DOWN.
export const PITCH_MIN = -0.05;
export const PITCH_MAX = 1.25;

export function applyLookDelta(yaw, pitch, dx, dy, rate) {
  return {
    yaw: yaw - dx * rate,
    pitch: clamp(pitch - dy * rate, PITCH_MIN, PITCH_MAX),
  };
}

export function cameraOffset(yaw, pitch, dist) {
  const cp = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * dist * cp,
    y: Math.sin(pitch) * dist,
    z: Math.cos(yaw) * dist * cp,
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
