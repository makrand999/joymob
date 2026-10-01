#pragma once

// Windows-only Xbox 360 pad via ViGEmBus/ViGEmClient. Included only when
// building with JOYMB_WITH_VIGEM (see CMakeLists.txt); every other platform
// keeps using NullVirtualPad.

#if defined(_WIN32) && defined(JOYMB_WITH_VIGEM)

#include <mutex>

#include "virtual_pad.h"

// Forward-declared ViGEm types to keep Windows headers out of this header.
struct _VIGEM_CLIENT_T;
struct _VIGEM_TARGET_T;
typedef _VIGEM_CLIENT_T* PVIGEM_CLIENT;
typedef _VIGEM_TARGET_T* PVIGEM_TARGET;

class ViGEmVirtualPad : public IVirtualPad {
 public:
  ViGEmVirtualPad();
  ~ViGEmVirtualPad() override;

  ViGEmVirtualPad(const ViGEmVirtualPad&) = delete;
  ViGEmVirtualPad& operator=(const ViGEmVirtualPad&) = delete;

  bool Create(int controller_index) override;
  void Destroy() override;
  bool SendState(const PadState& state) override;
  bool IsActive() const override;
  std::string BackendName() const override;
  PadState LastState() const override;
  int UserIndex() const override;

 private:
  // Process-wide bus client shared by all pads (ViGEm wants one connection
  // per process). Ref-counted; the mutex also serializes report updates
  // because the client is documented as not thread-safe.
  static PVIGEM_CLIENT SharedClient();
  static void ReleaseClient();
  static std::mutex shared_mutex_;
  static PVIGEM_CLIENT shared_client_;
  static int shared_refs_;

  PVIGEM_TARGET target_ = nullptr;
  bool target_added_ = false;
  bool holds_client_ref_ = false;
  bool active_ = false;
  int controller_index_ = -1;
  int user_index_ = -1;
  PadState last_;
};

#endif  // defined(_WIN32) && defined(JOYMB_WITH_VIGEM)
