#!/usr/bin/env bash
#
# Run all unit tests.
#
# Usage:
#   ./scripts/test.sh
#
# Exits with code 1 if any test fails.
#
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=========================================="
echo "  Running unit tests"
echo "=========================================="
echo ""

FAILURES=0

for testfile in tests/*.test.js; do
  if [ -f "$testfile" ]; then
    echo "--- $(basename "$testfile") ---"
    if ! node "$testfile"; then
      FAILURES=$((FAILURES + 1))
    fi
    echo ""
  fi
done

echo "=========================================="
if [ $FAILURES -gt 0 ]; then
  echo "  ✗ $FAILURES test file(s) failed"
  exit 1
else
  echo "  ✓ All tests passed"
  exit 0
fi
