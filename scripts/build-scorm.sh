#!/usr/bin/env bash
#
# SCORM Package Builder — رحلة الحوكمة
#
# Creates a SCORM 1.2-compliant ZIP package that can be imported into
# any LMS (Moodle, Blackboard, Canvas, SCORM Cloud, etc.).
#
# Usage:
#   ./scripts/build-scorm.sh
#
# Output:
#   dist/elhokma-governance-scorm.zip
#
set -euo pipefail

cd "$(dirname "$0")/.."

DIST_DIR="dist"
PKG_NAME="elhokma-governance-scorm"
ZIP_FILE="$DIST_DIR/${PKG_NAME}.zip"

MANIFEST_FILES=(
  "imsmanifest.xml"
  "index.html"
  "favicon.svg"
  "manifest.webmanifest"
  "sw.js"
  "css/style.css"
  "css/animations.css"
  "css/scenes.css"
  "js/error-boundary.js"
  "js/scorm-api.js"
  "js/scoring.js"
  "js/tts.js"
  "js/content.js"
  "js/narrator.js"
  "js/animator.js"
  "js/modal-manager.js"
  "js/app.js"
)

echo "==> Verifying required files..."
MISSING=0
for f in "${MANIFEST_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "  MISSING: $f"
    MISSING=$((MISSING + 1))
  fi
done
if [ $MISSING -gt 0 ]; then
  echo "$MISSING file(s) missing. Cannot build package."
  exit 1
fi
echo "  All ${#MANIFEST_FILES[@]} required files present."

echo "==> Validating imsmanifest.xml..."
if ! python3 -c "import xml.etree.ElementTree as ET; ET.parse('imsmanifest.xml')" 2>/dev/null; then
  echo "  imsmanifest.xml is not valid XML."
  exit 1
fi
echo "  imsmanifest.xml is valid XML."

mkdir -p "$DIST_DIR"
rm -f "$ZIP_FILE"

echo "==> Building SCORM package: $ZIP_FILE"
zip -r -X "$ZIP_FILE" "${MANIFEST_FILES[@]}" -x "*/.*"

echo "==> Verifying package..."
if command -v unzip &>/dev/null; then
  FILE_COUNT=$(unzip -l "$ZIP_FILE" | tail -1 | awk '{print $2}')
  echo "  Package contains $FILE_COUNT files."
  if ! unzip -l "$ZIP_FILE" | grep -q "imsmanifest.xml"; then
    echo "  imsmanifest.xml not found at package root."
    exit 1
  fi
  echo "  imsmanifest.xml is at package root."
fi

PACKAGE_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
echo ""
echo "SCORM package built successfully."
echo "  File: $ZIP_FILE"
echo "  Size: $PACKAGE_SIZE"
echo ""
echo "  Import this ZIP into your LMS as a SCORM 1.2 package."
