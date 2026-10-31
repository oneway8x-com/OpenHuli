#!/bin/sh
set -eu
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/microhuli-nano-tests.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM
"${CXX:-c++}" -std=c++11 -Wall -Wextra -Werror -I"$test_dir/stubs" \
  "$test_dir/nano_host_test.cpp" -o "$build_dir/nano_host_test"
"$build_dir/nano_host_test"
"$build_dir/nano_host_test" oled-connected

repo_dir=$(CDPATH= cd -- "$test_dir/../../.." && pwd)
"${CXX:-c++}" -std=c++11 -Wall -Wextra -Werror -I"$test_dir/stubs" \
  -I"$repo_dir/libraries/OpenHuliSerial/src" \
  "$test_dir/connected_host_test.cpp" \
  "$repo_dir/libraries/OpenHuliSerial/src/OpenHuliWire.cpp" \
  "$repo_dir/libraries/OpenHuliSerial/src/OpenHuliNode.cpp" \
  "$repo_dir/libraries/OpenHuliSerial/src/OpenHuliGateway.cpp" \
  -o "$build_dir/connected_host_test"
"$build_dir/connected_host_test"
"$build_dir/connected_host_test" oled-connected
"$build_dir/connected_host_test" oled-connected corrupt-journal
