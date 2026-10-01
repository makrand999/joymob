// joymb mobile HUD: floating PUBG-style stick (left half), relative-drag look
// pad (right half), and a data-driven button cluster (jump/run/crouch).
(function () {
  'use strict';

  var C = window.JoymbControls;
  var STICK_DEADZONE = 0.12;
  var LOOK_RADIUS = 140;    // px of drag = full look deflection at sens 1.0
  var SEND_MS = 50;         // input post rate
  var HEARTBEAT_MS = 10000;
  var MAX_BUTTONS = 12;

  // Built-in buttons. kind "pad" sends a gamepad button while held;
  // kind "toggle" flips client-side sprint. Custom buttons (kind "pad")
  // are appended from storage at startup.
  var BUILTIN_DEFS = [
    { id: 'jump', label: 'JUMP', kind: 'pad', pad: 'a' },
    { id: 'crouch', label: 'CRCH', kind: 'pad', pad: 'b' },
    { id: 'run', label: 'RUN', kind: 'toggle' },
  ];
  var BUTTON_DEFS = BUILTIN_DEFS.slice();
  // Gamepad actions a custom button can send (server names).
  var PAD_ACTIONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'l3', 'r3', 'start',
    'back', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'guide'];
  var DEFAULT_LAYOUT = {
    jump: { x: 88, y: 76, size: 76 },
    crouch: { x: 73, y: 82, size: 76 },
    run: { x: 88, y: 56, size: 68 },
  };
  var CUSTOM_DEFAULT = { x: 60, y: 50, size: 68 };

  function $(id) { return document.getElementById(id); }

  // ---------- persistent settings ----------
  function loadJson(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v || fallback;
    } catch (e) { return fallback; }
  }
  var layout = loadJson('joymb.layout.v1', {});
  var customButtons = loadJson('joymb.custom.v1', []);
  if (!Array.isArray(customButtons)) customButtons = [];
  customButtons = customButtons.filter(function (b) {
    return b && typeof b.id === 'string' && typeof b.label === 'string' &&
      PAD_ACTIONS.indexOf(b.pad) >= 0;
  }).slice(0, MAX_BUTTONS);
  customButtons.forEach(function (b) {
    BUTTON_DEFS.push({ id: b.id, label: b.label, kind: 'pad', pad: b.pad });
  });
  BUTTON_DEFS.forEach(function (d) {
    var fallback = DEFAULT_LAYOUT[d.id] || CUSTOM_DEFAULT;
    layout[d.id] = Object.assign({}, fallback, layout[d.id]);
  });
  var settings = Object.assign(
    { sensitivity: 1.0, stickSize: 62, serverUrl: '', deviceName: '', deviceId: '' },
    loadJson('joymb.settings.v1', {}));
  function saveLayout() {
    try { localStorage.setItem('joymb.layout.v1', JSON.stringify(layout)); } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem('joymb.settings.v1', JSON.stringify(settings)); } catch (e) {}
  }
  function saveCustom() {
    try { localStorage.setItem('joymb.custom.v1', JSON.stringify(customButtons)); } catch (e) {}
  }

  // ---------- live state ----------
  var serverUrl = '';
  var deviceId = null;
  var reconnecting = false;
  var sessionGen = 0; // disconnect() bumps; stale reconnects check it
  var sendTimer = null;
  var heartbeatTimer = null;
  var lastSent = null;
  var netFails = 0;
  var editing = false;
  var selectedBtn = 'jump';

  var stick = { pointerId: null, ox: 0, oy: 0, x: 0, y: 0 };
  var look = { pointerId: null, ox: 0, oy: 0, x: 0, y: 0 };
  // Mouse-style delta baseline: the last DELIVERED look sample. Updated only
  // on acknowledged sends (with a sequence guard against reordered replies)
  // so failed sends re-deliver their delta instead of losing camera motion.
  // Reset to neutral on finger lift so release emits no snap-back spike.
  var lookBase = { x: 0, y: 0, seq: 0 };
  var lookSeq = 0;
  var heldPadButtons = {}; // pad name -> count (multi-touch safe)
  var sprint = false;

  // ---------- buttons ----------
  var btnEls = {};
  function buildButtons() {
    var layer = $('buttons');
    layer.innerHTML = '';
    BUTTON_DEFS.forEach(function (def) {
      var el = document.createElement('div');
      el.className = 'pad-btn';
      el.textContent = def.label;
      el.dataset.id = def.id;
      layer.appendChild(el);
      btnEls[def.id] = el;
      placeButton(def.id);
      el.addEventListener('pointerdown', function (ev) { onBtnDown(ev, def); });
      el.addEventListener('pointerup', function (ev) { onBtnUp(ev, def); });
      el.addEventListener('pointercancel', function (ev) { onBtnUp(ev, def); });
    });
  }
  function placeButton(id) {
    var el = btnEls[id];
    if (!layout[id]) layout[id] = Object.assign({}, CUSTOM_DEFAULT);
    var l = layout[id];
    el.style.left = l.x + '%';
    el.style.top = l.y + '%';
    el.style.width = l.size + 'px';
    el.style.height = l.size + 'px';
    el.classList.toggle('selected', editing && selectedBtn === id);
  }
  function placeAllButtons() {
    BUTTON_DEFS.forEach(function (d) { placeButton(d.id); });
  }

  var editDrag = null; // {id, dx, dy} offsets while repositioning
  function onBtnDown(ev, def) {
    ev.preventDefault();
    if (editing) {
      selectedBtn = def.id;
      var r = btnEls[def.id].getBoundingClientRect();
      editDrag = { id: def.id, dx: ev.clientX - (r.left + r.width / 2),
        dy: ev.clientY - (r.top + r.height / 2), pointerId: ev.pointerId };
      try { btnEls[def.id].setPointerCapture(ev.pointerId); } catch (e) {}
      placeAllButtons();
      syncSizeSlider();
      return;
    }
    try { btnEls[def.id].setPointerCapture(ev.pointerId); } catch (e) {}
    if (def.kind === 'toggle') {
      sprint = !sprint;
      btnEls[def.id].classList.toggle('latched', sprint);
    } else {
      heldPadButtons[def.pad] = (heldPadButtons[def.pad] || 0) + 1;
      btnEls[def.id].classList.add('pressed');
    }
  }
  function onBtnUp(ev, def) {
    if (editing) {
      if (editDrag && editDrag.pointerId === ev.pointerId) {
        editDrag = null;
        saveLayout();
      }
      return;
    }
    if (def.kind === 'pad') {
      heldPadButtons[def.pad] = Math.max(0, (heldPadButtons[def.pad] || 0) - 1);
      if (!heldPadButtons[def.pad]) btnEls[def.id].classList.remove('pressed');
    }
  }
  document.addEventListener('pointermove', function (ev) {
    if (editing && editDrag && ev.pointerId === editDrag.pointerId) {
      layout[editDrag.id].x = ((ev.clientX - editDrag.dx) / window.innerWidth) * 100;
      layout[editDrag.id].y = ((ev.clientY - editDrag.dy) / window.innerHeight) * 100;
      placeButton(editDrag.id);
    }
  });

  // ---------- floating stick (left half) ----------
  var stickZone = $('stick-zone');
  var stickBase = $('stick-base');
  var stickKnob = $('stick-knob');
  stickZone.addEventListener('pointerdown', function (ev) {
    if (editing || stick.pointerId !== null) return;
    ev.preventDefault();
    stick.pointerId = ev.pointerId;
    stick.ox = ev.clientX;
    stick.oy = ev.clientY;
    stick.x = 0; stick.y = 0;
    stickBase.hidden = false;
    stickBase.style.left = ev.clientX + 'px';
    stickBase.style.top = ev.clientY + 'px';
    stickKnob.style.transform = 'translate(-50%,-50%)';
    try { stickZone.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  function applyStickSize() {
    var r = settings.stickSize;
    stickBase.style.width = (r * 2) + 'px';
    stickBase.style.height = (r * 2) + 'px';
    var knob = Math.round(r * 0.87);
    stickKnob.style.width = knob + 'px';
    stickKnob.style.height = knob + 'px';
  }
  function stickMove(ev) {
    if (ev.pointerId !== stick.pointerId) return;
    var v = C.stickVector(ev.clientX - stick.ox, ev.clientY - stick.oy,
      settings.stickSize, STICK_DEADZONE);
    if (sprint) v = C.applySprint(v);
    stick.x = v.x; stick.y = v.y;
    // Knob shows raw drag direction, clamped to the base radius.
    var mag = Math.hypot(ev.clientX - stick.ox, ev.clientY - stick.oy);
    var k = mag > settings.stickSize ? settings.stickSize / mag : 1;
    stickKnob.style.transform = 'translate(calc(-50% + ' +
      ((ev.clientX - stick.ox) * k).toFixed(1) + 'px), calc(-50% + ' +
      ((ev.clientY - stick.oy) * k).toFixed(1) + 'px))';
  }
  function stickEnd(ev) {
    if (ev.pointerId !== stick.pointerId) return;
    stick.pointerId = null;
    stick.x = 0; stick.y = 0;
    stickBase.hidden = true;
  }
  stickZone.addEventListener('pointermove', stickMove);
  stickZone.addEventListener('pointerup', stickEnd);
  stickZone.addEventListener('pointercancel', stickEnd);

  // ---------- look pad (right half, relative drag) ----------
  var lookZone = $('look-zone');
  lookZone.addEventListener('pointerdown', function (ev) {
    if (editing || look.pointerId !== null) return;
    ev.preventDefault();
    look.pointerId = ev.pointerId;
    look.ox = ev.clientX;
    look.oy = ev.clientY;
    look.x = 0; look.y = 0;
    try { lookZone.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  function lookMove(ev) {
    if (ev.pointerId !== look.pointerId) return;
    var v = C.lookVector(ev.clientX - look.ox, ev.clientY - look.oy,
      LOOK_RADIUS, settings.sensitivity);
    look.x = v.x; look.y = v.y;
  }
  function lookEnd(ev) {
    if (ev.pointerId !== look.pointerId) return;
    look.pointerId = null;
    look.x = 0; look.y = 0;
    // Swallow the release: baseline jumps to neutral (catching up to the
    // newest send so a late ack can't resurrect a stale baseline).
    lookBase = { x: 0, y: 0, seq: lookSeq };
  }
  lookZone.addEventListener('pointermove', lookMove);
  lookZone.addEventListener('pointerup', lookEnd);
  lookZone.addEventListener('pointercancel', lookEnd);

  // ---------- network ----------
  function api(path, opts) {
    return fetch(serverUrl + path, opts).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }
  function currentState() {
    var buttons = Object.keys(heldPadButtons).filter(function (b) {
      return heldPadButtons[b] > 0;
    });
    var d = C.lookDelta(look, lookBase);
    return C.quantizeState({ buttons: buttons, lx: stick.x, ly: stick.y,
      rx: look.x, ry: look.y, lt: 0, rt: 0, dx: d.dx, dy: d.dy });
  }
  function setLink(ok) {
    $('conn-dot').className = ok ? 'ok' : 'bad';
  }
  function sendInput() {
    if (!deviceId) return;
    var s = currentState();
    if (lastSent && C.statesEqual(s, lastSent)) return;
    lastSent = s;
    var atSend = { x: look.x, y: look.y, seq: ++lookSeq };
    // Wire format keeps server names: dx/dy ride as look_dx/look_dy.
    var wire = Object.assign({ device_id: deviceId }, s,
      { look_dx: s.dx, look_dy: s.dy });
    delete wire.dx;
    delete wire.dy;
    api('/api/input', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wire) })
      .then(function () {
        netFails = 0;
        setLink(true);
        if (atSend.seq > lookBase.seq) lookBase = atSend;
      })
      .catch(function (err) {
        if (is404(err)) { scheduleReconnect(); return; }
        netFails++;
        lastSent = null; // force retry next tick
        if (netFails >= 3) {
          setLink(false);
          $('conn-text').textContent = 'link lost — check server';
        }
      });
  }
  function heartbeat() {
    if (!deviceId) return;
    api('/api/heartbeat', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }) }).catch(function (err) {
      if (is404(err)) scheduleReconnect();
    });
  }
  function is404(err) {
    return !!err && typeof err.message === 'string' && err.message.indexOf('404') >= 0;
  }
  // Our registration is gone server-side (expiry/restart): re-register with
  // the stored id so the server resumes it when it still can. Single-flight;
  // a quit in between cancels via the generation guard.
  function scheduleReconnect() {
    if (!deviceId || !serverUrl || reconnecting) return;
    reconnecting = true;
    var gen = sessionGen;
    $('conn-text').textContent = 'reconnecting…';
    var body = { device_name: settings.deviceName || 'Phone' };
    if (settings.deviceId) body.device_id = settings.deviceId;
    fetch(serverUrl + '/api/register', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (dev) {
        reconnecting = false;
        if (gen !== sessionGen) return; // quit while we were away
        deviceId = dev.device_id;
        settings.deviceId = dev.device_id;
        saveSettings();
        lastSent = null;
        netFails = 0;
        setLink(true);
        $('conn-text').textContent = (settings.deviceName || 'Phone') +
          ' · slot ' + (dev.controller_index + 1);
      })
      .catch(function () {
        reconnecting = false; // next 404 retries
      });
  }

  // ---------- connect / disconnect ----------
  function defaultServerUrl() {
    // Same-origin when served over http (joymb-server /app/ or a proxied
    // subpath like /joymob/), so no typing needed. Empty otherwise: the
    // user enters the server address by hand.
    if (window.location.protocol.indexOf('http') === 0) {
      return C.apiBase(window.location.origin, window.location.pathname);
    }
    return '';
  }
  $('server-url').value = settings.serverUrl || defaultServerUrl();
  $('device-name').value = settings.deviceName || '';
  $('sens-slider').value = settings.sensitivity;
  $('sens-val').textContent = Number(settings.sensitivity).toFixed(1);
  $('stick-slider').value = settings.stickSize;
  $('stick-val').textContent = settings.stickSize;

  $('connect-btn').addEventListener('click', function () {
    var url = $('server-url').value.replace(/\/+$/, '');
    var name = $('device-name').value.trim() || 'Phone';
    if (!url) return;
    settings.serverUrl = url;
    settings.deviceName = name;
    saveSettings();
    $('connect-btn').disabled = true;
    $('connect-status').textContent = 'Connecting…';
    serverUrl = url;
    var regBody = { device_name: name };
    if (settings.deviceId) regBody.device_id = settings.deviceId; // resume?
    fetch(url + '/api/register', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regBody) })
      .then(function (res) {
        if (!res.ok) throw new Error(res.status === 409 ? 'server full (4 max)' : 'HTTP ' + res.status);
        return res.json();
      })
      .then(function (dev) {
        deviceId = dev.device_id;
        settings.deviceId = dev.device_id;
        saveSettings();
        lastSent = null;
        netFails = 0;
        $('connect-screen').hidden = true;
        $('hud').hidden = false;
        $('conn-text').textContent = name + ' · slot ' + (dev.controller_index + 1);
        setLink(true);
        sendTimer = setInterval(sendInput, SEND_MS);
        heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
      })
      .catch(function (err) {
        $('connect-status').textContent = 'Failed: ' + err.message;
        $('connect-btn').disabled = false;
      });
  });

  // full=true on explicit quit (forget the stored id too); pagehide keeps
  // it so a reload can resume when the farewell DELETE never landed.
  function disconnect(full) {
    sessionGen++;
    reconnecting = false;
    if (deviceId && serverUrl) {
      fetch(serverUrl + '/api/devices/' + deviceId,
        { method: 'DELETE', keepalive: true }).catch(function () {});
    }
    if (full) {
      settings.deviceId = '';
      saveSettings();
    }
    deviceId = null;
    sprint = false;
    heldPadButtons = {};
    stick.pointerId = look.pointerId = null;
    stick.x = stick.y = look.x = look.y = 0;
    lookBase = { x: 0, y: 0, seq: lookSeq };
    stickBase.hidden = true;
    Object.keys(btnEls).forEach(function (id) {
      btnEls[id].classList.remove('pressed', 'latched');
    });
    clearInterval(sendTimer);
    clearInterval(heartbeatTimer);
    $('hud').hidden = true;
    $('connect-screen').hidden = false;
    $('connect-btn').disabled = false;
    $('connect-status').textContent = '';
  }
  $('quit-btn').addEventListener('click', function () { disconnect(true); });
  window.addEventListener('pagehide', function () { disconnect(false); });

  // ---------- fullscreen ----------
  // Not offered where unsupported (e.g. iPhone Safari has no element
  // fullscreen); the button simply stays hidden there.
  var fsBtn = $('fs-btn');
  var canFs = !!(document.documentElement.requestFullscreen ||
    document.documentElement.webkitRequestFullscreen);
  if (!canFs) fsBtn.hidden = true;
  function fsIcon() {
    var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    $('fs-expand').hidden = on;
    $('fs-compress').hidden = !on;
  }
  fsBtn.addEventListener('click', function () {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else {
      var el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  });
  document.addEventListener('fullscreenchange', fsIcon);
  document.addEventListener('webkitfullscreenchange', fsIcon);

  // ---------- settings ----------
  function syncSizeSlider() {
    if (!layout[selectedBtn]) selectedBtn = 'jump';
    $('size-slider').value = layout[selectedBtn].size;
    $('size-val').textContent = layout[selectedBtn].size;
    var isCustom = customButtons.some(function (b) { return b.id === selectedBtn; });
    $('delete-btn').classList.toggle('danger', isCustom);
  }
  function setEditing(on) {
    editing = on;
    editDrag = null;
    $('hud').classList.toggle('editing', on);
    if (on) { stick.pointerId = look.pointerId = null; syncSizeSlider(); }
    placeAllButtons();
  }
  function showView(name) {
    // name: 'menu' | 'sens' | 'hud'. The HUD view is the layout editor.
    $('settings-menu').hidden = name !== 'menu';
    $('sens-view').hidden = name !== 'sens';
    $('hud-view').hidden = name !== 'hud';
    setEditing(name === 'hud');
  }
  function setSettings(open) {
    $('settings-panel').hidden = !open;
    if (open) showView('menu');
    else setEditing(false);
  }
  $('settings-btn').addEventListener('click', function () {
    setSettings($('settings-panel').hidden);
  });
  $('settings-close-btn').addEventListener('click', function () { setSettings(false); });
  $('menu-sens-btn').addEventListener('click', function () { showView('sens'); });
  $('menu-hud-btn').addEventListener('click', function () { showView('hud'); });
  $('sens-back-btn').addEventListener('click', function () { showView('menu'); });
  $('sens-done-btn').addEventListener('click', function () { setSettings(false); });
  $('hud-back-btn').addEventListener('click', function () { showView('menu'); });
  $('hud-done-btn').addEventListener('click', function () { setSettings(false); });

  $('sens-slider').addEventListener('input', function (ev) {
    settings.sensitivity = parseFloat(ev.target.value);
    $('sens-val').textContent = settings.sensitivity.toFixed(1);
    saveSettings();
  });
  $('stick-slider').addEventListener('input', function (ev) {
    settings.stickSize = parseInt(ev.target.value, 10);
    $('stick-val').textContent = settings.stickSize;
    applyStickSize();
    saveSettings();
  });
  $('size-slider').addEventListener('input', function (ev) {
    if (!layout[selectedBtn]) selectedBtn = 'jump';
    layout[selectedBtn].size = parseInt(ev.target.value, 10);
    $('size-val').textContent = layout[selectedBtn].size;
    placeButton(selectedBtn);
    saveLayout();
  });

  // ---------- custom buttons ----------
  PAD_ACTIONS.forEach(function (a) {
    var opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    $('new-action').appendChild(opt);
  });
  $('add-btn').addEventListener('click', function () {
    var label = $('new-label').value.trim().toUpperCase().slice(0, 6);
    var pad = $('new-action').value;
    if (!label || PAD_ACTIONS.indexOf(pad) < 0) return;
    if (BUTTON_DEFS.length >= MAX_BUTTONS) return;
    var id = 'c' + Date.now().toString(36);
    customButtons.push({ id: id, label: label, pad: pad });
    BUTTON_DEFS.push({ id: id, label: label, kind: 'pad', pad: pad });
    layout[id] = Object.assign({}, CUSTOM_DEFAULT);
    saveCustom();
    saveLayout();
    selectedBtn = id;
    $('new-label').value = '';
    buildButtons();
    syncSizeSlider();
  });
  $('delete-btn').addEventListener('click', function () {
    var idx = -1;
    customButtons.forEach(function (b, i) { if (b.id === selectedBtn) idx = i; });
    if (idx < 0) return; // built-ins can't be deleted
    customButtons.splice(idx, 1);
    saveCustom();
    BUTTON_DEFS = BUTTON_DEFS.filter(function (d) { return d.id !== selectedBtn; });
    delete layout[selectedBtn];
    saveLayout();
    selectedBtn = 'jump';
    buildButtons();
    syncSizeSlider();
  });
  $('reset-layout-btn').addEventListener('click', function () {
    customButtons = [];
    saveCustom();
    BUTTON_DEFS = BUILTIN_DEFS.slice();
    layout = {};
    BUTTON_DEFS.forEach(function (d) {
      layout[d.id] = Object.assign({}, DEFAULT_LAYOUT[d.id]);
    });
    saveLayout();
    selectedBtn = 'jump';
    buildButtons();
    syncSizeSlider();
  });

  // ---------- global guards ----------
  document.addEventListener('touchmove', function (ev) { ev.preventDefault(); },
    { passive: false });
  document.addEventListener('gesturestart', function (ev) { ev.preventDefault(); });
  document.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  document.addEventListener('dblclick', function (ev) { ev.preventDefault(); });

  buildButtons();
  applyStickSize();
})();
