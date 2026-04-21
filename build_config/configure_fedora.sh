#!/bin/bash
set -e

# SteamMusicServer build environment — Fedora (dnf)
#
# aws_lc_rs (rustls crypto) requires: gcc, cmake, perl, nasm
# rusqlite uses bundled sqlite — no system libsqlite3 needed

PACKAGES=(gcc cmake perl nasm)

echo "==> Installing packages via dnf: ${PACKAGES[*]}"
sudo dnf install -y "${PACKAGES[@]}"

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
