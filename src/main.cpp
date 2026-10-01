// joymb-server: minimal HTTP device registry + input forwarding for mobile
// controllers.
//
// Endpoints:
//   POST   /api/register        {device_name} -> {device_id, controller_index, profile}
//   POST   /api/heartbeat       {device_id}   -> {ok}
//   POST   /api/input           {device_id, buttons, lx, ly, rx, ry, lt, rt} -> {ok}
//   GET    /api/devices                            -> {devices: [...]}
//   DELETE /api/devices/{id}                       -> {ok}
// Console log reports connects/disconnects; GET /api/devices is the status UI.
//
// Each registered device owns one virtual pad (ViGEm Xbox 360 on Windows,
// null-stub elsewhere). Input posts are forwarded to that pad.

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include "device_manager.h"
#include "input.h"
#include "virtual_pad.h"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

using json = nlohmann::json;

namespace {

void Log(const std::string& msg) {
  const auto now = std::chrono::system_clock::now();
  const std::time_t t = std::chrono::system_clock::to_time_t(now);
  char buf[32];
#ifdef _WIN32
  ctime_s(buf, sizeof(buf), &t);
#else
  ctime_r(&t, buf);
#endif
  buf[24] = '\0';  // strip trailing newline from ctime
  std::cout << "[" << buf << "] " << msg << std::endl;
}

json DeviceToJson(const Device& dev) {
  json body = {
      {"device_id", dev.device_id},
      {"device_name", dev.device_name},
      {"controller_index", dev.controller_index},
      {"profile",
       {{"name", dev.profile.name},
        {"pad_type", dev.profile.pad_type},
        {"color", dev.profile.color}}},
      {"pad",
       {{"backend", dev.pad_backend},
        {"active", dev.pad_active},
        {"user_index", dev.user_index}}},
      {"input_seq", dev.input_seq},
  };
  if (dev.has_input) {
    body["last_input"] = PadStateToJson(dev.last_input);
  } else {
    body["last_input"] = nullptr;
  }
  return body;
}

bool ParseBody(const httplib::Request& req, httplib::Response& res, json* body) {
  try {
    *body = json::parse(req.body);
  } catch (const json::exception&) {
    res.status = 400;
    res.set_content(json{{"error", "invalid JSON body"}}.dump(), "application/json");
    return false;
  }
  return true;
}

int DefaultPort() { return 8080; }

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  // Keep console output readable on Windows when device names are UTF-8.
  SetConsoleOutputCP(CP_UTF8);
#endif

  int port = DefaultPort();
  if (argc > 1) {
    port = std::atoi(argv[1]);
    if (port <= 0 || port > 65535) {
      std::cerr << "Invalid port: " << argv[1] << std::endl;
      return 1;
    }
  }

  // Silence TTL for registrations; JOYMB_EXPIRE_SECONDS overrides (tests).
  int expire_seconds = 30;
  if (const char* env = std::getenv("JOYMB_EXPIRE_SECONDS")) {
    expire_seconds = std::max(1, std::min(3600, std::atoi(env)));
  }
  DeviceManager devices(expire_seconds);
  httplib::Server svr;

  // Phones may load the HUD from anywhere; allow cross-origin API calls.
  svr.set_default_headers({{"Access-Control-Allow-Origin", "*"}});
  svr.Options(R"(.*)", [](const httplib::Request&, httplib::Response& res) {
    res.set_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "Content-Type");
    res.status = 204;
  });

  // Serve the mobile web app when a web dir is available: argv[2] wins,
  // otherwise ./web next to the working directory. Explicit /api routes
  // take precedence over these static files.
  const std::string web_dir = argc > 2 ? argv[2] : "web";
  if (std::ifstream(web_dir + "/index.html").good()) {
    svr.set_mount_point("/app", web_dir.c_str());
    Log("serving mobile app from " + web_dir + " at /app/");
  }

  svr.Get("/", [](const httplib::Request&, httplib::Response& res) {
    res.set_content("joymb-server ok. GET /api/devices for status.\n", "text/plain");
  });

  svr.Post("/api/register", [&](const httplib::Request& req, httplib::Response& res) {
    json body;
    if (!ParseBody(req, res, &body)) return;
    const std::string name = body.value("device_name", "");
    if (name.empty()) {
      res.status = 400;
      res.set_content(json{{"error", "device_name is required"}}.dump(), "application/json");
      return;
    }
    const std::string resume_id = body.value("device_id", "");
    bool resumed = false;
    auto dev = devices.Register(name, resume_id, &resumed);
    if (!dev) {
      res.status = 409;
      res.set_content(json{{"error", "no free controller slots (max 4)"}}.dump(),
                      "application/json");
      Log("REJECT " + name + " (slots full)");
      return;
    }
    Log(std::string(resumed ? "RESUME " : "CONNECT ") + "id=" + dev->device_id + " name=\"" +
        dev->device_name + "\" slot=" + std::to_string(dev->controller_index) + " profile=\"" +
        dev->profile.name + "\" pad=" + dev->pad_backend +
        (dev->pad_active ? " (active)" : " (INACTIVE)") +
        " user_index=" + std::to_string(dev->user_index));
    if (!dev->pad_active) {
      Log("WARN id=" + dev->device_id + " pad inactive: is the ViGEmBus driver installed?");
    }
    json out = DeviceToJson(*dev);
    out["resumed"] = resumed;
    res.set_content(out.dump(), "application/json");
  });

  svr.Post("/api/heartbeat", [&](const httplib::Request& req, httplib::Response& res) {
    json body;
    if (!ParseBody(req, res, &body)) return;
    const std::string id = body.value("device_id", "");
    if (id.empty() || !devices.Heartbeat(id)) {
      res.status = 404;
      res.set_content(json{{"error", "unknown device_id"}}.dump(), "application/json");
      return;
    }
    res.set_content(json{{"ok", true}}.dump(), "application/json");
  });

  svr.Post("/api/input", [&](const httplib::Request& req, httplib::Response& res) {
    json body;
    if (!ParseBody(req, res, &body)) return;
    const std::string id = body.value("device_id", "");
    if (id.empty()) {
      res.status = 404;
      res.set_content(json{{"error", "unknown device_id"}}.dump(), "application/json");
      return;
    }
    PadState state;
    std::string error;
    if (!ParsePadState(body, &state, &error)) {
      res.status = 400;
      res.set_content(json{{"error", error}}.dump(), "application/json");
      return;
    }
    switch (devices.SendInput(id, state)) {
      case InputResult::kOk:
        res.set_content(json{{"ok", true}}.dump(), "application/json");
        return;
      case InputResult::kUnknownDevice:
        res.status = 404;
        res.set_content(json{{"error", "unknown device_id"}}.dump(), "application/json");
        return;
      case InputResult::kPadInactive:
        res.status = 503;
        res.set_content(json{{"error", "virtual pad is not active"}}.dump(),
                        "application/json");
        return;
    }
  });

  svr.Get("/api/devices", [&](const httplib::Request&, httplib::Response& res) {
    json arr = json::array();
    for (const auto& dev : devices.List()) {
      arr.push_back(DeviceToJson(dev));
    }
    res.set_content(json{{"devices", arr}}.dump(), "application/json");
  });

  svr.Delete(R"(/api/devices/([^/]+))", [&](const httplib::Request& req, httplib::Response& res) {
    const std::string id = req.matches[1];
    Device removed;
    if (!devices.Remove(id, &removed)) {
      res.status = 404;
      res.set_content(json{{"error", "unknown device_id"}}.dump(), "application/json");
      return;
    }
    Log("DISCONNECT id=" + removed.device_id + " name=\"" + removed.device_name + "\" slot=" +
        std::to_string(removed.controller_index));
    res.set_content(json{{"ok", true}}.dump(), "application/json");
  });

  // Optional argv[3]: bind address. Use 127.0.0.1 when sitting behind a
  // reverse proxy so the port isn't exposed directly.
  const std::string bind_host = argc > 3 ? argv[3] : "0.0.0.0";
  Log("joymb-server listening on " + bind_host + ":" + std::to_string(port));
  if (!svr.listen(bind_host, port)) {
    std::cerr << "Failed to bind " << bind_host << ":" << port << std::endl;
    return 1;
  }
  return 0;
}
