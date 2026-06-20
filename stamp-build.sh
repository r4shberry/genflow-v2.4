#!/usr/bin/env bash
# stamp-build.sh — write the current date + short git hash into js/core/pb-core.js
# Run this right before committing/deploying:
#     ./stamp-build.sh && git add -A && git commit -m "deploy" && git push
#
# It replaces the PB.BUILD placeholder so the footer shows e.g.
#     v2.1 · 2026-06-20 a1b2c3d
# which lets you confirm at a glance that GitHub Pages actually served the
# new build (directly fixes the "saving locally != deployed" + cache gotcha).
set -e
STAMP="$(date +%Y-%m-%d) $(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
# Reset any previous stamp back to the placeholder, then set the new one.
sed -i.bak -E "s/PB\.BUILD = '[^']*';/PB.BUILD = '__BUILD__';/" js/core/pb-core.js
sed -i.bak -E "s/PB\.BUILD = '__BUILD__';/PB.BUILD = '${STAMP}';/" js/core/pb-core.js
rm -f js/core/pb-core.js.bak
echo "Stamped build: ${STAMP}"
