#pragma once

// Virtual gamepad seam: one pad instance per registered mobile device.
//
// Windows + JOYMB_WITH_VIGEM: ViGEmVirtualPad (see vigem_pad.h) drives a real
// emulated Xbox 360 pad via ViGEmBus. Everywhere else NullVirtualPad records
// state without a driver so the server stays buildable and testable.

#include <cstdint>
#include <string>

// Full input state of one pad. Sticks are raw int16 (-32768..32767, +Y = up,
// +X = right); triggers are 0..255.
//
// look_dx/look_dy carry the mouse-style look delta (deflection units travelled
// since the client's last delivered sample). The XUSB report has no delta
// channel, so ViGEm ignores them; consumers that want mouse-like look (the
// ball rig now, a mouse-injection backend later) read them from the echo.
struct PadState {
  uint16_t buttons = 0;
  int16_t lx = 0;
  int16_t ly = 0;
  int16_t rx = 0;
  int16_t ry = 0;
  uint8_t lt = 0;
  uint8_t rt = 0;
  float look_dx = 0;
  float look_dy = 0;
};

// Button bits. Values intentionally match XUSB_GAMEPAD_* (ViGEm/Common.h) so
// the ViGEm backend forwards them unchanged.
namespace PadButton {
constexpr uint16_t kDpadUp = 0x0001;
constexpr uint16_t kDpadDown = 0x0002;
constexpr uint16_t kDpadLeft = 0x0004;
constexpr uint16_t kDpadRight = 0x0008;
constexpr uint16_t kStart = 0x0010;
constexpr uint16_t kBack = 0x0020;
constexpr uint16_t kL3 = 0x0040;
constexpr uint16_t kR3 = 0x0080;
constexpr uint16_t kLb = 0x0100;
constexpr uint16_t kRb = 0x0200;
constexpr uint16_t kGuide = 0x0400;
constexpr uint16_t kA = 0x1000;
constexpr uint16_t kB = 0x2000;
constexpr uint16_t kX = 0x4000;
constexpr uint16_t kY = 0x8000;
}  // namespace PadButton

class IVirtualPad {
 public:
  virtual ~IVirtualPad() = default;

  // Create the virtual controller for the given controller index (0..3).
  virtual bool Create(int controller_index) = 0;
  virtual void Destroy() = 0;

  // Push a full input report. Returns false when the pad is not operational.
  virtual bool SendState(const PadState& state) = 0;

  virtual bool IsActive() const = 0;
  virtual std::string BackendName() const = 0;

  // Last state accepted via SendState (also tracked by real backends, so the
  // status endpoint can echo input without a game attached).
  virtual PadState LastState() const = 0;

  // OS-side player slot (XInput user index 0..3), or -1 when unknown.
  virtual int UserIndex() const = 0;
};

// No-op backend: records state without touching any driver.
class NullVirtualPad : public IVirtualPad {
 public:
  bool Create(int controller_index) override {
    index_ = controller_index;
    active_ = true;
    return true;
  }

  void Destroy() override { active_ = false; }

  bool SendState(const PadState& state) override {
    if (!active_) return false;
    last_ = state;
    return true;
  }

  bool IsActive() const override { return active_; }
  std::string BackendName() const override { return "null-stub"; }
  PadState LastState() const override { return last_; }
  int UserIndex() const override { return -1; }

 private:
  int index_ = -1;
  bool active_ = false;
  PadState last_;
};
