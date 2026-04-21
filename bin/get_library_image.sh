#!/usr/bin/env bash
#
# get_library_image.sh
# Wrapper around AFCMS/SteamFetch (https://github.com/AFCMS/SteamFetch)
# to pull Steam library artwork (games AND soundtracks) by appid.
#
# Soundtrack (OST) appids use the SAME type name as games: "library_capsule".
# The image just happens to be square instead of 2:3. There is no separate
# "album cover" asset type in PICS — OSTs reuse the library_capsule slot.
#
# Usage:
#   ./get_library_image.sh <appid> [type] [variant] [language] [outdir]
#
#   type:     library_capsule (default) | library_hero | library_logo | library_header
#   variant:  image2x (default) | image
#   language: english (default) | schinese | japanese | ...
#   outdir:   ./ (default)
#
# Examples:
#   ./get_library_image.sh 881100                     # Noita game cover
#   ./get_library_image.sh 1161100                    # Noita OST cover (square)
#   ./get_library_image.sh 881100 library_hero
#   ./get_library_image.sh 881100 library_logo image2x english ./art/
#
# Special: pass "list" as the type to just enumerate what's available:
#   ./get_library_image.sh 881100 list

set -euo pipefail

# ---- config -----------------------------------------------------------------
# Point this at your SteamFetch checkout. Override with STEAMFETCH_DIR env var.
STEAMFETCH_DIR="./SteamFetch"
# -----------------------------------------------------------------------------

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <appid> [type] [variant] [language] [outdir]" >&2
  echo "       $0 <appid> list    # enumerate available assets" >&2
  exit 1
fi

appid="$1"
type="${2:-library_capsule}"
variant="${3:-image2x}"
language="${4:-english}"
outdir="${5:-./}"

# sanity checks
if ! [[ "$appid" =~ ^[0-9]+$ ]]; then
  echo "error: appid must be numeric, got: $appid" >&2
  exit 2
fi

if [[ ! -d "$STEAMFETCH_DIR" ]]; then
  echo "error: SteamFetch not found at $STEAMFETCH_DIR" >&2
  echo "       clone it:  git clone https://github.com/AFCMS/SteamFetch $STEAMFETCH_DIR" >&2
  echo "       or set:    export STEAMFETCH_DIR=/path/to/SteamFetch" >&2
  exit 3
fi

if ! command -v dotnet >/dev/null 2>&1; then
  echo "error: 'dotnet' not on PATH. SteamFetch needs the .NET 10 SDK." >&2
  exit 4
fi

# list mode: just enumerate and bail
if [[ "$type" == "list" ]]; then
  exec dotnet run --project "$STEAMFETCH_DIR" -- available "$appid"
fi

mkdir -p "$outdir"

# ensure trailing slash so SteamFetch infers the filename from the URL
case "$outdir" in
  */) ;;
  *) outdir="${outdir}/" ;;
esac

echo ">> appid=$appid type=$type variant=$variant lang=$language -> $outdir"

# First attempt: exact spec the user asked for.
# Fallback: if library_capsule/image2x isn't present, try plain 'image'.
# Some OSTs only upload one variant.
if ! dotnet run --project "$STEAMFETCH_DIR" -- \
       single "$appid" "$type" "$variant" "$language" -o "$outdir"; then
  echo ">> primary spec failed, retrying with variant=image" >&2
  dotnet run --project "$STEAMFETCH_DIR" -- \
       single "$appid" "$type" image "$language" -o "$outdir"
fi
