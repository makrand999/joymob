# JoyMob — play PC games with your phone, PUBG-style

## Purpose

Phone-as-controller apps exist, but they all mimic an Xbox pad on a
touchscreen: twin sticks, tiny buttons — awkward, and worst for FPS games.
JoyMob instead puts a **PUBG / Free Fire-style mobile FPS HUD** on the phone
(floating left-half movement stick, right-half mouse-like look, big
jump/crouch/run buttons) and emulates **real Xbox 360 controllers on the PC**,
so any XInput game just works — no per-game setup.

- **Each phone gets its own pad.** Up to 4 phones register over HTTP; the
  server gives every one a distinct slot, profile (name/pad/color), and
  ViGEmBus X360 target, so games see separate controllers.
- **No controller mimicry on the phone.** The HUD is touch-first: touch
  anywhere on the left half and a stick blooms under your finger; drag the
  right half and the camera moves exactly as far and as fast as your finger,
  like a mouse — never stick-hold drift.
- **Fully customizable HUD** (buttons, sizes, positions, sensitivities) from
  the on-phone Settings menu, saved on the phone.
- **No app install.** The controller is a plain web page; the PC side is one
  small C++ server with a console log and a status endpoint — no GUI.

## How it works

```text
phone browser (web/) --HTTP--> joymb-server (src/) --ViGEmBus--> game sees XInput pads
```

| Part | Location | What it is |
|---|---|---|
| `joymb-server` | `src/`, `CMakeLists.txt` | C++17 server: device registry, input forwarding, per-device virtual pad (ViGEm X360 on Windows, null stub elsewhere) |
| Mobile HUD | `web/` | Plain HTML/CSS/JS, zero build step, served from disk (see below) |
| Ball test rig | `game/ball/` | Minimal Three.js page: roll a ball with stick + look + jump, no game logic |

## How to use it

### Playing on a PC (Windows)

1. Install the [ViGEmBus driver](https://github.com/nefarius/ViGEmBus/releases)
   once (admin — it creates the virtual controller bus).
2. Build and run the server (details below), e.g.
   `.\build\Release\joymb-server.exe 8080`.
3. On each phone (same WiFi as the PC), open
   `http://<PC-LAN-IP>:8080/app/` — find the IP with `ipconfig`
   (`IPv4 Address`), e.g. `http://192.168.1.20:8080/app/`.
4. Enter a name, tap Connect, and play. Up to 4 phones at once.
5. If a phone drops (sleep, network blip), just reopen the page and tap
   Connect again — the server resumes the same slot/profile instead of
   adding a duplicate.

### Driving the HUD

- **Left half:** floating stick — touch anywhere and drag. Partial push
  walks, full push runs; the RUN button pins sprint on/off.
- **Right half:** drag to look/aim. The camera follows your finger 1:1 like
  a mouse: move far/fast and it turns far/fast, stop and it stops.
- **Buttons:** JUMP (A), CROUCH (B, hold), RUN (sprint toggle) to start.
- **Settings (sliders icon):** a menu with two sections —
  - *Sensitivity:* look sensitivity + joystick size (bigger stick = longer
    drag for full deflection).
  - *Custom HUD:* drag buttons to rearrange, tap one to resize it, add new
    buttons (short label + any gamepad action: a/b/x/y, lb/rb, l3/r3,
    start/back, d-pad, guide), delete custom ones, or reset to defaults.
  Everything is saved on the phone (localStorage) and survives reloads.
- **Fullscreen** toggle in the top bar (hidden where the browser has none).

### Changing the phone UI — no recompile needed

The mobile app is **not** built into the server binary. The server just
serves the `web/` folder from disk on every request, so:

1. Edit `web/index.html`, `web/app.css`, or `web/app.js` with any editor.
2. Refresh the phone's browser. Done — no rebuild, not even a server
   restart.

Two notes:

- **Cache-buster:** phones cache CSS/JS aggressively, so after editing,
  bump the `?v=N` query strings on the `<link>`/`<script>` tags in
  `web/index.html` (marked with a comment). Editors + `?v=` bump is the
  whole "release process" for UI changes.
- **Keep `web/` next to the server.** It resolves as `./web` or from the
  `webdir` argument (`joymb-server <port> [webdir] [bind]`). On Windows,
  ship the folder beside the `.exe` — without it the server still runs,
  but `/app/` is disabled (it logs whether the folder was found).

The server also sends `Access-Control-Allow-Origin: *`, so the `web/` files
can be hosted anywhere (nginx, GitHub Pages, …) and still talk to the PC.

### Linux test deployment (this host)

Windows-only code is behind `#ifdef _WIN32`, so the server also builds on
Linux with stub pads — used here to develop the HUD and verify the protocol
end to end:

- Phone HUD: `https://csd.mitasia.in/joymob/` (nginx aliases `web/`;
  `/joymob/api/` proxies to a loopback `joymb-server` on port 18090).
- Ball rig: `https://csd.mitasia.in/game/ball/` (nginx aliases
  `game/ball/`). Open it on one device, drive from a phone at `/joymob/`:
  left stick rolls the ball, right-half look orbits the camera, JUMP hops.
  The overlay names the driving device (lowest slot) and shows its live
  input.

Restarting the loopback server after a reboot:

```sh
setsid -f /root/joymb/build/joymb-server 18090 /root/joymb/web 127.0.0.1 \
  </dev/null >>/tmp/joymb-server.log 2>&1
```

## Build (Windows, MSVC)

Prerequisites: Visual Studio 2022 (MSVC), CMake 3.16+, git, and the
[ViGEmBus driver](https://github.com/nefarius/ViGEmBus/releases) installed.

```bat
cd joymb
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
.\build\Release\joymb-server.exe 8080
```

Dependencies (cpp-httplib, nlohmann/json, ViGEmClient) are fetched
automatically via CMake FetchContent on first configure (network needed
once; re-configures work offline after that).

To build without ViGEm (stub pads, e.g. for HUD development on a machine
without the driver):

```bat
cmake -S . -B build -DJOYMB_WITH_VIGEM=OFF
```

## Build the Windows .exe from Linux (MinGW cross-compile)

No Windows machine needed — and no Wine for *building* (Wine only runs
Windows programs; the compiler here is MinGW-w64, which emits a real
Windows `.exe` directly). The ViGEm code path is included, so this replaces
the MSVC build above for releases:

```sh
apt install g++-mingw-w64-x86-64   # Debian/Ubuntu (needs posix-thread variant, the default)
cmake -S . -B build-win --toolchain cmake/mingw-w64-x86_64.cmake \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build-win --config Release
# -> build-win/joymb-server.exe
```

The exe is self-contained (libgcc/libstdc++ statically linked; only stock
system DLLs — KERNEL32, msvcrt, SETUPAPI, WS2_32 — are imported). Two
MinGW-only accommodations live in-repo: `cmake/mingw-compat/` header shims
(ViGEmClient spells them `<Windows.h>`/`<SetupAPI.h>`, unresolvable on
case-sensitive filesystems) and the toolchain file; MSVC builds never see
them.

To smoke-test the exe on Linux, run it under Wine (HTTP + registry work;
pads report inactive since there is no ViGEmBus driver — same as a
driverless Windows box):

```sh
wine build-win/joymb-server.exe 8080 ./web 127.0.0.1
curl -X POST 127.0.0.1:8080/api/register \
  -H "Content-Type: application/json" -d '{"device_name":"wine-test"}'
```

## Build (Linux, for logic/endpoint dev)

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/joymb-server 8080
```

## Tests

```sh
ctest --test-dir build --output-on-failure
```

Runs `tests/smoke.sh` (register/heartbeat/input/unregister incl. error
cases, plus `/app/` serving + CORS) and the `web/tests/controls.test.js`
unit tests (stick deadzone/clamp, sprint, look math) via `node --test`.

## Endpoints

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/register` | `{"device_name": "Pixel 8"}` | Register device; returns `device_id`, `controller_index` (0..3), `profile`, `pad` |
| POST | `/api/heartbeat` | `{"device_id": "<uuid>"}` | Keep-alive; 404 if unknown |
| POST | `/api/input` | `{"device_id": "<uuid>", "buttons": ["a","rb"], "lx": 0.5, ...}` | Forward input to the device's pad |
| GET | `/api/devices` | — | Status: list all registered devices |
| DELETE | `/api/devices/{id}` | — | Unregister; destroys the virtual pad, frees the slot |

Input body: all fields except `device_id` optional, default neutral. Sticks
`lx/ly/rx/ry` are floats in [-1, 1] (+1 = up/right); triggers `lt/rt` floats
in [0, 1]. Buttons: `dpad_up`, `dpad_down`, `dpad_left`, `dpad_right`,
`start`, `back`, `l3`, `r3`, `lb`, `rb`, `guide`, `a`, `b`, `x`, `y`.
Unknown button -> 400; unknown device -> 404; inactive pad -> 503.

Reconnects: `POST /api/register` accepts an optional `device_id`. When it
matches a live registration the server resumes it (same id/slot/profile,
`"resumed": true`) instead of duplicating; unknown ids fall through to
fresh. Registrations silent for 30s (`JOYMB_EXPIRE_SECONDS` overrides) are
dropped automatically. The app stores its id, offers it on every connect,
forgets it on explicit quit (reloads keep it), and silently re-registers if
a heartbeat or input ever 404s.

Mouse-style look: the app also sends per-update `look_dx`/`look_dy` deltas
(finger travel since the last delivered sample, in deflection units), echoed
back in `last_input`. Each device carries a monotonic `input_seq`, bumped
per accepted input, so delta consumers apply every state exactly once. The
XUSB report has no delta channel, so ViGEm ignores these fields (real XInput
look stays velocity-based); they drive the ball rig today and a
mouse-injection backend later.

Examples:

```sh
# Register two phones; each gets its own slot + profile + pad.
curl -s -X POST localhost:8080/api/register \
  -H "Content-Type: application/json" -d "{\"device_name\":\"Pixel 8\"}"
# -> {"controller_index":0,"device_id":"<uuid>","device_name":"Pixel 8",
#     "profile":{"color":"#0064FF","name":"Pixel 8 #1","pad_type":"x360"},
#     "pad":{"backend":"vigem-x360","active":true,"user_index":0}, ...}

# Push input (fire = RT + A in this example mapping).
curl -s -X POST localhost:8080/api/input -H "Content-Type: application/json" \
  -d "{\"device_id\":\"<uuid>\",\"buttons\":[\"a\"],\"rt\":1.0}"

# Status (includes per-device pad state + last_input echo) / unregister.
curl -s localhost:8080/api/devices
curl -s -X DELETE localhost:8080/api/devices/<uuid>
```

Notes:

- Max 4 controllers; a 5th registration gets `409 {"error": ...}`.
- Connects/disconnects are logged to the console; `GET /api/devices` is the
  status view (no GUI framework).
- A device whose pad failed to create (no driver) stays registered with
  `"active": false` and input returns 503; the console logs a hint.

## Roadmap — future scope (contributors welcome!)

**Headline idea: stream the game screen to the phones.** Today each phone
is a controller; tomorrow it can also be a personal viewer — game video
rendered behind the touch HUD, cloud-gaming style, one page, no extra app.
The design is worked out and waiting for hands:

- **Pipeline:** DXGI Desktop Duplication capture → hardware H.264 encode
  (NVENC/QuickSync/AMF) **once** → broadcast over WebSocket → browser
  `WebCodecs` hardware decode to a canvas under the HUD.
- **Why it scales:** encode cost is flat (all 4 phones share one stream);
  only bandwidth grows, and 720p30 at ~2–4 Mbps per viewer is trivial for
  a LAN. Resolution ladders (720p/480p) keep it tunable per phone.
- **Concretely up for grabs:** capture module, encoder integration
  (FFmpeg libs or MediaFoundation), WS signaling + NAL framing, the
  WebCodecs client renderer, per-phone quality selection, latency tuning.

Other directions we'd love help with: a mouse-injection backend so the
finger-look deltas drive real mouse-look in PC games (today they drive the
ball rig), per-game HUD profiles, and a GitHub Actions build for the
Windows `.exe`. Open an issue with your angle — the codebase is small and
approachable on purpose.
