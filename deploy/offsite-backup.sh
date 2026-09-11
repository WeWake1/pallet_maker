#!/bin/sh
# Copy the whole data folder off the machine with restic, keep a sensible
# history, and say so to whatever is listening for it.
#
# The variables come from /etc/pallet-spec/env and /etc/pallet-spec/restic.env
# (see the .example files beside this script). Run by pallet-spec-offsite.timer.
set -eu

restic backup "$PALLET_DATA_ROOT" --tag pallet-spec --quiet
restic forget --keep-daily 30 --keep-weekly 12 --keep-monthly 12 --prune --quiet

if [ -n "${HEALTHCHECK_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" > /dev/null || true
fi
