// MinGW-compat shim: ViGEmClient includes <Windows.h> (capital W), which
// only resolves on case-insensitive filesystems. MinGW's own header is
// lowercase windows.h. This folder is on the include path for MINGW builds
// only (see CMakeLists.txt); MSVC builds never see it.
#pragma once
#include <windows.h>
