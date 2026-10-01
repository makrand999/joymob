#pragma once

// JSON <-> PadState conversion for POST /api/input.
//
// Request body:
//   {"device_id": "...", "buttons": ["a", "rb"], "lx": 0.5, "ly": -1.0,
//    "rx": 0.0, "ry": 0.0, "lt": 0.0, "rt": 1.0, "look_dx": 0.1, "look_dy": 0}
// All fields except device_id are optional and default to neutral. Sticks are
// floats in [-1, 1] (+1 = up/right); triggers are floats in [0, 1];
// look_dx/look_dy are mouse-style look deltas in deflection units (any float,
// clamped server-side).
// Button names: dpad_up, dpad_down, dpad_left, dpad_right, start, back,
// l3, r3, lb, rb, guide, a, b, x, y.

#include <string>

#include <nlohmann/json.hpp>

#include "virtual_pad.h"

// Parses the input body (device_id already extracted by the caller).
// Returns true on success; on failure returns false and sets error.
bool ParsePadState(const nlohmann::json& body, PadState* out, std::string* error);

// Serializes a PadState back to JSON floats/names for the status echo.
nlohmann::json PadStateToJson(const PadState& state);
