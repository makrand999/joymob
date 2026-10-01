import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLookDelta, cameraOffset, PITCH_MIN, PITCH_MAX } from '../camera.js';

const RATE = 1.5; // rad per deflection unit; game feel constant

test('upward finger motion (dy>0) looks up: pitch decreases', () => {
  const r = applyLookDelta(0, 1.0, 0, 0.5, RATE);
  assert.ok(Math.abs(r.pitch - (1.0 - 0.5 * RATE)) < 1e-9, `pitch=${r.pitch}`);
});

test('downward finger motion (dy<0) looks down: pitch increases', () => {
  const r = applyLookDelta(0, 0.35, 0, -0.5, RATE);
  assert.ok(r.pitch > 0.35, `pitch=${r.pitch}`);
});

test('resting finger (zero delta) holds the camera perfectly still', () => {
  const r = applyLookDelta(0.3, 0.35, 0, 0, RATE);
  assert.deepEqual(r, { yaw: 0.3, pitch: 0.35 });
});

test('camera travel is proportional to total drag distance', () => {
  // Two half-drags equal one full drag (mouse-like, not stick-like).
  const a = applyLookDelta(0, 0.6, 0.25, 0.25, RATE);
  const b = applyLookDelta(a.yaw, a.pitch, 0.25, 0.25, RATE);
  const whole = applyLookDelta(0, 0.6, 0.5, 0.5, RATE);
  assert.ok(Math.abs(b.yaw - whole.yaw) < 1e-9);
  assert.ok(Math.abs(b.pitch - whole.pitch) < 1e-9);
});

test('pitch clamps at both ends', () => {
  assert.equal(applyLookDelta(0, 0, 0, 99, RATE).pitch, PITCH_MIN);
  assert.equal(applyLookDelta(0, 0, 0, -99, RATE).pitch, PITCH_MAX);
});

test('higher pitch raises the camera (looking down over the ball)', () => {
  const lo = cameraOffset(0, 0, 8);
  const hi = cameraOffset(0, 1, 8);
  assert.ok(hi.y > lo.y);
  assert.ok(Math.abs(lo.x) < 1e-9 && Math.abs(lo.z - 8) < 1e-9);
});

test('rightward finger motion (dx>0) yaws the view right (negative yaw)', () => {
  const r = applyLookDelta(0, 0.35, 0.5, 0, RATE);
  assert.ok(r.yaw < 0, `yaw=${r.yaw}`);
});
