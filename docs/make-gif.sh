#!/usr/bin/env bash
# Rebuilds docs/demo.gif from docs/demo.mp4: two passes, so the 256-colour palette
# is chosen from this video's own frames instead of a generic one.
#   bash docs/make-gif.sh [fps] [width]        defaults: 30 fps, 960 px wide
# GIF stores each frame's delay in hundredths of a second, so 25 fps (4cs) and 30 fps
# (3.33cs, alternating 3 and 4) are the clean choices; 24 would play at 25.
set -euo pipefail
cd "$(dirname "$0")"
FPS="${1:-30}"
WIDTH="${2:-960}"
PALETTE="$(mktemp -t poc-palette).png"
FILTERS="fps=${FPS},scale=${WIDTH}:-1:flags=lanczos"
ffmpeg -v error -y -i demo.mp4 -vf "${FILTERS},palettegen=stats_mode=diff:max_colors=200" "$PALETTE"
ffmpeg -v error -y -i demo.mp4 -i "$PALETTE" \
  -lavfi "${FILTERS}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 demo.gif
rm -f "$PALETTE"
ls -l demo.gif
