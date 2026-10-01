#include "input.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <utility>

namespace {

const std::pair<const char*, uint16_t> kButtonNames[] = {
    {"dpad_up", PadButton::kDpadUp},       {"dpad_down", PadButton::kDpadDown},
    {"dpad_left", PadButton::kDpadLeft},   {"dpad_right", PadButton::kDpadRight},
    {"start", PadButton::kStart},          {"back", PadButton::kBack},
    {"l3", PadButton::kL3},                {"r3", PadButton::kR3},
    {"lb", PadButton::kLb},                {"rb", PadButton::kRb},
    {"guide", PadButton::kGuide},          {"a", PadButton::kA},
    {"b", PadButton::kB},                  {"x", PadButton::kX},
    {"y", PadButton::kY},
};

bool ButtonBit(const std::string& name, uint16_t* bit) {
  for (const auto& [n, b] : kButtonNames) {
    if (name == n) {
      *bit = b;
      return true;
    }
  }
  return false;
}

double ClampDouble(double v, double lo, double hi) {
  return std::min(hi, std::max(lo, v));
}

// Reads an optional numeric field; errors only when present-but-not-numeric.
bool OptNumber(const nlohmann::json& body, const char* key, double* out,
               std::string* error) {
  const auto it = body.find(key);
  if (it == body.end() || it->is_null()) return true;
  if (!it->is_number()) {
    *error = std::string("field '") + key + "' must be a number";
    return false;
  }
  *out = it->get<double>();
  return true;
}

int16_t StickToRaw(double v) {
  v = ClampDouble(v, -1.0, 1.0);
  if (v >= 0) return static_cast<int16_t>(std::lround(v * 32767.0));
  return static_cast<int16_t>(std::lround(v * 32768.0));
}

uint8_t TriggerToRaw(double v) {
  return static_cast<uint8_t>(std::lround(ClampDouble(v, 0.0, 1.0) * 255.0));
}

}  // namespace

bool ParsePadState(const nlohmann::json& body, PadState* out, std::string* error) {
  PadState state;
  const auto it = body.find("buttons");
  if (it != body.end() && !it->is_null()) {
    if (!it->is_array()) {
      *error = "field 'buttons' must be an array of names";
      return false;
    }
    for (const auto& name : *it) {
      if (!name.is_string()) {
        *error = "field 'buttons' must be an array of names";
        return false;
      }
      uint16_t bit = 0;
      if (!ButtonBit(name.get<std::string>(), &bit)) {
        *error = "unknown button '" + name.get<std::string>() + "'";
        return false;
      }
      state.buttons |= bit;
    }
  }
  double lx = 0, ly = 0, rx = 0, ry = 0, lt = 0, rt = 0, dx = 0, dy = 0;
  if (!OptNumber(body, "lx", &lx, error) || !OptNumber(body, "ly", &ly, error) ||
      !OptNumber(body, "rx", &rx, error) || !OptNumber(body, "ry", &ry, error) ||
      !OptNumber(body, "lt", &lt, error) || !OptNumber(body, "rt", &rt, error) ||
      !OptNumber(body, "look_dx", &dx, error) || !OptNumber(body, "look_dy", &dy, error)) {
    return false;
  }
  state.lx = StickToRaw(lx);
  state.ly = StickToRaw(ly);
  state.rx = StickToRaw(rx);
  state.ry = StickToRaw(ry);
  state.lt = TriggerToRaw(lt);
  state.rt = TriggerToRaw(rt);
  state.look_dx = static_cast<float>(ClampDouble(dx, -8.0, 8.0));
  state.look_dy = static_cast<float>(ClampDouble(dy, -8.0, 8.0));
  *out = state;
  return true;
}

nlohmann::json PadStateToJson(const PadState& state) {
  nlohmann::json buttons = nlohmann::json::array();
  for (const auto& [n, b] : kButtonNames) {
    if (state.buttons & b) buttons.push_back(n);
  }
  auto stick = [](int16_t raw) {
    return raw >= 0 ? static_cast<double>(raw) / 32767.0
                    : static_cast<double>(raw) / 32768.0;
  };
  return {
      {"buttons", buttons},
      {"lx", stick(state.lx)},
      {"ly", stick(state.ly)},
      {"rx", stick(state.rx)},
      {"ry", stick(state.ry)},
      {"lt", static_cast<double>(state.lt) / 255.0},
      {"rt", static_cast<double>(state.rt) / 255.0},
      {"look_dx", state.look_dx},
      {"look_dy", state.look_dy},
  };
}
