#!/bin/bash

# Build script for creating a signed Android App Bundle (AAB) locally.
# Uses android/keystore.properties for the local keystore path and credentials
# (EAS timbratore_prod: @micheel93-2__timbratore.jks).
#
# Run (from repository root):
#   npm -w apps/mobile run build:aab
#
# Or run the script directly:
#   cd apps/mobile && ./scripts/build-android-aab.sh
#
# Set CLEAN_BEFORE_BUILD=1 to run Gradle clean before building (can fail on RN/CMake).
# Uses --no-configuration-cache --no-build-cache on bundleRelease (same as typical
# local React Native Gradle release builds) to avoid resolving autolinked native
# modules with "No variants exist" / no matching release variant.
#
# Application ID (e.g. app.sonoqui.mobile) is not set in this script—it comes from
# android/app/build.gradle after Expo prebuild, which reads app.json
# (expo.android.package). If you change the package name, regenerate android/ first:
#   npx expo prebuild --platform android --clean

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Building signed Android App Bundle (AAB)...${NC}"

# Navigate to mobile app directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$MOBILE_DIR/android"

# Ensure Gradle can find the Android SDK (same default as typical local Android setup)
if [ -z "${ANDROID_HOME:-}" ]; then
    if [ -n "${ANDROID_SDK_ROOT:-}" ]; then
        export ANDROID_HOME="$ANDROID_SDK_ROOT"
    elif [[ "$(uname)" == "Darwin" ]]; then
        export ANDROID_HOME="$HOME/Library/Android/sdk"
    else
        export ANDROID_HOME="$HOME/Android/Sdk"
    fi
fi
if [ ! -d "${ANDROID_HOME:-}" ]; then
    echo -e "${RED}Error: Android SDK not found at ${ANDROID_HOME:-}. Set ANDROID_HOME or install Android SDK.${NC}"
    exit 1
fi

cd "$MOBILE_DIR"

# Check if keystore.properties exists
KEYSTORE_PROPERTIES="$ANDROID_DIR/keystore.properties"
if [ ! -f "$KEYSTORE_PROPERTIES" ]; then
    echo -e "${RED}Error: keystore.properties not found at $KEYSTORE_PROPERTIES${NC}"
    exit 1
fi

# Read keystore file path from properties
KEYSTORE_FILE=$(grep "^storeFile=" "$KEYSTORE_PROPERTIES" | cut -d'=' -f2 | tr -d ' ')
# Resolve relative path (relative to android directory)
if [[ "$KEYSTORE_FILE" == ../../* ]]; then
    KEYSTORE_FILE="$MOBILE_DIR/${KEYSTORE_FILE#../../}"
elif [[ "$KEYSTORE_FILE" == ../* ]]; then
    KEYSTORE_FILE="$ANDROID_DIR/$KEYSTORE_FILE"
else
    KEYSTORE_FILE="$ANDROID_DIR/$KEYSTORE_FILE"
fi

# Check if keystore file exists
if [ ! -f "$KEYSTORE_FILE" ]; then
    echo -e "${RED}Error: Keystore file not found at $KEYSTORE_FILE${NC}"
    echo -e "${YELLOW}Download from EAS (timbratore_prod) and copy to: android/app/@micheel93-2__timbratore.jks${NC}"
    echo -e "${YELLOW}Ensure android/keystore.properties has storeFile=app/@micheel93-2__timbratore.jks and matching credentials.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Keystore found: $KEYSTORE_FILE${NC}"

# Use production env so app.config loads .env.production (API keys, Supabase, etc.).
export NODE_ENV=production
export APP_ENV=production

# Bump version by one before building: update versionCode/versionName in build.gradle and version in app.config.ts
BUILD_GRADLE="$ANDROID_DIR/app/build.gradle"
APP_CONFIG="$MOBILE_DIR/app.json"
CURRENT_VERSION_CODE=$(grep "versionCode " "$BUILD_GRADLE" | sed -n 's/.*versionCode \([0-9]*\).*/\1/p')
if [ -z "$CURRENT_VERSION_CODE" ]; then
    echo -e "${RED}Error: could not read versionCode from $BUILD_GRADLE${NC}"
    exit 1
fi
NEW_VERSION_CODE=$((CURRENT_VERSION_CODE + 1))
NEW_VERSION_NAME="${NEW_VERSION_CODE}.0.0"
echo -e "${GREEN}Bumping version: $CURRENT_VERSION_CODE → $NEW_VERSION_CODE ($NEW_VERSION_NAME)${NC}"
if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s/versionCode [0-9]*/versionCode $NEW_VERSION_CODE/" "$BUILD_GRADLE"
    sed -i '' "s/versionName \"[^\"]*\"/versionName \"$NEW_VERSION_NAME\"/" "$BUILD_GRADLE"
    sed -i '' "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW_VERSION_NAME\"/" "$APP_CONFIG"
else
    sed -i "s/versionCode [0-9]*/versionCode $NEW_VERSION_CODE/" "$BUILD_GRADLE"
    sed -i "s/versionName \"[^\"]*\"/versionName \"$NEW_VERSION_NAME\"/" "$BUILD_GRADLE"
    sed -i "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW_VERSION_NAME\"/" "$APP_CONFIG"
fi

# Check if environment variables are set (optional, will use keystore.properties if not)
if [ -z "$KEYSTORE_PASSWORD" ] || [ -z "$KEY_ALIAS" ] || [ -z "$KEY_PASSWORD" ]; then
    echo -e "${YELLOW}Note: Using keystore.properties for signing credentials${NC}"
    echo -e "${YELLOW}To use environment variables instead, set: KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD${NC}"
fi

# Navigate to Android directory
cd "$ANDROID_DIR"

# After changing `namespace` / `applicationId` in app/build.gradle, Gradle can still use cached
# autolinking output that references the old package (e.g. ReactNativeApplicationEntryPoint →
# com.old.app.BuildConfig). Drop generated autolinking without a full `gradlew clean` (which can
# break RN/CMake on some setups).
rm -rf \
  "$ANDROID_DIR/build/generated/autolinking" \
  "$ANDROID_DIR/app/build/generated/autolinking" \
  2>/dev/null || true

# Build release AAB (phone only; skip clean to avoid React Native/CMake autolinking issues during clean)
if [ "$CLEAN_BEFORE_BUILD" = "1" ]; then
    echo -e "${GREEN}Cleaning previous builds...${NC}"
    ./gradlew clean
fi
echo -e "${GREEN}Building release AAB (phone only)...${NC}"
./gradlew --stop
./gradlew :app:bundleRelease \
  -x lint -x test \
  --no-configuration-cache \
  --no-build-cache

# Find the generated phone AAB file
AAB_FILE=$(find "$ANDROID_DIR/app/build/outputs/bundle/release" -name "*.aab" | head -n 1)

if [ -z "$AAB_FILE" ]; then
    echo -e "${RED}Error: Phone AAB file not found after build${NC}"
    exit 1
fi

# Copy AAB to scripts folder for easy access
OUTPUT_DIR="$SCRIPT_DIR"
cp "$AAB_FILE" "$OUTPUT_DIR/app-release.aab"
echo -e "${GREEN}✓ Build successful!${NC}"
PHONE_SIZE=$(du -h "$OUTPUT_DIR/app-release.aab" | cut -f1)
echo -e "${GREEN}✓ Phone AAB: $OUTPUT_DIR/app-release.aab ($PHONE_SIZE)${NC}"

echo ""
echo -e "${GREEN}AAB ready in: $OUTPUT_DIR${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "1. Upload app-release.aab to Google Play Console → Internal Testing"
echo -e "2. Ensure subscriptions are configured in Play Console (if applicable)"
echo -e "3. Add license testers in Play Console → Settings → License Testing"
echo -e "4. Or install on device: npm -w apps/mobile run install:aab"
echo ""
