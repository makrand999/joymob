# Cross-compile joymb-server for Windows from Linux using MinGW-w64.
#
#   apt install g++-mingw-w64-x86-64   # Debian/Ubuntu; needs the posix-thread
#                                     # variant (the default on Debian)
#   cmake -S . -B build-win --toolchain cmake/mingw-w64-x86_64.cmake \
#     -DCMAKE_BUILD_TYPE=Release
#   cmake --build build-win --config Release
#   # -> build-win/joymb-server.exe (needs only stock Windows system DLLs)
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)

set(CMAKE_C_COMPILER x86_64-w64-mingw32-gcc)
set(CMAKE_CXX_COMPILER x86_64-w64-mingw32-g++)
set(CMAKE_RC_COMPILER x86_64-w64-mingw32-windres)

set(CMAKE_FIND_ROOT_PATH /usr/x86_64-w64-mingw32)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
