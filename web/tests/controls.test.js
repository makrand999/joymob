const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../controls.js');

test('stickVector centers and clamps', () => {
  assert.deepEqual(C.stickVector(0, 0, 60, 0.1), { x: 0, y: 0 });
  // Half drag up-screen -> +y (stick up), deadzone-rescaled.
  const v = C.stickVector(0, -30, 60, 0.1);
  assert.ok(Math.abs(v.x) < 1e-9);
  assert.ok(Math.abs(v.y - (0.5 - 0.1) / 0.9) < 1e-9);
  // Far drag clamps to magnitude 1.
  const c = C.stickVector(300, 400, 60, 0.1);
  assert.ok(Math.abs(Math.hypot(c.x, c.y) - 1) < 1e-9);
});

test('stickVector deadzone swallows jitter', () => {
  assert.deepEqual(C.stickVector(3, 2, 60, 0.1), { x: 0, y: 0 });
});

test('applySprint pins live deflection to full', () => {
  assert.deepEqual(C.applySprint({ x: 0, y: 0 }), { x: 0, y: 0 });
  const s = C.applySprint({ x: 0.3, y: 0.4 });
  assert.ok(Math.abs(Math.hypot(s.x, s.y) - 1) < 1e-9);
  assert.ok(Math.abs(s.x - 0.6) < 1e-9 && Math.abs(s.y - 0.8) < 1e-9);
});

test('lookVector is relative and sensitivity-scaled', () => {
  // No movement -> centered.
  assert.deepEqual(C.lookVector(0, 0, 140, 1), { x: 0, y: 0 });
  // Drag up-screen -> look up (+y).
  const v = C.lookVector(0, -70, 140, 1);
  assert.ok(Math.abs(v.x) < 1e-9 && Math.abs(v.y - 0.5) < 1e-9);
  // Sensitivity doubles the deflection, clamp keeps magnitude 1.
  const c = C.lookVector(0, -140, 140, 2);
  assert.ok(Math.abs(Math.hypot(c.x, c.y) - 1) < 1e-9);
});

test('apiBase derives direct vs proxied deployments', () => {
  assert.equal(C.apiBase('https://pc:8080', '/app/'), 'https://pc:8080');
  assert.equal(C.apiBase('https://pc:8080', '/app/index.html'), 'https://pc:8080');
  assert.equal(C.apiBase('https://pc:8080', '/'), 'https://pc:8080');
  assert.equal(C.apiBase('https://csd.mitasia.in', '/joymob/'),
    'https://csd.mitasia.in/joymob');
  assert.equal(C.apiBase('', '/joymob/'), '');
});

test('lookDelta telescopes: summed deltas equal total drag', () => {
  // Simulated drag samples; each delta is measured from the previous one.
  const samples = [{ x: 0, y: 0 }, { x: 0.2, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: -0.2 }];
  let sx = 0;
  let sy = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = C.lookDelta(samples[i], samples[i - 1]);
    sx += d.dx;
    sy += d.dy;
  }
  assert.ok(Math.abs(sx - 0.5) < 1e-9 && Math.abs(sy + 0.2) < 1e-9);
  // Resting finger emits zero delta.
  assert.deepEqual(C.lookDelta({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }), { dx: 0, dy: 0 });
});

test('quantizeState + statesEqual calm jitter', () => {
  const a = C.quantizeState({ buttons: ['b', 'a'], lx: 0.50001, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 });
  const b = C.quantizeState({ buttons: ['a', 'b'], lx: 0.49999, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 });
  assert.ok(C.statesEqual(a, b));
  const c = C.quantizeState({ buttons: ['a'], lx: 1, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 });
  assert.ok(!C.statesEqual(a, c));
});
