#!/bin/sh
# Build here, ship there, switch over.
#
#   deploy/deploy.sh pallet@pallets.example.com
#
# Each deploy is its own folder under /opt/pallet-spec/releases, and `current`
# is a link to the one in use. Rolling back is pointing the link at the
# previous folder and restarting — nothing is overwritten in place.
#
# The pallet user needs one sudo rule for the restart; see deploy/README.md.
set -eu

TARGET="${1:?usage: deploy/deploy.sh user@host}"
ROOT=/opt/pallet-spec
SHA=$(git rev-parse --short HEAD)
STAMP=$(date -u +%Y%m%d-%H%M%S)
RELEASE="$ROOT/releases/$STAMP-$SHA"

npm run build
npm run build:server

ssh "$TARGET" "mkdir -p '$RELEASE'"
rsync -az --delete dist/ "$TARGET:$RELEASE/dist/"
rsync -az --delete config/ "$TARGET:$RELEASE/config/"
rsync -az --delete deploy/ "$TARGET:$RELEASE/deploy/"
rsync -az package.json package-lock.json "$TARGET:$RELEASE/"

ssh "$TARGET" "
  set -eu
  cd '$RELEASE'
  npm ci --omit=dev --no-audit --no-fund
  ln -sfn '$RELEASE' '$ROOT/current'
  sudo systemctl restart pallet-spec
  sleep 3
  curl -fsS http://127.0.0.1:5179/healthz
  echo
"
echo "Deployed $RELEASE"
