#include "device_manager.h"

#include <iomanip>
#include <random>
#include <sstream>
#include <utility>

#if defined(_WIN32) && defined(JOYMB_WITH_VIGEM)
#include "vigem_pad.h"
#endif

namespace {

const char* kSlotColors[DeviceManager::kMaxControllers] = {
    "#0064FF",  // P1 blue
    "#FF2B2B",  // P2 red
    "#00C853",  // P3 green
    "#9C27B0",  // P4 purple
};

std::unique_ptr<IVirtualPad> CreatePlatformPad() {
#if defined(_WIN32) && defined(JOYMB_WITH_VIGEM)
  return std::make_unique<ViGEmVirtualPad>();
#else
  return std::make_unique<NullVirtualPad>();
#endif
}

}  // namespace

void DeviceManager::PurgeExpiredLocked() {
  const auto now = std::chrono::steady_clock::now();
  for (auto it = devices_.begin(); it != devices_.end();) {
    const auto silent =
        std::chrono::duration_cast<std::chrono::seconds>(now - it->last_seen).count();
    if (silent >= expire_seconds_) {
      index_used_[it->controller_index] = false;
      pads_.erase(it->device_id);
      it = devices_.erase(it);
    } else {
      ++it;
    }
  }
}

std::optional<Device> DeviceManager::Register(const std::string& device_name,
                                              const std::string& resume_id,
                                              bool* resumed) {
  std::lock_guard<std::mutex> lock(mutex_);
  PurgeExpiredLocked();
  if (resumed) *resumed = false;
  if (!resume_id.empty()) {
    for (auto& dev : devices_) {
      if (dev.device_id == resume_id) {
        dev.device_name = device_name;
        dev.last_seen = std::chrono::steady_clock::now();
        if (resumed) *resumed = true;
        return dev;
      }
    }
  }
  const int index = AllocIndexLocked();
  if (index < 0) {
    return std::nullopt;  // all slots taken
  }
  auto pad = CreatePlatformPad();
  const bool pad_ok = pad->Create(index);
  Device dev;
  dev.device_id = MakeUuid();
  dev.device_name = device_name;
  dev.controller_index = index;
  dev.profile = MakeProfileLocked(device_name, index);
  dev.pad_backend = pad->BackendName();
  dev.pad_active = pad_ok && pad->IsActive();
  dev.user_index = pad->UserIndex();
  dev.last_seen = std::chrono::steady_clock::now();
  index_used_[index] = true;
  pads_.emplace(dev.device_id, std::move(pad));
  devices_.push_back(dev);
  return dev;
}

bool DeviceManager::Heartbeat(const std::string& device_id) {
  std::lock_guard<std::mutex> lock(mutex_);
  PurgeExpiredLocked();
  for (auto& dev : devices_) {
    if (dev.device_id == device_id) {
      dev.last_seen = std::chrono::steady_clock::now();
      return true;
    }
  }
  return false;
}

std::vector<Device> DeviceManager::List() {
  std::lock_guard<std::mutex> lock(mutex_);
  PurgeExpiredLocked();
  return devices_;
}

bool DeviceManager::Remove(const std::string& device_id, Device* removed) {
  std::lock_guard<std::mutex> lock(mutex_);
  for (auto it = devices_.begin(); it != devices_.end(); ++it) {
    if (it->device_id == device_id) {
      if (removed) {
        *removed = *it;
      }
      index_used_[it->controller_index] = false;
      devices_.erase(it);
      pads_.erase(device_id);  // destroys the virtual pad (unplugs it)
      return true;
    }
  }
  return false;
}

InputResult DeviceManager::SendInput(const std::string& device_id,
                                     const PadState& state) {
  std::lock_guard<std::mutex> lock(mutex_);
  PurgeExpiredLocked();
  const auto pad_it = pads_.find(device_id);
  if (pad_it == pads_.end()) return InputResult::kUnknownDevice;
  if (!pad_it->second->SendState(state)) return InputResult::kPadInactive;
  for (auto& dev : devices_) {
    if (dev.device_id == device_id) {
      dev.last_input = pad_it->second->LastState();
      dev.has_input = true;
      ++dev.input_seq;
      dev.last_seen = std::chrono::steady_clock::now();
      break;
    }
  }
  return InputResult::kOk;
}

std::string DeviceManager::MakeUuid() {
  // UUID v4 from a thread-local PRNG. No OS dependency, portable.
  thread_local std::mt19937_64 rng{std::random_device{}()};
  thread_local std::uniform_int_distribution<uint64_t> dist;
  const uint64_t hi = dist(rng);
  const uint64_t lo = dist(rng);
  std::ostringstream out;
  out << std::hex << std::setfill('0') << std::setw(8) << ((hi >> 32) & 0xffffffff) << "-"
      << std::setw(4) << ((hi >> 16) & 0xffff) << "-" << std::setw(4)
      << (((hi & 0xffff) & 0x0fff) | 0x4000) << "-" << std::setw(4)
      << (((lo >> 48) & 0x3fff) | 0x8000) << "-" << std::setw(12) << (lo & 0xffffffffffffULL);
  return out.str();
}

int DeviceManager::AllocIndexLocked() {
  for (int i = 0; i < kMaxControllers; ++i) {
    if (!index_used_[i]) {
      return i;
    }
  }
  return -1;
}

DeviceProfile DeviceManager::MakeProfileLocked(const std::string& device_name, int index) {
  DeviceProfile profile;
  profile.pad_type = "x360";
  profile.color = kSlotColors[index];
  // Distinct per-device profile name; device_name is not unique across phones.
  ++profile_seq_;
  profile.name = device_name + " #" + std::to_string(profile_seq_);
  return profile;
}
