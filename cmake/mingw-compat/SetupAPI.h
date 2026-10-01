// MinGW-compat shim: ViGEmClient includes <SetupAPI.h> (capital SAPI),
// which only resolves on case-insensitive filesystems. See Windows.h in
// this folder.
#pragma once
#include <setupapi.h>
