#!/bin/bash
set -e

# SteamMusicServer build environment — Fedora Silverblue (rpm-ostree)
#
# aws_lc_rs (rustls crypto) requires: gcc, cmake, perl, nasm
# rusqlite uses bundled sqlite — no system libsqlite3 needed
#
# rpm-ostree layers packages into the OS image. Requires reboot (or --apply-live
# on Silverblue 37+) to take effect. Run this once per machine.

PACKAGES=(gcc cmake perl nasm)

echo "==> Layering packages via rpm-ostree: ${PACKAGES[*]}"
rpm-ostree install --idempotent "${PACKAGES[@]}"

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
echo "==> Done."
echo "    If this is your first rpm-ostree install, reboot before building:"
echo "    systemctl reboot"
echo ""
echo "    Then build with:  cargo build --release"
