#!/bin/bash

# Install the syntaqlite CLI from a pinned GitHub release.
# This avoids `curl | sh` and validates the asset checksum.

set -euo pipefail

VERSION="v0.3.1"
DEST_DIR="${HOME}/.local/bin"
TARGET_OS="$(uname -s)"
TARGET_ARCH="$(uname -m)"

case "$TARGET_OS" in
Linux) PLATFORM_OS="linux" ;;
Darwin) PLATFORM_OS="macos" ;;
*)
	echo "Unsupported OS for syntaqlite install: $TARGET_OS" >&2
	exit 2
	;;
esac

case "$TARGET_ARCH" in
x86_64|amd64) PLATFORM_ARCH="x64" ;;
aarch64|arm64) PLATFORM_ARCH="arm64" ;;
*)
	echo "Unsupported architecture for syntaqlite install: $TARGET_ARCH" >&2
	exit 2
	;;
esac

ASSET_NAME="syntaqlite-${PLATFORM_OS}-${PLATFORM_ARCH}.tar.gz"
ASSET_URL="https://github.com/LalitMaganti/syntaqlite/releases/download/${VERSION}/${ASSET_NAME}"

case "${PLATFORM_OS}-${PLATFORM_ARCH}" in
linux-x64) EXPECTED_SHA256="2224df27bf2d9361a4cb890979c313299794ed0e4f2d8a06fbdad329db58100d" ;;
linux-arm64) EXPECTED_SHA256="e271d984e8f51b7902fb35a93eac0dc5f148ea095cf38fb33a2d8edb11302cab" ;;
macos-x64) EXPECTED_SHA256="618e82b59154d5ee05fc9fd3c2791145bff4b4a2acea58e4ead5f7bd1b57c23f" ;;
macos-arm64) EXPECTED_SHA256="d4d6d761efd2de3e1c4caa3cd2c2f7531cb01f908587fd3cfb370d4519306bcc" ;;
*)
	echo "No checksum configured for ${PLATFORM_OS}-${PLATFORM_ARCH}" >&2
	exit 2
	;;
esac

TMP_DIR="$(mktemp -d)"
ARCHIVE_PATH="${TMP_DIR}/${ASSET_NAME}"

cleanup() {
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "[install-syntaqlite] Downloading ${ASSET_NAME}..."
curl --fail --location --silent --show-error "$ASSET_URL" -o "$ARCHIVE_PATH"

ACTUAL_SHA256="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
	echo "[install-syntaqlite] Checksum mismatch for ${ASSET_NAME}" >&2
	echo "Expected: $EXPECTED_SHA256" >&2
	echo "Actual:   $ACTUAL_SHA256" >&2
	exit 2
fi

mkdir -p "$DEST_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"

if [ ! -f "${TMP_DIR}/syntaqlite" ]; then
	echo "[install-syntaqlite] Extracted archive does not contain syntaqlite binary" >&2
	exit 2
fi

install -m 0755 "${TMP_DIR}/syntaqlite" "${DEST_DIR}/syntaqlite"
echo "[install-syntaqlite] Installed syntaqlite to ${DEST_DIR}/syntaqlite"
