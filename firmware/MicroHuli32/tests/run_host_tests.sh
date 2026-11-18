#!/bin/sh
set -eu
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/microhuli32-tests.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM
"${CXX:-c++}" -std=c++11 -Wall -Wextra -Werror \
  -I"$test_dir/stubs" -I"$test_dir/../../MicroHuli/tests/stubs" \
  "$test_dir/host_test.cpp" -o "$build_dir/host_test"
"$build_dir/host_test"
"$build_dir/host_test" oled-connected
