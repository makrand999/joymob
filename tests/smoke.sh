#!/bin/bash
# joymb-server endpoint smoke test (committed, runs anywhere the binary builds).
# Usage: tests/smoke.sh <path-to-joymb-server> [port] [webdir]
set -u
BIN="${1:?usage: smoke.sh <joymb-server-binary> [port] [webdir]}"
PORT="${2:-18081}"
WEBDIR="${3:-}"
BASE="localhost:$PORT"
FAIL=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAIL=1; }

if [ -n "$WEBDIR" ]; then
  "$BIN" "$PORT" "$WEBDIR" >/tmp/joymb_smoke_test.log 2>&1 &
else
  "$BIN" "$PORT" >/tmp/joymb_smoke_test.log 2>&1 &
fi
SRV=$!
trap "kill $SRV 2>/dev/null" EXIT
sleep 1.5

# 1. Register two phones with the same name -> distinct ids, slots, profiles.
A=$(curl -s -X POST "$BASE/api/register" -H 'Content-Type: application/json' -d '{"device_name":"Pixel 8"}')
B=$(curl -s -X POST "$BASE/api/register" -H 'Content-Type: application/json' -d '{"device_name":"Pixel 8"}')
IDA=$(echo "$A" | python3 -c "import sys,json;print(json.load(sys.stdin)['device_id'])")
IDB=$(echo "$B" | python3 -c "import sys,json;print(json.load(sys.stdin)['device_id'])")
SLOTA=$(echo "$A" | python3 -c "import sys,json;print(json.load(sys.stdin)['controller_index'])")
SLOTB=$(echo "$B" | python3 -c "import sys,json;print(json.load(sys.stdin)['controller_index'])")
[ "$IDA" != "$IDB" ] && [ "$SLOTA" != "$SLOTB" ] \
  && pass "register distinguishes devices ($SLOTA vs $SLOTB)" \
  || fail "register did not distinguish devices: $A / $B"

# 2. Input: full-state post succeeds and is echoed back on status.
CODE=$(curl -s -o /tmp/joymb_input.json -w '%{http_code}' -X POST "$BASE/api/input" \
  -H 'Content-Type: application/json' \
  -d "{\"device_id\":\"$IDA\",\"buttons\":[\"a\",\"rb\"],\"lx\":0.5,\"ly\":-1.0,\"rx\":0.0,\"ry\":0.0,\"lt\":0.0,\"rt\":1.0,\"look_dx\":0.25,\"look_dy\":-0.1}")
[ "$CODE" = "200" ] && pass "POST /api/input -> 200" || fail "POST /api/input -> $CODE: $(cat /tmp/joymb_input.json)"
ECHO=$(curl -s "$BASE/api/devices" | python3 -c "
import sys,json
devs={d['device_id']:d for d in json.load(sys.stdin)['devices']}
d=devs.get('$IDA',{})
li=d.get('last_input') or {}
ok = (set(li.get('buttons',[]))=={'a','rb'} and abs(li.get('lx',9)-0.5)<0.001
      and li.get('ly')==-1.0 and li.get('rt')==1.0
      and abs(li.get('look_dx',9)-0.25)<0.001 and abs(li.get('look_dy',9)+0.1)<0.001)
print('ECHO_OK' if ok else 'ECHO_BAD:'+json.dumps(d))")
[ "$ECHO" = "ECHO_OK" ] && pass "status echoes last input" || fail "input echo wrong: $ECHO"
SEQ1=$(curl -s "$BASE/api/devices" | python3 -c "import sys,json;print([d for d in json.load(sys.stdin)['devices'] if d['device_id']=='$IDA'][0]['input_seq'])")
curl -s -X POST "$BASE/api/input" -H 'Content-Type: application/json' -d "{\"device_id\":\"$IDA\"}" >/dev/null
SEQ2=$(curl -s "$BASE/api/devices" | python3 -c "import sys,json;print([d for d in json.load(sys.stdin)['devices'] if d['device_id']=='$IDA'][0]['input_seq'])")
[ "$SEQ2" = "$((SEQ1 + 1))" ] && pass "input_seq bumps per post ($SEQ1->$SEQ2)" || fail "input_seq stuck: $SEQ1->$SEQ2"

# 3. Input rejects unknown device and unknown button.
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/input" \
  -H 'Content-Type: application/json' -d '{"device_id":"nope","buttons":[]}')
[ "$CODE" = "404" ] && pass "input on unknown device -> 404" || fail "input on unknown device -> $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/input" \
  -H 'Content-Type: application/json' -d "{\"device_id\":\"$IDA\",\"buttons\":[\"bogus\"]}")
[ "$CODE" = "400" ] && pass "input with bad button -> 400" || fail "input with bad button -> $CODE"

# 4. Heartbeat + unregister still work.
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/heartbeat" \
  -H 'Content-Type: application/json' -d "{\"device_id\":\"$IDA\"}")
[ "$CODE" = "200" ] && pass "heartbeat -> 200" || fail "heartbeat -> $CODE"
curl -s -X DELETE "$BASE/api/devices/$IDA" >/dev/null
curl -s -X DELETE "$BASE/api/devices/$IDB" >/dev/null
N=$(curl -s "$BASE/api/devices" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['devices']))")
[ "$N" = "0" ] && pass "unregister empties registry" || fail "registry not empty: $N"

# 5. Reconnect resumes the same registration instead of duplicating it.
IDX=$(curl -s -X POST "$BASE/api/register" -H 'Content-Type: application/json' \
  -d '{"device_name":"Returner"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['device_id'])")
R=$(curl -s -X POST "$BASE/api/register" -H 'Content-Type: application/json' \
  -d '{"device_name":"Returner","device_id":"'"$IDX"'"}')
RID=$(echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['device_id'])")
RESUMED=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['resumed'])")
N=$(curl -s "$BASE/api/devices" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['devices']))")
[ "$RID" = "$IDX" ] && [ "$RESUMED" = "True" ] && [ "$N" = "1" ] \
  && pass "reconnect resumes same id+slot (resumed=true, count=$N)" \
  || fail "reconnect duplicated: rid=$RID resumed=$RESUMED count=$N"
curl -s -X DELETE "$BASE/api/devices/$IDX" >/dev/null
FRESH=$(curl -s -X POST "$BASE/api/register" -H 'Content-Type: application/json' \
  -d '{"device_name":"Newcomer","device_id":"no-such-id"}')
FID=$(echo "$FRESH" | python3 -c "import sys,json;print(json.load(sys.stdin)['device_id'])")
FRES=$(echo "$FRESH" | python3 -c "import sys,json;print(json.load(sys.stdin)['resumed'])")
curl -s -X DELETE "$BASE/api/devices/$FID" >/dev/null
[ "$FID" != "no-such-id" ] && [ "$FRES" = "False" ] \
  && pass "unknown resume id falls through to fresh" \
  || fail "unknown resume id mishandled: $FRESH"

# 6. Expiry drops silent devices (separate instance, 1s TTL).
EPORT=$((PORT + 10))
JOYMB_EXPIRE_SECONDS=1 "$BIN" "$EPORT" >/tmp/joymb_expire_test.log 2>&1 &
EXSRV=$!
sleep 1.5
curl -s -X POST "localhost:$EPORT/api/register" -H 'Content-Type: application/json' -d '{"device_name":"Ghost"}' >/dev/null
sleep 1.3
EN=$(curl -s "localhost:$EPORT/api/devices" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['devices']))")
[ "$EN" = "0" ] && pass "silent device expired" || fail "expiry failed: count=$EN"
kill $EXSRV 2>/dev/null

# 7. Mobile web app is served when a webdir is given.
if [ -n "$WEBDIR" ]; then
  APP=$(curl -s -o /tmp/joymb_app.html -w '%{http_code}' "$BASE/app/")
  if [ "$APP" = "200" ] && grep -q "joymb controller" /tmp/joymb_app.html \
     && curl -sf "$BASE/app/app.js" | grep -q "JoymbControls"; then
    pass "mobile app served at /app/"
  else
    fail "mobile app not served at /app/ (HTTP $APP)"
  fi
  CORS=$(curl -s -o /dev/null -D - "$BASE/api/devices" | grep -ci "access-control-allow-origin")
  [ "$CORS" -ge 1 ] && pass "CORS header present" || fail "CORS header missing"
fi

kill $SRV 2>/dev/null
[ "$FAIL" = "0" ] && echo "SMOKE PASS" || echo "SMOKE FAIL"
exit "$FAIL"
