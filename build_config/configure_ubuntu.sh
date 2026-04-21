#!/bin/bash
set -e

# SteamMusicServer build environment — Ubuntu / Debian
#
# aws_lc_rs (rustls crypto) requires: gcc, cmake, perl, nasm
# rusqlite uses bundled sqlite — no system libsqlite3 needed

PACKAGES=(build-essential cmake perl nasm)

echo "==> Updating apt and installing packages: ${PACKAGES[*]}"
sudo apt-get update -q
sudo apt-get install -y "${PACKAGES[@]}"

echo ""
echo "==> Installing rustup"
if command -v rustup &>/dev/null; then
  echo "    rustup already installed, updating..."
  rustup update stable
else
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  source "$HOME/.cargo/env"
fi

rustc --version
cargo --version

echo ""
echo "==> Done. Build with:  cargo build --release"
