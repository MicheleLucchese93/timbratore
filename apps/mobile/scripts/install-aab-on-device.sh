#!/bin/bash

# Install the built AAB (app-release.aab) on the connected Android device.
# Uses bundletool to build signed APKs from the AAB and install them.
# Signing credentials come from android/keystore.properties (timbratore_prod keystore).
# Requires: bundletool (e.g. brew install bundletool), adb, and a device with USB debugging.
#
# Terminal commands:
#   From repo root:  npm -w apps/mobile run install:aab
#   Or directly:     cd apps/mobile && ./scripts/install-aab-on-device.sh

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$MOBILE_DIR/android"
AAB_FILE="$SCRIPT_DIR/app-release.aab"
APKS_FILE="$SCRIPT_DIR/app-release.apks"
KEYSTORE_PROPERTIES="$ANDROID_DIR/keystore.properties"

# Check bundletool is available
if ! command -v bundletool &>/dev/null; then
    echo -e "${RED}Error: bundletool not found. Install with: brew install bundletool${NC}"
    exit 1
fi

# Check AAB exists
if [ ! -f "$AAB_FILE" ]; then
    echo -e "${RED}Error: AAB not found at $AAB_FILE${NC}"
    echo -e "${YELLOW}Build it first: npm -w apps/mobile run build:aab${NC}"
    exit 1
fi

# Check device is connected
if ! adb devices | grep -q 'device$'; then
    echo -e "${RED}Error: No Android device connected. Connect a device with USB debugging enabled.${NC}"
    exit 1
fi

# Check keystore.properties exists
if [ ! -f "$KEYSTORE_PROPERTIES" ]; then
    echo -e "${RED}Error: keystore.properties not found at $KEYSTORE_PROPERTIES${NC}"
    exit 1
fi

# Read keystore path and credentials
KEYSTORE_FILE=$(grep "^storeFile=" "$KEYSTORE_PROPERTIES" | cut -d'=' -f2 | tr -d ' ')
if [[ "$KEYSTORE_FILE" == ../../* ]]; then
    KEYSTORE_FILE="$MOBILE_DIR/${KEYSTORE_FILE#../../}"
elif [[ "$KEYSTORE_FILE" == ../* ]]; then
    KEYSTORE_FILE="$ANDROID_DIR/$KEYSTORE_FILE"
else
    KEYSTORE_FILE="$ANDROID_DIR/$KEYSTORE_FILE"
fi

STORE_PASSWORD=$(grep "^storePassword=" "$KEYSTORE_PROPERTIES" | cut -d'=' -f2 | tr -d ' ')
KEY_ALIAS=$(grep "^keyAlias=" "$KEYSTORE_PROPERTIES" | cut -d'=' -f2 | tr -d ' ')
KEY_PASSWORD=$(grep "^keyPassword=" "$KEYSTORE_PROPERTIES" | cut -d'=' -f2 | tr -d ' ')

if [ ! -f "$KEYSTORE_FILE" ]; then
    echo -e "${RED}Error: Keystore file not found at $KEYSTORE_FILE${NC}"
    echo -e "${YELLOW}Copy @micheel93-2__timbratore.jks to android/app/ (from EAS download).${NC}"
    exit 1
fi

echo -e "${GREEN}Building signed APKs from AAB for connected device...${NC}"
rm -f "$APKS_FILE"
bundletool build-apks \
    --bundle="$AAB_FILE" \
    --output="$APKS_FILE" \
    --connected-device \
    --ks="$KEYSTORE_FILE" \
    --ks-pass="pass:$STORE_PASSWORD" \
    --ks-key-alias="$KEY_ALIAS" \
    --key-pass="pass:$KEY_PASSWORD"

echo -e "${GREEN}Installing on device...${NC}"
bundletool install-apks --apks="$APKS_FILE"

echo -e "${GREEN}✓ App installed successfully on the connected device.${NC}"
