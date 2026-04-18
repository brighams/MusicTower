#!/bin/bash
set -e

echo "Building release binary..."
cargo build --release

echo "Packaging release..."
rm -rf dist
mkdir -p dist/config

cp target/release/music_server dist/
cp config/scanner_conf.yaml dist/config/

cd dist
zip -r ../music_server-release.zip .
cd ..

echo "Release package created: music_server-release.zip"
