#!/usr/bin/env bash
set -e

# bash build.sh
cargo build
target/debug/music_server
