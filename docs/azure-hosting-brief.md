# Hosting Pallet Spec on Azure — briefing for an assistant

*Written 18 September 2026. Hand this to any chatbot or person helping with the deployment. It is self-contained: every command needed is in here, and the reasons behind each choice are stated so the helper can adapt rather than guess.*

---

## 1. Who is asking, and what the situation is

- The person deploying is a **student** with an **Azure for Students** subscription (about **US$100 of credit, valid 12 months**; when it runs out Azure *stops* the resources, it does not bill). They are also the developer of the software. They are comfortable in a terminal but have **not run a Linux server before**, so explain in plain terms, one step at a time, and say what "done" looks like after each step.
- The software is used today by **one company — Ambica Patterns (India) Pvt. Ltd.**, a pallet manufacturer in India, about four people — and is being turned into a product that **one or two other pallet manufacturers** will also use. So: very few users, no traffic to speak of.
- Users are in **India** → Azure region **Central India**.
- The developer's own machine is a **Mac** (zsh). All "from your own machine" commands are macOS.

## 2. What the software is

**Pallet Spec** — a web application that lets a pallet manufacturer design a wooden pallet (dimensions, boards, blocks, nails, notched runners, etc.), keep a library of designs per client, and print a one-page **specification sheet as a PDF** (also SVG/DXF). Think "CAD-lite" for a pallet factory.

**Technology, and what it means for hosting:**

| Piece | What it is | Hosting implication |
|---|---|---|
| Server | **Node.js** (24 LTS) + Express, one process, TypeScript bundled to `dist/server/main.mjs` | Needs Node 24. Listens on `127.0.0.1:5179` only; a reverse proxy in front. |
| Front end | React/Vite single-page app, built to `dist/editor/`, served by the same Node process | Nothing separate to host. |
| Data | **Plain JSON files on disk**, one file per design, one folder per company. A small **SQLite** registry (`node:sqlite`, built into Node — no native build) for companies, users, sessions, invitations. | **No database server.** Everything lives under one folder, `PALLET_DATA_ROOT` = `/var/lib/pallet-spec`. Today's whole dataset is **~6 MB**. |
| PDF printing | The server launches a headless **Chromium** (via `puppeteer-core`) to render the sheet to PDF. It keeps **one long-lived Chromium** and prints N sheets at a time (N = `PALLET_PRINT_CONCURRENCY`, default 2). | **This is the only heavy thing.** ~120 MB idle Chromium + ~150–250 MB per sheet while it prints. Needs the Debian `chromium` package (not Ubuntu's snap). |
| HTTPS | **Caddy** as reverse proxy; gets and renews a Let's Encrypt certificate by itself | Needs a public hostname and ports 80/443 open. |
| Login | Built in: email + password, **invitation-only**. Admins never set passwords; they send a one-time link and the person chooses their own. | No external auth service. Cookies are `Secure`, so `PALLET_PUBLIC_URL` must be `https://…`. |
| Multi-company | One process serves every company. Each company ("tenant") has its own folder `/var/lib/pallet-spec/tenants/<slug>/` with `designs/` and `brand.json` (name, logo, font). Who sees which folder is decided by who is logged in. | One VM, one process, for all customers. |
| Backups | The server itself snapshots every company's library **nightly at 02:00** (server time, UTC) into its folder. A systemd timer at **03:00** copies the whole data folder off the machine with **restic** to an **Azure Storage blob container**, encrypted. | Needs one storage account + container + its access key. |
| Deploy | `deploy/deploy.sh user@host` run **from the Mac**: builds, rsyncs into `/opt/pallet-spec/releases/<stamp-sha>/`, `npm ci --omit=dev` there, flips the `current` symlink, restarts the service, curls `/healthz`. Rollback = point the symlink back. | Needs SSH as the `pallet` user with a sudo rule for exactly one command. |
| Health | `GET /healthz` → JSON, 503 if the data folder or printer is unwell. Includes `printer.launches` (how many times Chromium was started — more than 1 means one died). | Point an uptime monitor at it. |

**Decisions already taken — do not re-open them:**

- **A plain Linux VM**, not App Service, not containers, not Kubernetes. The server wants Chromium and a folder on a disk; a VM gives both plainly.
- **Debian 12 (Gen2 image)**, not Ubuntu. Ubuntu's Chromium is a snap and does not run headless under systemd without a fight.
- **One shared server for all companies**, folder per company.
- **Invitation-only email login**, no OAuth, no third-party identity provider.
- Everything the software needs is already written and committed; **there is no application code to write for this deployment**. The job is: create the VM, install packages, copy config, run the deploy script, create the first accounts.

## 3. The VM size decision (and the deliberate trial on 1 GiB)

Correct sizing is **B2als_v2 — 2 vCPU, 4 GiB, ~$17.96/month** in Central India (B2ls_v2 is the same spec on Intel at ~$32.70 — no benefit; B2as_v2 is 8 GiB / ~$35.92 — more than needed for years).

**The developer has decided to try the cheapest size first: B2ats_v2 — 2 vCPU, 1 GiB, ~$4.49/month.** The risk is understood: RAM, not CPU, not users. With one sheet printing at a time the measured footprint (~100 MB Node + ~120 MB idle Chromium + ~150–250 MB for the sheet + ~200 MB Debian + ~30 MB Caddy) fits in 1 GiB; two sheets at once do not. Three adjustments make it survivable, all below: a **2 GB swap file**, **`PALLET_PRINT_CONCURRENCY=1`**, and a **`MemoryMax=700M`** ceiling on the service so a leaking Chromium restarts itself instead of starving SSH.

If it does not cope, moving up is: **portal → VM → Stop → Size → B2als_v2 → Start.** About five minutes; the disk and data are untouched. Signs that it is not coping are in §8. **Do not talk the developer out of the 1 GiB trial; help it succeed, and help them recognise when to resize.**

All B-series sizes are "burstable": a small guaranteed CPU share with credits banked while idle and spent during a print. That is the right family for a server idle most of the day.

## 4. Cost

| Item | USD / month | Notes |
|---|---|---|
| VM B2ats_v2 | 4.49 | Later B2als_v2 = 17.96 |
| OS disk, 30 GiB Standard SSD | ~2.50 | Holds OS, Node, Chromium, app **and** the data — 6 MB today |
| Static public IP (Standard SKU) | ~3.65 | A hostname must keep pointing at the box |
| Storage account (backups, LRS) | < 0.10 | A few MB |
| Bandwidth | 0 | First 100 GB/month out is free |
| Data disk | 0 | Skipped for the trial; the off-site backup is the safety net |
| Domain | 0 | Azure's free DNS label `<name>.centralindia.cloudapp.azure.com`; buy a real domain (~$10/yr) once clients are on it |
| **Total** | **≈ 10.75** | **$100 ≈ 9 months** (≈ 4 months on the 4 GiB size) |

## 5. Names used below — replace consistently

| Placeholder | Meaning | Example used here |
|---|---|---|
| `HOST` | the VM's public hostname | `ambica-pallets.centralindia.cloudapp.azure.com` |
| `STORAGE` | storage account name (globally unique, lowercase) | `palletspecbackups7` |
| `<your email>` | the developer's email, becomes the vendor (super-admin) account | — |

The VM's admin user is `azureuser` (key login). The application runs as a separate system user `pallet`.

## 6. Step by step

### Part A — Azure portal (~20 min)

**A1. Create the VM.** Home → Virtual machines → Create → *Azure virtual machine*.

- **Basics**: Resource group → *Create new* → `pallet-spec`. Virtual machine name `pallet-spec`. Region **Central India**. Image → *See all images* → search **Debian 12** → choose **Debian 12 "Bookworm" – x64 Gen2**. Size → *See all sizes* → **B2ats_v2**. Authentication type **SSH public key**, username `azureuser`, SSH key source *Generate new key pair*, key pair name `pallet-spec`. Public inbound ports → *Allow selected ports* → **SSH (22), HTTP (80), HTTPS (443)**.
- **Disks**: OS disk type **Standard SSD (locally-redundant)**, size 30 GiB (default). No data disks.
- **Networking**: Public IP → *Create new* → SKU **Standard**, Assignment **Static**. Leave the rest at defaults.
- **Review + create** → **Create**. A popup *Generate new key pair* appears: click **Download private key and create resource**. The file `pallet-spec.pem` is offered **once only**.

**A2. Hostname.** VM → Overview → *DNS name* → click *Not configured* → DNS name label `ambica-pallets` → Save. The address is now `ambica-pallets.centralindia.cloudapp.azure.com` (= `HOST`).

**A3. Storage account for backups.** Home → Storage accounts → Create. Resource group `pallet-spec`, name `STORAGE`, region Central India, Performance **Standard**, Redundancy **LRS**. Create. Inside it: *Data storage → Containers → + Container* → name `pallet-spec-backups` → Create. Then *Security + networking → Access keys → key1 → Show → copy Key.* Keep account name and key for C4.

Done looks like: VM shows *Running* with a public IP; `nslookup HOST` from the Mac returns that IP; the container exists.

### Part B — On the Mac (~5 min)

```sh
mv ~/Downloads/pallet-spec.pem ~/.ssh/ && chmod 600 ~/.ssh/pallet-spec.pem
cat >> ~/.ssh/config <<'EOF'
Host ambica-pallets.centralindia.cloudapp.azure.com
  IdentityFile ~/.ssh/pallet-spec.pem
EOF
ssh azureuser@HOST      # answer "yes" to the fingerprint question; a Debian prompt appears
exit
cd ~/VSC/pallet_maker   # the repository
scp -r deploy azureuser@HOST:~/
```

Done looks like: `ssh azureuser@HOST 'ls ~/deploy'` lists `Caddyfile deploy.sh env.example …`.

### Part C — On the VM as `azureuser` (~25 min)

`ssh azureuser@HOST`, then in order.

**C1. Swap file** (the image ships with none; this VM size has no temp disk):

```sh
sudo -i
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/90-swap.conf && sysctl --system
exit
free -m
```

Done: the `Swap:` line shows `2047` total.

**C2. Packages:**

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
# Fonts: the sheet asks for Helvetica; Liberation Sans has the same widths
sudo cp ~/deploy/fonts-local.conf /etc/fonts/local.conf
node -v && chromium --version && caddy version
```

Done: three version lines print (Node v24.x).

**C3. The service user, folders, its SSH key, and its one sudo rule:**

```sh
sudo useradd --system --create-home --home-dir /var/lib/pallet-spec/home --shell /bin/bash pallet
sudo mkdir -p /opt/pallet-spec/releases /var/lib/pallet-spec /etc/pallet-spec
sudo chown -R pallet:pallet /opt/pallet-spec /var/lib/pallet-spec
sudo cp ~/deploy/env.example /etc/pallet-spec/env
sudo cp ~/deploy/restic.env.example /etc/pallet-spec/restic.env
sudo chown root:pallet /etc/pallet-spec/*; sudo chmod 640 /etc/pallet-spec/*

# deploy.sh logs in as "pallet": give it the same key azureuser uses
sudo install -d -m 700 -o pallet -g pallet /var/lib/pallet-spec/home/.ssh
sudo install -m 600 -o pallet -g pallet ~/.ssh/authorized_keys /var/lib/pallet-spec/home/.ssh/authorized_keys

# the only root command the pallet user may run
echo 'pallet ALL=(root) NOPASSWD: /usr/bin/systemctl restart pallet-spec' | sudo tee /etc/sudoers.d/pallet-spec
sudo chmod 440 /etc/sudoers.d/pallet-spec
```

Done: from the Mac, `ssh pallet@HOST 'whoami'` prints `pallet`.

**C4. The two environment files.** These hold secrets and are never in the repository.

`sudo nano /etc/pallet-spec/env` — the file already has every key with comments; change these three:

```
SESSION_SECRET=<output of: openssl rand -hex 32>
PALLET_PUBLIC_URL=https://HOST
PALLET_PRINT_CONCURRENCY=1
```

Leave `PALLET_DATA_ROOT=/var/lib/pallet-spec`, `PALLET_BROWSER=/usr/bin/chromium`, `HOST=127.0.0.1`, `PORT=5179`, `PALLET_BACKUPS=30`, `NODE_ENV=production` as they are.

`sudo nano /etc/pallet-spec/restic.env`:

```
RESTIC_REPOSITORY=azure:pallet-spec-backups:/
AZURE_ACCOUNT_NAME=STORAGE
AZURE_ACCOUNT_KEY=<key1 from A3>
RESTIC_PASSWORD=<output of: openssl rand -hex 24>
HEALTHCHECK_URL=
```

**The `RESTIC_PASSWORD` must be written down somewhere that is not this VM** (a password manager). It encrypts the backups; lose it and they are unreadable.

**C5. Caddy (HTTPS):**

```sh
sudo cp ~/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i "s/pallets.example.com/HOST/" /etc/caddy/Caddyfile     # literal hostname, not the word HOST
sudo systemctl reload caddy
sudo journalctl -u caddy -n 20 --no-pager
```

Done: the log shows `certificate obtained successfully` for the hostname. (The Caddyfile is: the hostname block, `encode zstd gzip`, `request_body max_size 70MB`, `reverse_proxy 127.0.0.1:5179` with a 90 s read timeout.) If it instead reports it cannot obtain a certificate for the `cloudapp.azure.com` name, the fix is a bought domain with an A record to the static IP — not a self-signed certificate.

**C6. The service, the off-site timer, and the 1 GiB ceiling:**

```sh
sudo cp ~/deploy/pallet-spec.service ~/deploy/pallet-spec-offsite.service ~/deploy/pallet-spec-offsite.timer /etc/systemd/system/
sudo mkdir -p /etc/systemd/system/pallet-spec.service.d
printf '[Service]\nMemoryMax=700M\n' | sudo tee /etc/systemd/system/pallet-spec.service.d/override.conf
sudo systemctl daemon-reload
sudo systemctl enable --now pallet-spec-offsite.timer
sudo systemctl enable pallet-spec
exit
```

The service unit runs `/usr/bin/node dist/server/main.mjs` from `/opt/pallet-spec/current` as `pallet`, reads `/etc/pallet-spec/env`, `Restart=on-failure`, is sandboxed (`ProtectSystem=strict`, `ReadWritePaths=/var/lib/pallet-spec`, `PrivateTmp=yes`), and its own `MemoryMax=2500M` is for a 4 GiB machine — the drop-in overrides it. The service is **not started yet**: nothing is in `/opt/pallet-spec/current` until the first deploy.

### Part D — First deploy, from the Mac (~5 min)

```sh
cd ~/VSC/pallet_maker
deploy/deploy.sh pallet@HOST
```

It runs `npm run build` and `npm run build:server` locally, rsyncs `dist/ config/ deploy/ package.json package-lock.json` to a new release folder, runs `npm ci --omit=dev` there, flips the symlink, restarts the service and prints the `/healthz` JSON. Then from anywhere:

```sh
curl https://HOST/healthz
```

Done: JSON with `"ok": true` and a `printer` block; opening `https://HOST` in a browser shows the sign-in page. The very first HTTPS request can take ~10 s.

If the deploy fails at `npm ci`: on 1 GiB it can be slow; re-run once. If it fails at `curl … /healthz`: `ssh azureuser@HOST 'sudo journalctl -u pallet-spec -n 50 --no-pager'` shows why — almost always a wrong value in `/etc/pallet-spec/env` (the server refuses to start and says which one).

### Part E — Accounts, backup proof, data (~15 min)

**E1. The vendor (super-admin) account — on the VM:**

```sh
cd /opt/pallet-spec/current
sudo -u pallet env $(grep -v '^#' /etc/pallet-spec/env | xargs) node dist/server/tenant.mjs vendor-admin --email <your email>
```

It prints a one-time link (valid a week). Open it, choose a password, and you are signed in as the vendor. **Everything after this is on screen**: create the company (slug `ambica`, name `Ambica Patterns India Pvt Ltd`, timezone `Asia/Kolkata`), invite its people (they get a link, choose their own password), upload its logo. People and branding are the vendor's alone — nobody at a company has any settings. The slug is permanent (it is the folder name).

Shell equivalents exist for a helper who prefers them: `tenant.mjs create --slug ambica --name "…" --timezone Asia/Kolkata --invite <email>`, `invite --company ambica --email <x>`, `reset --email <x>`, `list`, `users --company ambica`, `suspend|resume --company ambica` — all with the same `sudo -u pallet env $(…) node dist/server/tenant.mjs` prefix.

**E2. Off-site backup — initialise once, then prove it:**

```sh
sudo -u pallet sh -c '. /etc/pallet-spec/restic.env; export RESTIC_REPOSITORY AZURE_ACCOUNT_NAME AZURE_ACCOUNT_KEY RESTIC_PASSWORD; restic init'
sudo systemctl start pallet-spec-offsite.service
sudo -u pallet sh -c '. /etc/pallet-spec/restic.env; export RESTIC_REPOSITORY AZURE_ACCOUNT_NAME AZURE_ACCOUNT_KEY RESTIC_PASSWORD; restic snapshots'
```

Done: one snapshot listed. It now runs nightly at 03:00 UTC (08:30 IST); `systemctl list-timers` shows the next run.

**E3. Ambica's existing designs.** **Export library** from wherever they are now (one JSON file). On the server, signed in as an Ambica user: **Import library**. Do this before the last desktop copy is retired — it is the only thing that can still export.

**E4. The 1 GiB printer test.** Open four or five sheets as PDF one after another (two people at once if possible), then on the VM:

```sh
free -m                                                # "available" > ~150 MB, swap used small
sudo journalctl -k | grep -i -E 'out of memory|oom'    # must print NOTHING
curl -s https://HOST/healthz                           # printer.launches should be 1
```

## 7. What the helper must not do

- Do not switch the image to Ubuntu, or the plan to App Service / Docker / Kubernetes / a managed database. See §2 decisions.
- Do not set or reset anyone's password by hand or paste one in a chat; the software only ever issues one-time links.
- Do not put `SESSION_SECRET`, the storage key, or `RESTIC_PASSWORD` into the repository, a chat, or a file inside `/opt/pallet-spec`. They live only in `/etc/pallet-spec/*` (mode 640 root:pallet) and, for the restic password, the developer's password manager.
- Do not open ports other than 22, 80, 443. The Node process listens on loopback only; Caddy is the only door.
- Do not `git clone` the repository on the VM. Deploys come from the Mac through `deploy.sh`; the VM only holds built releases.
- Do not add a nightly backup timer for the library: the server does that itself at 02:00. The only timer is the off-site copy.
- Do not "fix" an out-of-memory kill by tuning swap or the ceiling further. One OOM line means: resize to B2als_v2.

## 8. Looking after it, and when to resize

- Logs: `sudo journalctl -u pallet-spec -f` (one JSON line per request; a 500 carries a request id the user also saw). Caddy: `sudo journalctl -u caddy -f`.
- Redeploying after a code change: `deploy/deploy.sh pallet@HOST` from the Mac. Rollback: `ln -sfn /opt/pallet-spec/releases/<older> /opt/pallet-spec/current && sudo systemctl restart pallet-spec`.
- Uptime: point a free monitor (e.g. UptimeRobot) at `https://HOST/healthz`.
- Once a quarter, prove a restore: `restic restore latest --target /tmp/restore`, then — because `registry.sqlite` restored from a live copy can be mid-write — `cp $(ls -t /tmp/restore/var/lib/pallet-spec/registry-backups/*.sqlite | head -1) /tmp/restore/var/lib/pallet-spec/registry.sqlite` to drop in the clean nightly snapshot before starting anything. Then `PALLET_DATA_ROOT=/tmp/restore/var/lib/pallet-spec PORT=5999 node dist/server/main.mjs` and open `http://127.0.0.1:5999/healthz`. This is the same swap a real emergency needs, so the drill should exercise it too, not just the folder restore.
- **Resize triggers** (any one is enough): an `oom` line in `journalctl -k`; `printer.launches` in `/healthz` climbing; swap used growing day over day in `free -m`; a sheet taking more than ~10 s that takes ~2 s on a laptop.
- **How to resize**: portal → VM → **Stop** → *Size* → **B2als_v2** → **Start** (≈5 min, nothing on disk changes). Then on the VM: set `PALLET_PRINT_CONCURRENCY=2` in `/etc/pallet-spec/env`, `sudo rm /etc/systemd/system/pallet-spec.service.d/override.conf`, `sudo systemctl daemon-reload && sudo systemctl restart pallet-spec`. The swap file can stay.
- When Azure credit ends: the subscription is disabled and the VM stops; nothing is deleted for a grace period. Upgrading to pay-as-you-go keeps everything as is at ≈ $11 (1 GiB) or ≈ $24 (4 GiB) a month.

## 9. Where things are on the VM (reference)

```
/opt/pallet-spec/current -> releases/<stamp-sha>/   the running build (dist/, config/, deploy/, node_modules/)
/var/lib/pallet-spec/                               PALLET_DATA_ROOT — everything that must be backed up
  registry.sqlite                                   companies, users, sessions, invitations
  registry-backups/                                 the server's own nightly clean copies of the registry (restore from here, not registry.sqlite)
  tenants/<slug>/designs/*.json, clients.json       one company's designs and its client list
  tenants/<slug>/brand.json, brand/                 its name, logo and font
  tenants/<slug>/backups/                           the server's own nightly snapshots
  home/                                             the pallet user's home (Chromium profile, ssh key)
/etc/pallet-spec/env, restic.env                    configuration and secrets (640 root:pallet)
/etc/caddy/Caddyfile                                HTTPS + reverse proxy
/etc/systemd/system/pallet-spec.service(.d/)        the service and the 1 GiB drop-in
/etc/systemd/system/pallet-spec-offsite.{service,timer}   nightly restic copy to Azure blob
/swapfile                                           2 GB swap
```
