// Windows-only ViGEm backend. Compiled only for JOYMB_WITH_VIGEM builds.

#if defined(_WIN32) && defined(JOYMB_WITH_VIGEM)

#include "vigem_pad.h"

#include <ViGEm/Client.h>

std::mutex ViGEmVirtualPad::shared_mutex_;
PVIGEM_CLIENT ViGEmVirtualPad::shared_client_ = nullptr;
int ViGEmVirtualPad::shared_refs_ = 0;

ViGEmVirtualPad::ViGEmVirtualPad() = default;

ViGEmVirtualPad::~ViGEmVirtualPad() { Destroy(); }

PVIGEM_CLIENT ViGEmVirtualPad::SharedClient() {
  std::lock_guard<std::mutex> lock(shared_mutex_);
  if (shared_client_ != nullptr) {
    ++shared_refs_;
    return shared_client_;
  }
  PVIGEM_CLIENT client = vigem_alloc();
  if (client == nullptr) return nullptr;
  if (!VIGEM_SUCCESS(vigem_connect(client))) {
    vigem_free(client);
    return nullptr;
  }
  shared_client_ = client;
  shared_refs_ = 1;
  return shared_client_;
}

void ViGEmVirtualPad::ReleaseClient() {
  std::lock_guard<std::mutex> lock(shared_mutex_);
  if (shared_client_ == nullptr || shared_refs_ <= 0) return;
  if (--shared_refs_ == 0) {
    vigem_disconnect(shared_client_);
    vigem_free(shared_client_);
    shared_client_ = nullptr;
  }
}

bool ViGEmVirtualPad::Create(int controller_index) {
  Destroy();
  controller_index_ = controller_index;
  PVIGEM_CLIENT client = SharedClient();
  if (client == nullptr) return false;  // bus driver missing/unreachable
  holds_client_ref_ = true;

  target_ = vigem_target_x360_alloc();
  if (target_ == nullptr) {
    ReleaseClient();
    holds_client_ref_ = false;
    return false;
  }
  // Blocks until the pad is fully operational (appears to games).
  if (!VIGEM_SUCCESS(vigem_target_add(client, target_))) {
    vigem_target_free(target_);
    target_ = nullptr;
    ReleaseClient();
    holds_client_ref_ = false;
    return false;
  }
  target_added_ = true;

  ULONG slot = 0;
  if (VIGEM_SUCCESS(vigem_target_x360_get_user_index(client, target_, &slot))) {
    user_index_ = static_cast<int>(slot);
  }
  active_ = true;
  return true;
}

void ViGEmVirtualPad::Destroy() {
  if (!holds_client_ref_) return;
  {
    std::lock_guard<std::mutex> lock(shared_mutex_);
    if (target_added_ && target_ != nullptr && shared_client_ != nullptr) {
      vigem_target_remove(shared_client_, target_);
    }
    if (target_ != nullptr) {
      vigem_target_free(target_);
    }
    target_ = nullptr;
    target_added_ = false;
    active_ = false;
  }  // unlock before ReleaseClient(), which takes the same mutex
  holds_client_ref_ = false;
  ReleaseClient();
  user_index_ = -1;
}

bool ViGEmVirtualPad::SendState(const PadState& state) {
  std::lock_guard<std::mutex> lock(shared_mutex_);
  if (!active_ || !target_added_ || shared_client_ == nullptr) return false;
  XUSB_REPORT report{};
  report.wButtons = state.buttons;
  report.bLeftTrigger = state.lt;
  report.bRightTrigger = state.rt;
  report.sThumbLX = state.lx;
  report.sThumbLY = state.ly;
  report.sThumbRX = state.rx;
  report.sThumbRY = state.ry;
  if (!VIGEM_SUCCESS(vigem_target_x360_update(shared_client_, target_, report))) {
    return false;
  }
  last_ = state;
  return true;
}

bool ViGEmVirtualPad::IsActive() const { return active_; }

std::string ViGEmVirtualPad::BackendName() const { return "vigem-x360"; }

PadState ViGEmVirtualPad::LastState() const { return last_; }

int ViGEmVirtualPad::UserIndex() const { return user_index_; }

#endif  // defined(_WIN32) && defined(JOYMB_WITH_VIGEM)
