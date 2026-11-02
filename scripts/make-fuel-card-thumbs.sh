#!/usr/bin/env bash
# The go-live fuel card photos' THUMBNAILS (6d) — a dev-time step, run by hand when the photos change;
# its output is committed beside the photos and ships with the build (tsup `publicDir`).
#
# WHY: a card's photo shows the PIN on its sticker, so the full photo is served only to a holder of
# `fleetFuelCard.reveal`; every other reader of the cards sees this thumbnail instead. The server
# never decodes an image (no image library is a dependency), so the go-live thumbnails are made here,
# once, with ImageMagick 6 — and a photo uploaded later gets its thumbnail from the browser, made
# with the same parameters (`FLEET_FUEL_CARD_THUMB_*` in the contracts).
#
# At 160 px on the longer side with a 1.2 px Gaussian blur, JPEG quality 55, the embossed digits and
# the sticker's handwriting cannot be read (checked by eye at 3× zoom). `manifest.json` names each
# thumbnail's source by size and SHA-256, so a thumbnail is served only for the exact photo it was
# made from (`fuel-card-thumbs.ts`), and a spec checks every photo has one.
#
#   bash scripts/make-fuel-card-thumbs.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/apps/api/assets/fleet-go-live/fuel-card-photos"
dst="$root/apps/api/assets/fleet-go-live/fuel-card-photo-thumbs"
params='-auto-orient -strip -resize 160x160> -blur 0x1.2 -quality 55 -sampling-factor 4:2:0 -interlace none'

command -v convert >/dev/null || { echo 'ImageMagick (convert) is required' >&2; exit 1; }
mkdir -p "$dst"
find "$dst" -maxdepth 1 -type f \( -name '*.jpg' -o -name 'manifest.json' \) -delete

entries=()
for photo in "$src"/*.jpg; do
  name="$(basename "$photo")"
  # shellcheck disable=SC2086 # the parameters are words on purpose
  convert "$photo" $params "$dst/$name"
  read -r width height < <(identify -format '%w %h\n' "$dst/$name")
  sourceBytes="$(stat -c %s "$photo")"
  sourceSha256="$(sha256sum "$photo" | cut -d' ' -f1)"
  thumbBytes="$(stat -c %s "$dst/$name")"
  entries+=("    \"$name\": { \"sourceBytes\": $sourceBytes, \"sourceSha256\": \"$sourceSha256\", \"thumbBytes\": $thumbBytes, \"width\": $width, \"height\": $height }")
done

{
  printf '{\n  "version": 1,\n  "params": "%s",\n  "files": {\n' "$params"
  last=$((${#entries[@]} - 1))
  for i in "${!entries[@]}"; do
    if [ "$i" -lt "$last" ]; then printf '%s,\n' "${entries[$i]}"; else printf '%s\n' "${entries[$i]}"; fi
  done
  printf '  }\n}\n'
} >"$dst/manifest.json"

# The repository's own formatting, so a re-run of an unchanged folder changes no committed byte.
(cd "$root" && npx --no-install prettier --write "$dst/manifest.json" >/dev/null)

echo "made ${#entries[@]} thumbnails in $dst"
