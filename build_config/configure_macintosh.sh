#!/bin/bash
set -e

# SteamMusicServer build environment — Macintosh (macOS)
#
# aws_lc_rs (rustls crypto) requires: clang (via Xcode CLT), cmake, perl
# Perl ships with macOS. Clang ships with Xcode Command Line Tools.
# cmake is installed via Homebrew.
# rusqlite uses bundled sqlite — no system libsqlite3 needed.

echo "==> Checking Xcode Command Line Tools"
if ! xcode-select -p &>/dev/null; then
  echo "    Installing Xcode Command Line Tools..."
  echo "    A dialog will appear — click Install and wait for it to finish."
  xcode-select --install
  echo ""
  read -rp "    Press Enter once the CLT installation dialog has completed..."
else
  echo "    Xcode CLT already installed: $(xcode-select -p)"
fi

echo ""
echo "==> Checking Homebrew"
if ! command -v brew &>/dev/null; then
  echo "    Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for Apple Silicon
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
else
  echo "    Homebrew already installed: $(brew --prefix)"
fi

echo ""
echo "==> Installing cmake via Homebrew"
brew install cmake

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
