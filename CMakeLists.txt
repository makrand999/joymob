cmake_minimum_required(VERSION 3.16)
project(joymb-server VERSION 0.2.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Real Xbox 360 emulation via ViGEmBus. Windows-only; OFF (or any other
# platform) builds with the null-stub pad so HTTP/input logic stays testable.
option(JOYMB_WITH_VIGEM "Emulate Xbox 360 pads via ViGEm (Windows only)" ON)

include(FetchContent)

# Keep re-configures working without network once populated.
set(FETCHCONTENT_UPDATES_DISCONNECTED ON)

# --- nlohmann/json (header-only) ---
FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE
)

# --- cpp-httplib (header-only) ---
set(HTTPLIB_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(HTTPLIB_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  httplib
  GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
  GIT_TAG v0.15.3
  GIT_SHALLOW TRUE
)

FetchContent_MakeAvailable(nlohmann_json httplib)

# --- ViGEmClient (Windows only, no CMakeLists upstream) ---
# Single self-contained source; compile it directly into a static lib.
if(WIN32 AND JOYMB_WITH_VIGEM)
  FetchContent_Declare(
    vigemclient
    GIT_REPOSITORY https://github.com/nefarius/ViGEmClient.git
    GIT_TAG master
    GIT_SHALLOW TRUE
  )
  FetchContent_GetProperties(vigemclient)
  if(NOT vigemclient_POPULATED)
    FetchContent_Populate(vigemclient)
  endif()
  add_library(vigemclient STATIC ${vigemclient_SOURCE_DIR}/src/ViGEmClient.cpp)
  target_include_directories(vigemclient PUBLIC ${vigemclient_SOURCE_DIR}/include)
  target_link_libraries(vigemclient PUBLIC setupapi)
  if(MINGW)
    # ViGEmClient uses capitalized <Windows.h>/<SetupAPI.h>, unresolvable on
    # case-sensitive Linux filesystems. Shims redirect to real headers.
    target_include_directories(vigemclient PRIVATE ${CMAKE_SOURCE_DIR}/cmake/mingw-compat)
  endif()
  if(MSVC)
    # ViGEmClient is warning-noisy; don't let /W4 fail our build for it.
    target_compile_options(vigemclient PRIVATE /W1)
  endif()
endif()

set(JOYMB_SOURCES
  src/main.cpp
  src/device_manager.cpp
  src/input.cpp
)
if(WIN32 AND JOYMB_WITH_VIGEM)
  list(APPEND JOYMB_SOURCES src/vigem_pad.cpp)
endif()

add_executable(joymb-server ${JOYMB_SOURCES})

target_include_directories(joymb-server PRIVATE src)

target_link_libraries(joymb-server PRIVATE
  httplib::httplib
  nlohmann_json::nlohmann_json
)

# Windows: httplib needs Winsock. Linux: needs threads.
if(WIN32)
  target_link_libraries(joymb-server PRIVATE ws2_32)
  if(JOYMB_WITH_VIGEM)
    target_link_libraries(joymb-server PRIVATE vigemclient)
    target_compile_definitions(joymb-server PRIVATE JOYMB_WITH_VIGEM=1)
  endif()
else()
  find_package(Threads REQUIRED)
  target_link_libraries(joymb-server PRIVATE Threads::Threads)
endif()

if(MSVC)
  target_compile_options(joymb-server PRIVATE /W4 /EHsc)
  target_compile_definitions(joymb-server PRIVATE _WIN32_WINNT=0x0A00 NOMINMAX WIN32_LEAN_AND_MEAN)
else()
  target_compile_options(joymb-server PRIVATE -Wall -Wextra)
endif()

if(MINGW)
  # Single-file exe: no libgcc/libstdc++ DLLs to ship alongside it.
  target_link_options(joymb-server PRIVATE -static-libgcc -static-libstdc++)
endif()

# Guards for Windows-only code live behind `#ifdef _WIN32` in sources,
# so this target also compiles on Linux for logic/endpoint development.

include(CTest)
if(BUILD_TESTING)
  if(NOT CMAKE_CROSSCOMPILING)
    add_test(NAME smoke
      COMMAND ${CMAKE_SOURCE_DIR}/tests/smoke.sh $<TARGET_FILE:joymb-server> 18081 ${CMAKE_SOURCE_DIR}/web)
  endif()
  add_test(NAME web-tests
    COMMAND node --test "${CMAKE_SOURCE_DIR}/web/tests/*.test.js" "${CMAKE_SOURCE_DIR}/game/ball/tests/*.test.mjs")
endif()
