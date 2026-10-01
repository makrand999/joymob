// Minimal 3D ball rig for testing the joymb phone controller.
// Polls the same-origin /joymob/api/devices endpoint and drives:
//   left stick  -> roll the ball (camera-relative)
//   right stick -> orbit the camera around the ball
//   A (jump)    -> hop (rising edge while grounded)
// The lowest-slot device drives; the overlay names it.
import * as THREE from 'three';
import { applyLookDelta, cameraOffset } from './camera.js?v=4';

const POLL_MS = 50; // 20 Hz: comfortably under typical rate limits
const SPEED = 6;          // ball units/second at full stick
const LOOK_RATE = 1.5;    // camera rad per look-delta unit (mouse-like feel)
const JUMP_V = 5.2;
const GRAVITY = -12;
const BALL_R = 0.5;
const CAM_DIST = 8;

const input = { buttons: [], lx: 0, ly: 0, rx: 0, ry: 0, dx: 0, dy: 0 };
let driverLabel = '';
let hasDriver = false;
let prevA = false;
let lastSeenSeq = -1;
let lastSeenDevice = '';

const driverEl = document.getElementById('driver');
const readoutEl = document.getElementById('readout');

async function poll() {
  try {
    const res = await fetch('/joymob/api/devices', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const devs = (await res.json()).devices || [];
    devs.sort((a, b) => a.controller_index - b.controller_index);
    if (!devs.length) {
      hasDriver = false;
      driverLabel = '';
      return;
    }
    const d = devs[0];
    hasDriver = true;
    driverLabel = `${d.device_name} · slot ${d.controller_index + 1}`;
    // Consume each server state exactly once: re-applying a stale delta
    // would turn a held finger into camera drift.
    if (d.device_id !== lastSeenDevice) {
      lastSeenDevice = d.device_id;
      lastSeenSeq = -1;
    }
    if (d.input_seq === lastSeenSeq) return;
    lastSeenSeq = d.input_seq;
    const li = d.last_input || {};
    input.buttons = li.buttons || [];
    input.lx = li.lx || 0;
    input.ly = li.ly || 0;
    input.rx = li.rx || 0;
    input.ry = li.ry || 0;
    // Accumulate (+=, never =): frames may run slower than polls, and every
    // fresh server state must contribute its delta exactly once. step()
    // consumes the pending total each frame.
    input.dx += li.look_dx || 0;
    input.dy += li.look_dy || 0;
  } catch (err) {
    hasDriver = false; // server unreachable; overlay keeps last label
  }
}
setInterval(poll, POLL_MS);
poll();

// ---------- scene ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: true });
} catch (err) {
  document.getElementById('nogl').hidden = false;
  throw err;
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0f12);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(6, 10, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(60, 60, 0x3d4654, 0x2a323d);
grid.position.y = 0.01;
scene.add(grid);

const ball = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R, 48, 32),
  new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.35, metalness: 0.1 }),
);
ball.castShadow = true;
ball.position.set(0, BALL_R, 0);
scene.add(ball);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
let camYaw = 0;
let camPitch = 0.35;
let vy = 0;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug/verification handle (read-only snapshots).
window.__ball = {
  pos: () => [ball.position.x, ball.position.y, ball.position.z],
  cam: () => [camYaw, camPitch],
  driver: () => (hasDriver ? driverLabel : ''),
};

const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const rollAxis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function step(dt) {
  // Camera orbit, mouse-style: each poll consumes the finger travel since
  // the last poll exactly once, then zeroes it so a held deflection never
  // turns into drift. Sign conventions live in camera.js, unit-tested.
  const next = applyLookDelta(camYaw, camPitch, input.dx, input.dy, LOOK_RATE);
  camYaw = next.yaw;
  camPitch = next.pitch;
  input.dx = 0;
  input.dy = 0;

  // Ball roll (left stick, camera-relative).
  fwd.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  right.set(-fwd.z, 0, fwd.x);
  const mx = right.x * input.lx + fwd.x * input.ly;
  const mz = right.z * input.lx + fwd.z * input.ly;
  ball.position.x += mx * SPEED * dt;
  ball.position.z += mz * SPEED * dt;
  const planar = Math.hypot(mx, mz);
  if (planar > 0.01) {
    rollAxis.set(mz, 0, -mx).normalize();
    ball.rotateOnWorldAxis(rollAxis, (planar * SPEED * dt) / BALL_R);
  }

  // Hop on rising A edge while grounded, then gravity.
  const a = input.buttons.includes('a');
  const grounded = ball.position.y <= BALL_R + 1e-3;
  if (a && !prevA && grounded) vy = JUMP_V;
  prevA = a;
  vy += GRAVITY * dt;
  ball.position.y += vy * dt;
  if (ball.position.y < BALL_R) {
    ball.position.y = BALL_R;
    vy = 0;
  }

  // Follow camera.
  const off = cameraOffset(camYaw, camPitch, CAM_DIST);
  camera.position.set(
    ball.position.x + off.x,
    ball.position.y + 1.2 + off.y,
    ball.position.z + off.z,
  );
  camera.lookAt(ball.position.x, ball.position.y + 0.4, ball.position.z);

  driverEl.textContent = hasDriver ? `driver: ${driverLabel}` : 'waiting for controller…';
  driverEl.classList.toggle('live', hasDriver);
  readoutEl.textContent =
    `lx ${input.lx.toFixed(2)} ly ${input.ly.toFixed(2)} ` +
    `rx ${input.rx.toFixed(2)} ry ${input.ry.toFixed(2)} [${input.buttons.join(',')}]`;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  step(dt);
  renderer.render(scene, camera);
}
animate();
