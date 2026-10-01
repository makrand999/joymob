#pragma once

#include <chrono>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "virtual_pad.h"

struct DeviceProfile {
  std::string name;               // human-readable profile name, e.g. "Player 1"
  std::string pad_type = "x360";  // virtual pad type for the emulation backend
  std::string color;              // LED/color hex, e.g. "#0064FF"
};

struct Device {
  std::string device_id;          // stable UUID assigned at registration
  std::string device_name;        // phone-provided name (not unique)
  int controller_index = -1;      // unique slot 0..3
  DeviceProfile profile;
  std::string pad_backend;        // e.g. "vigem-x360" or "null-stub"
  bool pad_active = false;        // true when the virtual pad is operational
  int user_index = -1;            // OS player slot (XInput 0..3), -1 unknown
  PadState last_input;            // last state accepted for this device
  bool has_input = false;
  uint64_t input_seq = 0;  // bumps on every accepted input; consumers use it
                           // to apply delta-style fields exactly once
  std::chrono::steady_clock::time_point last_seen;
};

enum class InputResult {
  kOk,
  kUnknownDevice,
  kPadInactive,
};

class DeviceManager {
 public:
  static constexpr int kMaxControllers = 4;

  explicit DeviceManager(int expire_seconds = 30) : expire_seconds_(expire_seconds) {}

  // Registers a device and creates its virtual pad. Returns nullopt when
  // all 4 slots are taken.
  //
  // Reconnects: when resume_id matches a live registration, that device is
  // resumed (same id/slot/profile, presence refreshed) instead of minting a
  // duplicate; `resumed` reports which path was taken. Unknown ids fall
  // through to a fresh registration. Expired devices are purged first so
  // dead phones don't hold slots forever.
  std::optional<Device> Register(const std::string& device_name,
                                 const std::string& resume_id, bool* resumed);

  // Refreshes last_seen for a known device. Returns false if unknown.
  bool Heartbeat(const std::string& device_id);

  // Non-const: listing purges expired devices as a side effect.
  std::vector<Device> List();

  // Removes a device, destroying its virtual pad and freeing its slot.
  // `removed` receives the erased device for logging.
  bool Remove(const std::string& device_id, Device* removed);

  // Forwards an input report to the device's virtual pad.
  InputResult SendInput(const std::string& device_id, const PadState& state);

 private:
  std::string MakeUuid();
  int AllocIndexLocked();
  DeviceProfile MakeProfileLocked(const std::string& device_name, int index);
  // Drops devices silent for longer than expire_seconds_. Callers must hold
  // mutex_. Devices vector/pads stay in sync: pads are destroyed (unplugged).
  void PurgeExpiredLocked();

  mutable std::mutex mutex_;
  std::vector<Device> devices_;
  std::map<std::string, std::unique_ptr<IVirtualPad>> pads_;  // by device_id
  bool index_used_[kMaxControllers] = {false, false, false, false};
  uint64_t profile_seq_ = 0;
  const int expire_seconds_;
};
