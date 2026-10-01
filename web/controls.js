// Pure control math for the joymb mobile HUD. No DOM access, so this file is
// unit-testable under node (web/tests/controls.test.js) and loaded as a plain
// script in the browser.
(function (root) {
  'use strict';

  // Stick deflection from a drag vector. dx/dy are pixels from the touch
  // origin (screen coords, +y down); radius is full-deflection pixels.
  // Returns {x, y} in [-1, 1], y-up, with deadzone applied and clamped.
  function stickVector(dx, dy, radius, deadzone) {
    var x = dx / radius;
    var y = -dy / radius; // screen down -> stick down (negative)
    var mag = Math.hypot(x, y);
    if (mag < deadzone || mag === 0) return { x: 0, y: 0 };
    // Rescale so the deadzone edge maps to 0 and full radius to 1.
    var scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
    return { x: (x / mag) * scaled + 0, y: (y / mag) * scaled + 0 };
  }

  // Sprint (RUN toggle): any live deflection is pushed to full magnitude,
  // like pinning a physical stick to its gate.
  function applySprint(vec) {
    var mag = Math.hypot(vec.x, vec.y);
    if (mag === 0) return { x: 0, y: 0 };
    return { x: vec.x / mag, y: vec.y / mag };
  }

  // Look deflection from a drag vector on the right-half pad. Relative drag:
  // offset from touch origin maps to angular velocity (right-stick
  // deflection). Sensitivity scales the offset before clamping.
  function lookVector(dx, dy, radius, sensitivity) {
    var x = (dx / radius) * sensitivity;
    var y = (-dy / radius) * sensitivity; // drag up -> look up
    var mag = Math.hypot(x, y);
    if (mag <= 1) return { x: x + 0, y: y + 0 }; // +0 kills -0
    return { x: x / mag + 0, y: y / mag + 0 };
  }

  // Mouse-style look delta: how far the look vector moved since the given
  // baseline (the last delivered sample). Summed over a drag, deltas equal
  // the total deflection travelled — the camera moves exactly as far/fast as
  // the finger, and rests when the finger rests.
  function lookDelta(cur, base) {
    return { dx: cur.x - base.x, dy: cur.y - base.y };
  }

  // Quantize floats so float jitter doesn't spam the network.
  function quantizeState(s) {
    function q(v) { return Math.round(v * 200) / 200; }
    return {
      buttons: s.buttons.slice().sort(),
      lx: q(s.lx), ly: q(s.ly), rx: q(s.rx), ry: q(s.ry),
      lt: q(s.lt), rt: q(s.rt),
      dx: q(s.dx || 0), dy: q(s.dy || 0),
    };
  }

  function statesEqual(a, b) {
    if (a.buttons.length !== b.buttons.length) return false;
    for (var i = 0; i < a.buttons.length; i++) {
      if (a.buttons[i] !== b.buttons[i]) return false;
    }
    return a.lx === b.lx && a.ly === b.ly && a.rx === b.rx &&
      a.ry === b.ry && a.lt === b.lt && a.rt === b.rt &&
      a.dx === b.dx && a.dy === b.dy;
  }

  // API base for the connect screen. Direct on joymb-server (app at /app/,
  // API at origin root) -> origin. Proxied subpath deployment (page at
  // /joymob/, API at /joymob/api/) -> origin + first segment.
  function apiBase(origin, pathname) {
    if (!origin) return '';
    var segs = (pathname || '').split('/');
    var first = segs.length > 1 ? segs[1] : '';
    if (!first || first === 'app') return origin;
    return origin + '/' + first;
  }

  var api = { stickVector: stickVector, applySprint: applySprint,
    lookVector: lookVector, lookDelta: lookDelta,
    quantizeState: quantizeState, statesEqual: statesEqual, apiBase: apiBase };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api; // node tests
  } else {
    root.JoymbControls = api; // browser
  }
})(typeof self !== 'undefined' ? self : this);
