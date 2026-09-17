# Running Pallet Spec on a server

One Linux virtual machine, one process, Caddy in front for HTTPS. Written for
an Azure VM running Debian 12; any Debian box is the same from step 2 on.

## 1. The machine (Azure)

- **VM**: Debian 12 (Gen2 image), size **B2als_v2** — 2 vCPU, 4 GiB, about
  $18 a month (B2ls_v2 is the same on Intel for twice the price; B2as_v2 is
  8 GiB and more than this needs). Region Central India for users in India.
  Chromium is the only heavy thing on it. To start on the 1 GiB B2ats_v2
  instead, see 1a.
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

### 1a. Starting on the 1 GiB machine (B2ats_v2, about $4.50)

Sized honestly the server wants 4 GiB, but at one or two companies it can be
tried on 1 GiB first, and moving up later is *stop the VM → Size → start*, five
minutes, nothing on the disk touched. What makes 1 GiB survivable is that only
Chromium is big — the measured shape is about 100 MB of Node, 120 MB of idle
Chromium, and a further 150–250 MB per sheet while it prints — so one sheet at
a time fits, two at once do not, and a swap file catches the spikes.

Three things differ from the 4 GiB recipe:

1. **A swap file**, because the image ships with none and this size has no
   temp disk to put one on. On the OS disk, once, as root:

   ```sh
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   echo 'vm.swappiness=10' > /etc/sysctl.d/90-swap.conf && sysctl --system
   ```

   Swap on a Standard SSD is slow, so it is a net, not a floor: a print that
   lands in swap takes seconds longer, it does not fail.

2. **One sheet at a time**: `PALLET_PRINT_CONCURRENCY=1` in `/etc/pallet-spec/env`.
   A second print waits its turn (up to 20 wait; beyond that the server says
   503, try again in a moment) rather than starting a second Chromium.

3. **A lower ceiling for the service**, so a Chromium that leaks is restarted
   rather than allowed to push sshd and Caddy out. `systemctl edit pallet-spec`
   and put in the drop-in:

   ```ini
   [Service]
   MemoryMax=700M
   ```

   (The unit file's own 2500M is for the 4 GiB machine; a drop-in overrides it
   without editing the shipped file.) Then `systemctl daemon-reload && systemctl restart pallet-spec`.

**How to know whether it is coping.** After a normal day, or after opening five
sheets in a row from two laptops:

- `free -m` — `available` should stay above about 150 MB and `Swap used` below
  a few hundred; swap climbing every day means something leaks.
- `journalctl -k | grep -i -E 'out of memory|oom'` — must be empty. One line here
  is the signal to move to 4 GiB; do not tune around it.
- `curl -s https://pallets.example.com/healthz` — `printer.launches` should be
  1; it counts Chromium restarts, so a climbing number is Chromium being killed.
- A sheet that took under two seconds on a laptop taking more than ten here is
  swap doing the work.

When any of these turn bad, resize. The `env` value and the drop-in can stay
as they are on the bigger machine; set concurrency back to 2 and remove the
drop-in (`rm /etc/systemd/system/pallet-spec.service.d/override.conf`) to use
what was paid for.

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
then `sudo systemctl reload caddy`. Nothing stands in front of the server:
it asks who is signing in itself, and every route that touches a design is
behind that.

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

## 7a. The first company, and the first people

Nobody can sign in until somebody is invited, and nobody is invited until
there is a company. Both are made with `pallet-tenant`, run as the service
user with the same environment the server has:

```sh
cd /opt/pallet-spec/current
sudo -u pallet env $(grep -v '^#' /etc/pallet-spec/env | xargs) node dist/server/tenant.mjs \
  create --slug ambica --name "Ambica Patterns India Pvt Ltd" \
         --timezone Asia/Kolkata --admin office@ambica.example
```

It prints a link. Send that to the person: they follow it, choose a password,
and are signed in. **No password is ever set by an administrator**, so there is
never one to read out over the phone or leave in a chat. The link works once
and lasts a week.

The short name is what the company's folder is called, so it is permanent —
renaming one would leave its designs behind under the old name. The command
makes the folder, so its branding and prices can be put in place before
anybody signs in:

```
/var/lib/pallet-spec/tenants/ambica/brand.json     its name, logo and conventions
/var/lib/pallet-spec/tenants/ambica/brand/         the logo and font those name
/var/lib/pallet-spec/tenants/ambica/rates.json     its prices
/var/lib/pallet-spec/tenants/ambica/designs/       one file per design
```

In practice only one command is needed, once: your own account.

```sh
node dist/server/tenant.mjs vendor-admin --email you@example.com
```

Follow the link it prints, choose a password, and everything after that is on
screen: making companies, inviting their first administrator, setting up their
branding and prices, suspending one. The other commands stay for a shell when
that is more convenient:

```sh
node dist/server/tenant.mjs list                                   # every company
node dist/server/tenant.mjs users --company ambica                 # who is in one
node dist/server/tenant.mjs invite --company ambica --email x@y --role member
node dist/server/tenant.mjs reset --email x@y                      # a way back in
node dist/server/tenant.mjs suspend --company ambica               # signs them out too
node dist/server/tenant.mjs resume --company ambica
```

## 8. Ambica's designs onto the server

Until the migration tool lands, the way in is the library file: in the desktop
app, **Export library**, then on the server, signed in as somebody at Ambica,
**Import library**. The nightly snapshot keeps copies of it from then on.
