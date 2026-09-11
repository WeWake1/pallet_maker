# Running Pallet Spec on a server

One Linux virtual machine, one process, Caddy in front for HTTPS. Written for
an Azure VM running Debian 12; any Debian box is the same from step 2 on.

## 1. The machine (Azure)

- **VM**: Debian 12 (Gen2 image), size B2s or B2as v2 — 2 vCPU, 4 GiB. Region
  Central India for users in India. Chromium is the only heavy thing on it.
- **Networking**: a static public IP; a DNS `A` record for the name you will
  use (the Caddyfile below says `pallets.example.com`); the network security
  group allows inbound 22, 80 and 443 only.
- **Disks**: a small data disk (32 GB Standard SSD is plenty) mounted at
  `/var/lib/pallet-spec`, so the designs survive the VM being rebuilt. Turn on
  Azure's VM backup as well if you like; it is a second net, not the first.
- **Backups off the machine**: a storage account with one blob container,
  `pallet-spec-backups`. restic writes to it (step 6).

Avoid App Service and containers for this: the server wants Chromium and a
folder on a disk, which a VM gives it plainly. Avoid the Ubuntu image: its
Chromium is a snap, and snaps do not run headless under systemd without a fight.

## 2. Packages

```sh
sudo apt update
sudo apt install -y chromium fonts-liberation fonts-dejavu-core restic curl rsync
# Node 24 LTS (Debian's own nodejs is too old)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
# Caddy, from Caddy's repository rather than Debian's older one
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Fonts: copy `deploy/fonts-local.conf` to `/etc/fonts/local.conf` so the
sheet's Helvetica lands on Liberation Sans, which has the same widths.

## 3. The user and the folders

```sh
sudo useradd --system --create-home --home-dir /var/lib/pallet-spec/home --shell /bin/bash pallet
sudo mkdir -p /opt/pallet-spec/releases /var/lib/pallet-spec /etc/pallet-spec
sudo chown -R pallet:pallet /opt/pallet-spec /var/lib/pallet-spec
sudo cp deploy/env.example /etc/pallet-spec/env          # then edit it
sudo cp deploy/restic.env.example /etc/pallet-spec/restic.env   # then edit it
sudo chown root:pallet /etc/pallet-spec/*; sudo chmod 640 /etc/pallet-spec/*
```

The deploy script restarts the service, so give the pallet user that one
command and nothing else: `sudo visudo -f /etc/sudoers.d/pallet-spec` with

```
pallet ALL=(root) NOPASSWD: /usr/bin/systemctl restart pallet-spec
```

## 4. Caddy

Copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile`, put the real host name in,
make a password hash with `caddy hash-password` and paste it in, then
`sudo systemctl reload caddy`. The shared password is the door until people
have logins of their own (roadmap phase 2). `/healthz` is outside it, for
whatever watches the server.

## 5. The service and the timers

```sh
sudo cp deploy/pallet-spec.service deploy/pallet-spec-backup.* deploy/pallet-spec-offsite.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pallet-spec-backup.timer pallet-spec-offsite.timer
sudo systemctl enable pallet-spec      # started by the first deploy
```

## 6. The first deploy, from your own machine

```sh
deploy/deploy.sh pallet@pallets.example.com
```

It builds the editor and the server, copies them into a dated release folder,
installs the production dependencies there, points `current` at it, restarts
the service, and asks `/healthz`. Then, from anywhere:

```sh
curl https://pallets.example.com/healthz
```

Rolling back is `ln -sfn /opt/pallet-spec/releases/<older one> /opt/pallet-spec/current`
and `sudo systemctl restart pallet-spec`.

Before the first backup, make the restic repository once, as the pallet user:

```sh
sudo -u pallet sh -c '. /etc/pallet-spec/restic.env; export RESTIC_REPOSITORY AZURE_ACCOUNT_NAME AZURE_ACCOUNT_KEY RESTIC_PASSWORD; restic init'
```

## 7. Looking after it

- `journalctl -u pallet-spec -f` shows one JSON line per request and the
  server's own messages; a 500 carries a request id that the person saw too.
- `systemctl list-timers` shows when the snapshot and the off-site copy last
  ran and next run. `restic snapshots` lists what is off the machine.
- Point an uptime monitor at `/healthz`; it answers 503 when the designs cannot
  be reached or the printer is unwell.
- **Do a restore once a quarter.** `restic restore latest --target /tmp/restore`,
  then run the server against it: `PALLET_DATA_ROOT=/tmp/restore/var/lib/pallet-spec PORT=5999 node dist/server/main.mjs`
  and open `http://127.0.0.1:5999/healthz` and the dashboard. A backup nobody
  has restored is a hope, not a backup.

## 8. Ambica's designs onto the server

Until roadmap phase 4 (companies and a migration tool), the way in is the
library file: in the desktop app, **Export library**, then on the server, from
the editor, **Import library**. The startup backup and the nightly snapshot
keep copies of it from then on.
