// Regression test: the `hidden` attribute must actually hide elements.
// Author styles (e.g. `#connect-screen { display: flex }`) beat the UA
// `[hidden]` rule, so app.css must carry a global guard. No deps.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const gameCss = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'ball', 'style.css'), 'utf8');

test('project CSS guards the hidden attribute globally', () => {
  for (const [name, text] of [['app.css', css], ['game/ball/style.css', gameCss]]) {
    assert.match(text, /\[hidden\]\s*\{[^}]*display\s*:\s*none[^}]*!important[^}]*\}/, name);
  }
});

test('settings panel has a fixed narrow width', () => {
  // Shrink-to-fit content once ballooned the panel over gameplay buttons and
  // swallowed their taps; a fixed cap keeps the play area reachable.
  const rule = css.match(/#settings-panel\s*\{[^}]*\}/);
  assert.ok(rule, 'expected a #settings-panel rule');
  // Plain `width:` only (?<![-\w] skips min-/max-width).
  const m = rule[0].match(/(?<![-\w])width\s*:\s*(\d+)px/);
  assert.ok(m, 'expected #settings-panel { width: Npx }');
  assert.ok(parseInt(m[1], 10) <= 320, 'panel wider than 320px: ' + m[1]);
});

test('every .hidden toggle target exists in index.html', () => {
  const ids = new Set();
  for (const m of js.matchAll(/\$\('([a-z-]+)'\)\.hidden/g)) ids.add(m[1]);
  assert.ok(ids.size > 0, 'expected at least one .hidden toggle in app.js');
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `id="${id}" missing from index.html`);
  }
});
