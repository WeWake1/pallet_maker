# From one company's tool to a product

*Report and guide, 10 September 2026. What in this program is specific to Ambica Patterns, what selling it to other pallet manufacturers requires, and the roadmap for getting there.*

The pallet specification-sheet generator was built for Ambica Patterns (India) Pvt. Ltd. and works well there. The Electron packaging shipped but brought its own problems (unsigned installer, ARM64 emulation, Drive-sync mirroring, a folder chosen per machine), and the decision is to host the tool on a VPS instead. At the same time the owner wants to sell it to other pallet manufacturers. Two things follow:

1. Everything Ambica-specific — watermark, logo, font, company name, currency, units, defaults, help text, installer identity — has to become per-customer configuration.
2. Everything a single-company local tool never needed — accounts, login, one store per company, a server that prints PDFs on Linux, backups off the box, terms of service — has to exist before a second company's data goes onto the same server.

**Decisions taken on 10 September 2026:**

- **Hosting: one shared server, many companies.** One Node process on the VPS, one store folder per company, chosen by who is logged in. Ambica is company #1.
- **Login: email + password, invitation-only.** The vendor creates a company and its first admin; admins invite colleagues.
- **Logos: SVG and PNG/JPG both accepted.** Raster logos are embedded as an image; the "nothing raster in the outputs" rule is relaxed only for those companies.

This document has three parts: **(A)** the inventory of what is custom to Ambica, **(B)** what selling it takes beyond the code, and **(C)** the phased roadmap.

---

## A. What is custom to Ambica — the inventory

Everything below was found by reading the code, not guessed. **Bold** rows are user-visible or printed on the sheet. Line numbers are as of commit `74dc1e9` plus the uncommitted Electron changes.

### A1. Brand identity on the sheet (the thing every customer sees)

| What | Where | Note |
|---|---|---|
| **Company name — watermark text and logo `<title>`** | `src/brand/brand.ts:17` `COMPANY_NAME = 'Ambica Patterns India Pvt Ltd'` | The *only* programmatic copy in `src/`. Consumed by `src/sheet/sheet.ts:282,290` and `src/sheet/svgSheet.ts:112`. Also asserted literally by `tests/api.test.ts:226`. |
| Font family name `'Ambica Brand'` | `src/brand/brand.ts:23,26,31` | Checked by `tests/branding.test.ts:72` |
| **Font file, embedded base64 (31 kB) in every PDF** | `src/brand/assets.ts`, generated from the root `ITC Anna Regular.otf` by `src/brand/build.ts:29` | **ITC Anna is a licensed commercial typeface** (its name table reads "© 1993 Adobe Systems… ITC Anna is a trademark of ITC"). The `.otf` is git-tracked in a *public* repo. It cannot be shipped to other companies, and the repo copy should go too. |
| **Logo, hand-traced to two `<path>`s** | `src/brand/logo.ts:25-58` (`LOGO_COLOUR #5ca3ff`, triangle + P) | Measured by hand from the PNG; `logo.ts:14-22` says nothing reads the PNG. **A customer's logo cannot be dropped in as a file today** — a design decision, not a config key (see phase 1). |
| Logo PNG source, git-tracked, filename carries the company name | `Ambica Patterns (india) Pvt.Ltd..png` (repo root), referenced by `electron/main.ts:54` | |
| App icon = the same mark, three raster copies | `build/icon.png` (1024², installer + shipped resource), `assets/icons/icon.png` (512², dev window), the root PNG | Four representations of one logo, none derived from another |
| **Watermark tuning is tied to this font and this name length** | `src/sheet/layout.ts:104` `fontSize: 80` ("ITC Anna is condensed…"), `:115` `svgFontSize: 64` (measured for the Helvetica fallback) | A different name or face overruns or under-fills the diagonal; it has to become fit-to-diagonal rather than a fixed size |
| Logo footer band sized to a nearly-square mark | `src/sheet/layout.ts:24-33` `footerHeight: 12`, `:75-78` `LOGO.maxWidth: 24` | The HTML sheet ignores `maxWidth` (`sheet.ts:282` sets width from the aspect); a wide wordmark would overflow |

### A2. Product and installer identity

| What | Where |
|---|---|
| `appId: in.ambicapatterns.palletspec` (India TLD + company domain), `copyright: © Ambica Patterns (India) Pvt. Ltd.`, `productName: Pallet Spec`, `shortcutName: Pallet Spec` | `electron-builder.yml:16-18,57` |
| `author: Ambica Patterns (India) Pvt. Ltd.`, `name: pallet-spec-generator`, `repository: github.com/WeWake1/pallet_maker` | `package.json:2,58-62` |
| **Auto-update feed = the owner's personal public repo** `owner: WeWake1 / repo: pallet_maker` | `electron-builder.yml:71-75`, used by `electron/updates.ts` — every installed copy would phone home there |
| Product name in four spellings: `Pallet Spec` / `Pallet spec` / `Pallet specification generator` / `pallet-spec-generator` | `electron/main.ts:172`, `electron/updates.ts:43` (dialog), **`src/editor/App.tsx:442` (in-app header)**, **`src/editor/index.html:6` (tab title)**, `src/server/main.ts:64`, `src/store/settings.ts:17` (settings dir), `docs/guide.ts:28,34,239`, `src/cli/guide.ts:19,24` |
| Installer unsigned *because* "there are four users" | `electron-builder.yml:13`, `README.md:480-482` — the justification collapses for a sold product |

### A3. Locale, units, currency, rates

| What | Where | Note |
|---|---|---|
| **Currency default `INR`** — a rates file that omits the key silently means rupees | `src/costing/rates.ts:16` (schema default), `config/rates.json:2`; asserted by `tests/rates.test.ts:29,57` | Money is formatted by hand as `${currency} ${value.toFixed(2)}` (`src/editor/App.tsx:1697`, `src/cli/costing.ts:33`) — no `Intl.NumberFormat`, no symbol, no grouping |
| **Timber priced per CFT (cubic foot)** — the Indian trade unit, baked into the data shape | `src/costing/costing.ts:15` `MM3_PER_CFT`, `Rates.timberPerCft` (`rates.ts:17`), `MaterialLine.cft/ratePerCft`, **`App.tsx:1709,1733` prints "cft"**, `hints.ts:50,76` glossary ("the unit the yard quotes in") | A per-m³ or board-foot customer needs a unit setting in the schema, not just a label |
| **Ambica's real prices ship inside the installer** (pine 850 / hardwood 1400 / plywood 2200 INR per CFT; wire nail 900 per 1000; overhead 60 + 8 %) | `config/rates.json`, `electron-builder.yml:30-33` ("Sealed in: one set of prices that everybody quotes from") | |
| **Species defaults `pine`** (five places, one a visible placeholder) | `src/editor/templates.ts:128,192`, `src/editor/state.ts:92` (twice), **`App.tsx:1271` placeholder**, `hints.ts:44` | The schema itself is free text (`schema.ts:155`) — only the defaults are opinionated |
| **Nail type default `wire nail`** on every new nail row; panel material default `plywood` | `src/editor/state.ts:362`, `templates.ts:85`, `state.ts:221` | |
| **A4 landscape hardcoded**, dimensions in mm, loads in kg | `src/sheet/layout.ts:12-16` `PAGE`, `content.ts:179`, `sheet.ts:313` / `svgSheet.ts:310` "L × W × T (mm)" | No Letter/inch option |
| **`First-angle projection, all dimensions in mm`** on every sheet | `src/sheet/content.ts:69` `PROJECTION_NOTE` | European/Indian convention; US customers use third-angle |
| **Tolerances `± 2 mm` / `± 5 mm` on every sheet**, module-private, not configurable | `src/sheet/content.ts:65-66,242-243` | |
| Dates are ISO `YYYY-MM-DD` from `toISOString()` — **UTC, so in IST a save after 05:30 is stamped the previous day** | `src/ids.ts:14` `today()` | A latent bug, not just a locale item; printed in the title block and the filename |

### A4. Business-specific defaults and vocabulary

| What | Where | Note |
|---|---|---|
| **New pallet = 1200 × 800 block 4-way, 7 top boards, 3 centre boards, 3×3 blocks of 100³, 3 bottom boards, boards 100 × 18, planing none, name "1200 x 800"** | `src/editor/templates.ts:26-28,37,126-157,183-184` | The comment at `templates.ts:113-125` derives it from *Ambica's* library statistics; `docs/guide.ts:77-79` and `Help.tsx:35` repeat the statistics to the user |
| **Default handling = hand pallet truck + forklift** | `src/types.ts:92` `DEFAULT_HANDLING`, schema default `schema.ts:165`, `templates.ts:144,199`, restated in `docs/guide.ts:96`, `README.md:145` | Single-sourced constant, but not per-customer |
| **`AP-001` pallet-code convention shown as the input placeholder** | **`src/editor/App.tsx:1159`**, `docs/guide.ts:199`, `types.ts:272`; all 11 fixtures use `AP-0xx` codes and the editor lists fixtures in its "Start from an example" menu (`App.tsx:49-59,1094-1101`) | About 60 further `AP-` literals in tests (harmless) |
| **"Plywood type 1 / 2 / 3"** — Ambica's internal taxonomy printed on the sheet | `src/sheet/content.ts:35-43` `PALLET_TYPE`; the enum in `schema.ts:135-145` | |
| **"Centre boards"** for what much of the trade calls stringers or bearers | `src/sheet/components.ts:42-59` (the internal kind is `bearer`), `App.tsx:73` `LAYER_KINDS` | Shop-floor vocabulary |
| Handling labels `Hand pallet truck / Forklift / Crane / Conveyor / Manual lift`; layout sized for exactly five | `src/sheet/handling.ts:38-44`, `layout.ts:47-49` | |
| No revision block, no drawn-by / checked-by / approved-by, no confidentiality line | — | Absent rather than custom; a likely customer ask |
| Sheet-note convention "(old)" | `hints.ts:49` | |

### A5. Real customer data on disk

`data/library/clients.json` holds 14 real Ambica customers (Aditya Auto ×3, Biocon ×3, Reitzel, Ardex, Carl Becham, Somerset, Vibonum, Rathna, BOCPINEWD, INDAUTO) and `data/library/designs/` holds 30 of their designs; `data/pallets*.sqlite` and 14 dated backups sit beside them. `data/` is gitignored (verified: `git ls-files data` is empty), so none of it is in the public repo. **Fixtures are clean** (`Demo Client` / `Frozen Client`). Rule: this folder is never seed, demo or test data for another customer, and any zip of the working copy has to exclude it.

### A6. Workflow text that names Ambica's situation (user-visible)

| Text | Where |
|---|---|
| "To share designs with the rest of the team, choose a folder **Google Drive** syncs." | `electron/main.ts:81` (native dialog), `src/editor/StoreFolder.tsx:49-50` (first-run screen), `:66-68` (error screen), `:100` (a macOS-shaped placeholder path) |
| "The shop's own number…", "the number the client knows this pallet by, which is rarely the same as the shop's", "the unit the yard quotes in" | `src/editor/hints.ts:47,48,50` |
| **The user guide is stale and Ambica-shaped**: "runs on this machine only — no accounts, no internet" (`:38`), "type `npm start`, open localhost:5179" (`:55-58`), storage "in one file `data/pallets.sqlite`" (`:204-210` — replaced by the JSON folder months ago), `AP-001-2026-08-03.pdf` (`:199`), the fixture name `m-pallet` (`:162`) | `docs/guide.ts` |
| "In about eight designs in ten…"; "Canva, Illustrator or Inkscape" (Canva first) | `src/editor/Help.tsx:35,177` |
| "Four people update at their own pace" (version badge), "four people on four laptops", "the Sunday this whole design is for" | `StoreFolder.tsx:168`, `store/files.ts:11`, `electron/updates.ts:6-18`, `server/app.ts:54`, README, desktop-app-plan |
| No support contact anywhere: no mailto, no "report a bug", no help URL. The de-facto channel is the GitHub repo, which is also the update feed. | — |
| `assets/icons/hand-pallet-truck.jpg` and `forklift.png` are referenced by `src/sheet/handling.ts:71,86` and `README.md:32` but no longer exist | housekeeping |

### A7. Single-company architecture assumptions (confirmed in code)

**Security — must be fixed before the server is reachable from the internet**

- **No authentication anywhere.** `src/server/app.ts:29-34` says so explicitly. Anonymous callers can export the whole library (`GET /api/library.json`, `app.ts:363`), cascade-delete a client and all their designs (`DELETE /api/clients/:id`, `repository.ts:154-162`), overwrite any design (`PUT /api/pallets/:id` without `If-Match`, `app.ts:261`), and replace the library (`POST /api/library/import` with `mode=replace`, `app.ts:382`).
- **Anyone can repoint the server's storage root to any path and have it created**: `PUT /api/settings` → `handle.use()` → `mkdirSync` (`app.ts:140-156`, `store/files.ts:137`), persisted to the settings file so it survives restart. The most dangerous route in the app on a hosted box.
- **`app.listen(port)` binds all interfaces** (`src/server/main.ts:63`) while the log line claims `localhost`. Electron pins `127.0.0.1` (`electron/main.ts:192`); the web server does not.
- `GET /api/settings` leaks the absolute store path (`app.ts:117-130`); the folder bar prints it to every viewer (`StoreFolder.tsx:154`); the setup screen asks a browser user to type a server-side path (`StoreFolder.tsx:96-101`).
- `express.json({ limit: '64mb' })` (`app.ts:89`), justified by "nothing reaches this server from outside the machine". Unmapped errors echo `error.message` with a 500 (`app.ts:432`). No request logging, no CORS, no security headers, no rate limiting.

**Tenancy — one company per process, by construction**

- **One store per process.** `createApp` builds one `PalletRepository` and one `ClientRepository` over one `StoreHandle` (`app.ts:74-76`); nothing in the request (path, host, header, cookie) chooses a store. `StoreHandle` is scalar (`handle.ts:41-44`). The chosen folder is remembered per *machine* in OS app-data (`store/settings.ts:24-39`), by design.
- The repositories already take a `StoreRef` thunk (`repository.ts:16`) — the seam that lets store resolution become request-scoped.
- **Client names are globally unique, case-insensitively** (`repository.ts:117-140`) and **library import matches clients by name** (`server/library.ts:65-79`) — two companies who both sell to "Biocon" would collide in a shared store. Per-tenant stores avoid this entirely.
- A design document has **no owner, tenant, user or author field** (`src/schema.ts:113-179`); tenancy has to come from the store a request is routed to, not from the document.
- **The rates cache holds a single path-keyed entry** (`costing/resolve.ts:49`) — fine per tenant, thrashes if shared. `ratesResolver` is otherwise the right shape (a per-folder override of built-in prices).
- `reconcileClients` and the backup run once at boot for the one store (`main.ts:46,52`).
- **`FileStore.transaction` is not safe for a multi-user server as written** (`store/files.ts:268-291`). Today every store call is synchronous, so two requests cannot actually interleave inside one transaction — the hazard is latent (any future `await` in a write path makes it real). There is one real case now: a nested `transaction()` (`:269` early-returns into the open one) whose inner `run()` throws and is caught by the outer leaves the outer committing half of the inner's staged writes.
- localStorage draft keys `pallet-draft:<id>` are not namespaced by user or tenant (`editor/drafts.ts:21`).
- The Electron/web distinction is server-supplied (`canBrowse` and `version` on `/api/settings`, `app.ts:125-126`); there is no preload bridge, so the editor needs no change to drop Electron.

**Operations — what a VPS needs that a laptop did not**

- **PDF printing launches a fresh Chromium per request** (`src/sheet/browserPrinter.ts:17,36`): no pool, no queue, no timeout, no concurrency cap, and no `--no-sandbox` or `--disable-dev-shm-usage` (needed on Linux and in Docker). N simultaneous PDF requests = N Chromiums at roughly 150 MB each. Electron's printer has a queue and a 30 s step timeout (`electron/printer.ts:31,56-59`); the server path has neither. `findBrowser.ts:18-25` already looks in `/usr/bin/chromium` and friends, so discovery on Linux is fine.
- **Backups** are one snapshot at process start, written *inside* the store on the same disk, with a plain `writeFileSync` (`server/backup.ts:52-55`). A server up for a month takes one backup.
- **No production build for the server**: `npm run serve` is `tsx src/server/main.ts`. `tsx` and `puppeteer-core` are devDependencies (so `npm ci --omit=dev` cannot boot or print), while `electron-updater` is a runtime dependency the server never uses. `staticDir`, `DEFAULT_RATES_PATH` and the default store are all `process.cwd()`-relative (`main.ts:23,34`, `costing/load.ts:11`).
- Optimistic concurrency via `If-Match` plus `fingerprint()` (`store/fingerprint.ts`) works and carries over unchanged.
- The tests reach the API through `createApp(tempHandle())` with bare `fetch` and no headers (`tests/helpers.ts:49`, `tests/api.test.ts:14-43`); `tests/settings.test.ts` pins the machine-global folder choice and will be largely replaced. The PDF test skips without Chrome (`tests/pdf.test.ts:14-24`).

### A8. Tests that pin the single-company behaviour (what goes red when branding becomes configurable)

| Test | What it pins | Fate |
|---|---|---|
| `tests/branding.test.ts` (23 tests) | OTF font data URI (`:23,26`), family `'Ambica Brand'` (`:72`), every `url()` is `data:` (`:86-88`); **exactly two logo paths under 400 bytes** (`:32,36`), `LOGO_COLOUR` (`:31`), `LOGO_BOX` 1460×1278 (`:40-42`); **no `data:` URI and no `<image>` anywhere in the SVG sheet** (`:33,78,202-214`); watermark at 35.x°, opacity ≤ 0.1, contains `COMPANY_NAME` (`:50-68,139-144` — `:142` puts the company name into a `RegExp` unescaped) | Re-target at a `DEFAULT_BRAND`; add a second suite for a raster-logo brand asserting exactly one `<image>` |
| `tests/api.test.ts:226` | the literal string `'Ambica Patterns India Pvt Ltd'` in the SVG | Assert the test brand's name instead |
| `tests/sheet.test.ts:112,113,344` | `<svg>` count = 6 + 2×5 (five views + the logo) and exactly one `class="logo"` | Conditional on the brand having a logo |
| `tests/sheet.test.ts:247,277-278,400-402` | `First-angle projection, all dimensions in mm`; `± 2 mm` / `± 5 mm` | Read from the brand |
| `tests/rates.test.ts:29,57` | `currency === 'INR'`; the whole file assumes `rates.json` in a synced folder | Keep the folder model (it becomes the tenant folder); drop the INR assertion |
| `tests/settings.test.ts` | the machine-global folder choice, `PALLET_STORE` in an error string (`:237`) | Largely replaced by tenant tests |
| `tests/guide.test.ts:26,28` | two sentences of the stale guide | Rewritten with the guide |
| `electron/compare.ts:86` | five of *Ambica's* design ids as the PDF reference set | Goes with Electron |
| `tests/pdf.test.ts` | the only test that needs Chrome; `describe.skipIf(browser === null)` | Unchanged; CI stays browser-free |

Documents come from `tests/helpers.ts` `loadFixture()` (13 fixtures), stores from `tempStore()` and `tempHandle()`; API tests use bare `fetch` with no headers, so auth needs a test seam (`createApp(handle, { auth: off })` or a session factory).

### A9. The Electron shell — what goes when hosting replaces it

- **Delete**: `electron/` (5 files), `electron-builder.yml`, `build/icon.png`, `assets/icons/`, the root PNG; the scripts `build:electron`, `app`, `pack`, `dist:win`, `dist:mac`, `release:win`, `compare:pdf`; `package.json` `main`; the deps `electron`, `electron-builder`, `electron-updater` (the last is wrongly a runtime dependency today).
- **Keep**: `src/sheet/pdf.ts` (`usePrinter` is exactly the seam a pooled server printer needs), `browserPrinter.ts`, `findBrowser.ts` and `puppeteer-core` (they become the only printer), and everything else under `src/`.
- **Orphaned, then removed**: `src/editor/StoreFolder.tsx` in full (every one of its ~20 strings is about choosing a Drive folder), the `PALLET_STORE` story, `PUT/POST /api/settings*`.
- The renderer has **no preload and no IPC**; it only reads `canBrowse` and `version` from `/api/settings`, so dropping Electron removes two UI affordances and breaks nothing.
- **The three uncommitted changes** (`git diff` today): `electron-builder.yml` adds `arch: [x64, arm64]` (the real ARM fix); `electron/main.ts` defers `reconcileClients` and the backup to after first paint; `electron/printer.ts` adds a 30 s step timeout and recycles the print window on failure. Recommendation: commit them and cut one last desktop release (0.1.2) so the team keeps working until the hosted version replaces it; the timeout-and-recycle idea is carried into the server's pooled printer.

---

## B. What selling it takes beyond the code

### B1. Before anything else — three things that block a sale today

1. **The font.** ITC Anna is a commercial typeface (Adobe/ITC copyright in the file's name table). It is embedded in every PDF, committed to a public repo, and would be redistributed to every customer. Remove it from the repo (and from history if the repo stays public), replace it with an SIL Open Font Licence face for the default watermark, and let a company upload its own font only if it holds a web-embedding licence for it. Ambica can keep ITC Anna as *its own* tenant font, if Ambica's licence permits embedding in documents.
2. **The repo is public** (`github.com/WeWake1/pallet_maker`). The code *is* the product; anyone can run it for free. Make the repository private before the first sales conversation. (The Electron auto-updater relied on it being public — moot once Electron is retired.)
3. **The server has no login.** Not a single company's data can go on a public VPS until phase 2 of the roadmap is done. Until then, host only for Ambica behind an HTTP basic-auth wall on the reverse proxy, or not at all.

### B2. Legal and commercial paperwork (India-based vendor)

- **Licence / terms of service**: a subscription licence, not a sale of code. State: the customer owns their designs and can export them at any time (the library export already exists); you may suspend for non-payment after notice; uptime is best-effort unless you sell an SLA.
- **Liability on drawings**: the sheet goes to the shop floor. Put a clear disclaimer in the terms (the tool draws what is entered; the customer is responsible for checking specifications and load ratings). Consider a small "Drawn by / Checked by" block on the sheet so the responsibility is visibly the customer's.
- **Data**: customer names and designs are business data, some of it confidential (their customers' pallets). Commit in writing to per-company isolation, HTTPS, daily backups off the server, deletion on request, and no reuse. If you ever sell outside India, GDPR-style data-processing terms become necessary.
- **Invoicing**: GST invoices for SaaS (18 % on software services as of writing — confirm with your CA); export-of-services rules if a customer is abroad.
- **Trademark**: "Pallet Spec" is generic; pick a product name you can own, and use it consistently (today the product has four spellings across the installer, window, tab and README).

### B3. Packaging and pricing (a starting point, not a verdict)

- **Per company per month, with a seat cap**: for example Starter (up to 3 users, 1 site), Standard (up to 10 users), Plus (unlimited users, priority support, custom sheet options). Annual billing at about ten months' price.
- **Onboarding fee** covering logo vectorisation, rates setup, importing existing designs, and a training call. This is where most of your time goes per customer; charge for it.
- **Trial**: 14 days on a demo company pre-loaded with the 11 fixtures (which use `Demo Client` and `AP-` codes — rename the codes to something neutral first).
- **Billing**: invoice manually for the first customers; add Razorpay or Stripe subscriptions once there are more than a handful. Keep an `active | trial | suspended` flag per company in the vendor registry from day one so suspension is a switch, not a deploy.
- **What justifies the price**: one consistent specification sheet for every customer of theirs, costing at their own rates, a searchable library that survives staff turnover, and no per-machine installs. Lead with the PDF.

### B4. The product-readiness checklist (what phases 0–5 deliver)

| Area | Today | Needed to sell |
|---|---|---|
| Branding | Ambica's name, logo and font compiled in | Per-company name, logo (SVG or raster), optional font, watermark on/off, projection note, tolerances, units and currency, defaults |
| Accounts | none | Company → users with roles; invitations; password reset; session expiry |
| Isolation | one folder per process | one folder per company, resolved from the session; per-company rates and backups |
| Hosting | laptop or Electron | VPS behind TLS, pooled Chromium, health check, logs, restarts |
| Backups | one snapshot at startup, same disk | nightly per-company snapshot + off-box copy, tested restore |
| Support | none | a support email, a version shown in the app, a status line, a one-page onboarding doc |
| Documentation | a user guide that still describes SQLite and `npm start` | a rewritten guide with no company-specific text |
| Admin | none | a vendor screen (create company, first admin, suspend); a company admin screen (users, brand, rates, sheet options) |

### B5. Onboarding a new customer (the repeatable procedure)

1. Sign the agreement; collect the legal company name as it should print, the logo (SVG preferred; PNG at 1000 px or more otherwise), currency, timber unit, the first admin's email, and the list of users.
2. Vendor screen → create the company, set plan and seat cap, create the first admin (they get an invitation link).
3. Company admin (or you, on their behalf, during onboarding): upload the logo, set the watermark text, projection convention, tolerances, default pallet size, species and handling, and the code placeholder.
4. Enter their rates (timber per unit by material, nails per thousand, overhead).
5. Import existing designs, if any, from a library export or spreadsheets (spreadsheet import was deliberately not built — decide per customer whether to type them in as part of onboarding).
6. Print one sheet with them on a call. Confirm the logo, the watermark, the units and the tolerances.
7. Hand over the one-page guide and the support address.

### B6. Running it (what "hosting on a VPS" commits you to)

- **Sizing**: 2 vCPU and 4 GB is comfortable for tens of companies; Chromium is the only heavy part, and it is pooled with a concurrency of 2.
- **Deploy**: one command (`deploy/deploy.sh` in phase 0) that builds, uploads, installs production dependencies, flips a symlink and restarts. Tag releases.
- **Backups**: a nightly library snapshot per company, then `restic` or `rclone` to object storage (Backblaze B2, Wasabi, or a second VPS). **Test a restore once a quarter**; an untested backup is a hope.
- **Monitoring**: an uptime ping on `/healthz`, a disk-space alert at 80 %, log rotation. That is enough at this scale.
- **Updates**: because there is one server, an update is one deploy — no per-machine installer, no SmartScreen, no ARM64 question. The "four users on four versions" problem disappears.
- **Incidents**: a support address and a habit of telling customers before they notice.

### B7. Data ownership, exit and trust

- Every company can download `library.json` (every client and design) at any time — keep that button prominent; it is the strongest answer to "what if you disappear?"
- Deleting a company deletes its folder and its backups after a stated grace period.
- Publish a short security page: HTTPS only, per-company folders, hashed passwords, daily off-site backups, no third-party analytics.

### B8. Things customers will ask for (worth knowing before the first demo)

- Third-angle projection and inches (US customers); m³ pricing (Europe) — a units setting, not a rewrite, because the geometry is already unit-free integers.
- A revision block, drawn-by / checked-by / approved-by, a confidentiality footer.
- Their own pallet-code numbering with auto-increment.
- Emailing the PDF straight to their customer; a per-customer share link.
- A second language on the sheet.
- Spreadsheet import (deferred by design; see the build brief).

None of these blocks a sale; all of them are easier once the sheet reads its text from a per-company brand object.

---

## C. Implementation roadmap

Phases 0 and 1 are needed whatever else happens; phase 2 is what makes a second company safe; phases 3–5 make it sellable. Effort is for one experienced developer who knows this codebase: **about 20–26 working days in total.** Each phase ends green on `npm test` and deployable on its own.

### Target shape (what the phases build towards)

```
<PALLET_DATA_ROOT>/
  registry.sqlite                      companies, users, invitations, sessions (node:sqlite, WAL)
  registry-backups/                    nightly VACUUM INTO, keep 14
  tenants/<tenantId>/
    designs/<id>.json  clients.json    the FileStore layout, unchanged
    rates.json                         optional; today's ratesResolver already reads it here
    brand.json  brand/logo.svg|png  brand/font.*   per-company branding (files, so a tenant folder is a complete, portable library)
    backups/                           nightly library snapshot, keep 30
```

Request flow: cookie → session row → user + tenant → the tenant's `StoreHandle`, `ratesResolver` and `brandResolver` put on `AsyncLocalStorage` → the existing repositories' `StoreRef` thunk reads it. **No route body changes.** A vendor-level admin can "enter" a company; everyone else is pinned to theirs.

### Phase 0 — Harden and package the server (2–3 days)

Goal: the current single-company tool can run on a Linux VPS safely, for Ambica alone, behind Caddy.

- `src/server/main.ts`: `app.listen(port, HOST)` with `HOST=127.0.0.1`; a `--local` flag = today's open single-tenant mode on `data/library` for editor development; refuse to start without the required env; graceful shutdown drains the printer. Env: `PALLET_DATA_ROOT`, `PORT`, `HOST`, `PALLET_BROWSER`, `PALLET_PUBLIC_URL`, `PALLET_BACKUPS` (`PALLET_RATES` is already dead for the server and goes).
- `src/server/app.ts`: `express.json({ limit: '64mb' })` only on `/api/library/import` and `/api/pallets/import`, 2 MB elsewhere; stop echoing `error.message` on 500 (log it with a request id instead); `src/server/headers.ts` (~40 lines): nosniff, frame-deny, referrer, and a CSP of `default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:` — which also covers the `window.open('') + document.write` sheet tab at `App.tsx:789`; `src/server/log.ts`: one JSON line per request (id, method, path, status, ms) to stdout; `GET /healthz`.
- **Remove** `PUT /api/settings`, `POST /api/settings/retry`, `POST /api/settings/browse`, `AppOptions.chooseFolder`, `StoreHandle.use()`; keep `retry()` for internal use. `tests/settings.test.ts` shrinks to the 503 case.
- `src/sheet/pooledPrinter.ts` (new): `createPooledPrinter({ executablePath, concurrency: 2, jobTimeoutMs: 30_000, maxQueue: 20 })` — one long-lived `puppeteer-core` Chromium (`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --font-render-hinting=none`), a semaphore, `setContent` → `document.fonts.ready` → `page.pdf`, every step wrapped in the `within()` timeout lifted from the uncommitted `electron/printer.ts`, relaunch on crash or timeout with one retry, `PrinterBusyError` → 503 when the queue is full, `close()` drains. Installed with `usePrinter()` from `main.ts`; `browserPrinter.ts` stays for the CLI and tests. `findBrowser.ts` gains `/usr/bin/google-chrome-stable` and `/usr/lib/chromium/chromium`.
- `FileStore.transaction` (`src/store/files.ts:268`): throw if `run()` returns a thenable ("transactions are synchronous"), track depth and poison the outer transaction when a nested one throws, and add `src/store/mutex.ts` (a promise queue, the same shape as the queue in `electron/printer.ts`) that the import and PDF routes run under — insurance for the day a write path becomes async.
- `today()` (`src/ids.ts:14`): `today(timeZone = 'UTC')` via `Intl.DateTimeFormat('en-CA', …)`; the repositories take a `now` thunk so a save is stamped in the tenant's timezone (Ambica: `Asia/Kolkata`). Fixes the "saved after 05:30 IST is dated yesterday" bug.
- Build: `"build:server": "esbuild src/server/main.ts --bundle --platform=node --format=esm --target=node26 --packages=external --outfile=dist/server/main.mjs"` (the `build:electron` line minus the alias); `puppeteer-core`, `express`, `zod` in `dependencies`, `electron-updater` out; `dist/editor` and `config/rates.json` resolved from the app root, not `process.cwd()`; `npm ci --omit=dev && node dist/server/main.mjs` must boot.
- `deploy/` (new): `Caddyfile` (reverse proxy, auto TLS, `request_body max_size 70MB`), `pallet-spec.service` (`User=pallet`, `WorkingDirectory`, `EnvironmentFile`, `Restart=on-failure`, `TimeoutStopSec=40`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/pallet-spec`, `MemoryMax=1500M`), `deploy.sh` (build, rsync to `releases/<sha>`, `npm ci --omit=dev`, flip `current`, restart; rollback = flip back), `env.example`, and a `README.md` with the Debian recipe: `apt install chromium fonts-liberation fonts-dejavu-core` (apt chromium, not the Ubuntu snap) and a fontconfig alias Helvetica → Liberation Sans.
- Backups: `src/cli/backup.ts` run by a systemd timer (nightly library snapshot and prune, the same `backupLibrary`), and a `restic` timer to B2 or S3 with `--keep-daily 30 --keep-weekly 12 --keep-monthly 12`, pinging healthchecks.io.
- **Testable**: `tests/pooledPrinter.test.ts` with a fake `launch` (concurrency ≤ 2, queue order, timeout → relaunch, drain); a real-browser case under `skipIf` printing three sheets through one launch; `curl /healthz`; 10 parallel PDF requests through Caddy with flat memory.

### Phase 1 — Per-company branding and sheet options (3–4 days)

Goal: nothing about Ambica is compiled into the program; Ambica's own sheet is pixel-stable.

- `src/brand/types.ts` (browser-safe): `Brand { companyName; logo: {kind:'svg', svg, width, height} | {kind:'raster', dataUri, width, height} | {kind:'none'}; watermark: {enabled, text, opacity, sizePt: number|null}; font: {family, dataUri, format} | null; projectionNote; tolerances: {component, pallet}; units: {length:'mm', currency, volume:'cft'|'m3'}; defaults: {palletCodePlaceholder, species, nailType, newPallet:{length,width}, handling[]}; timezone }`. `src/brand/defaults.ts` `DEFAULT_BRAND`: a neutral name, no logo, the bundled face, today's projection note and tolerances, `newPallet` from `templates.ts`, timezone `UTC` (keeps the existing date assertions valid).
- `src/brand/schema.ts` `BrandFileSchema` (zod) for `brand.json`, which references files rather than inlining them; `src/brand/resolve.ts` `brandResolver(root, fallback)` — an mtime/size cache over `brand.json` + logo + font, the same shape as `src/costing/resolve.ts`; `writeBrand()` via `writeAtomic` (exported from `src/store/files.ts`).
- Default watermark face: **Oswald Regular (SIL OFL 1.1)** — condensed, close to the current look; ship `src/brand/fonts/Oswald-Regular.woff2` + `OFL.txt`; `npm run brand` (`src/brand/build.ts`) generates `src/brand/defaultFont.ts` from it. **Delete** `src/brand/assets.ts`, `brand.ts`, `logo.ts`, `ITC Anna Regular.otf` and the Ambica PNG: none of it may be in a bundle another company runs. (Ambica's traced paths are written once to an `ambica-logo.svg` by a throwaway script and become its tenant's uploaded logo; ITC Anna goes only into Ambica's tenant folder, never back into the repo.)
- Threading, keeping every public signature: `renderSheet(pallet, layout, { brand = DEFAULT_BRAND, greyscale })`, `renderSheetSvg(pallet, layout, { brand, greyscale })`, `sheetContent(pallet, layout, brand = DEFAULT_BRAND)` — so `src/cli/sheet.ts` (which gains `--brand brand.json`) and every test call site compile unchanged. `sheet.ts`: `logoHtml(brand)` (svg → inline `<svg class="logo">`, raster → `<img class="logo" src="data:…">`, none → nothing), `fontFace(brand)`; `svgSheet.ts`: `footer(brand)` (svg → `<g>` with prefixed ids, raster → exactly one `<image preserveAspectRatio="xMaxYMax meet">`), `watermark(brand)`. `PROJECTION_NOTE` and the two tolerance constants go away; the unit labels (`(mm)`, `kg`) come from `units`.
- Watermark fit: `src/sheet/watermark.ts` `watermarkSizePt(text, advanceEm, override)` = `override ?? clamp(0.88 × diagonalPt / (text.length × advanceEm × (1 + tracking)), 24, 96)`, with `advanceEm` ≈ 0.46 for the Helvetica fallback (calibrated from the 64 pt figure already in `layout.ts`) and ≈ 0.40 for the condensed default; `WATERMARK.fontSize/svgFontSize` become `fill/minPt/maxPt`. **Ambica's `brand.json` pins `sizePt: 80`** so its sheet does not move; `LOGO.maxWidth` is honoured in the HTML sheet as well.
- Logo upload rules (`src/brand/logoFile.ts`, used by phase 3): base64 in JSON (under the 2 MB limit), max 512 kB, magic-byte sniffing; an SVG allow-list (`svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop title desc`), no `on*` attributes, no external `href`, `viewBox` required, ids prefixed; `clipPath/mask/filter/image/use/style/script/foreignObject` rejected with "flatten the logo or upload a PNG" — this keeps the vector sheet takeable-apart; raster = PNG/JPEG only, at most 2000 px a side.
- Costing: `currency` loses its `'INR'` default (a rates file must state it); `volume: 'm3'` is a display-only conversion in v1 (rates stay per CFT on disk; a `timberPerM3` table is a later, contained change in `src/costing/rates.ts`).
- Editor: `GET /api/brand` → `api.brand()`; `App` passes it to the client-side `renderSheet` (`App.tsx:789`), the code placeholder (`:1159`), the species placeholder (`:1271`), the costing labels (`:1697-1733`), `templates.ts` `newPallet(client, defaults)` and the `state.ts` fallbacks; the dashboard header shows `brand.companyName`. Test seam: `AppOptions.brand?: Brand`, like `rates`.
- Tests: `tests/branding.test.ts` becomes three `describe`s driven by `tests/fixtures/brand-vector.json` (a generic two-path mark) and `brand-raster.json` (a 1×1 PNG): default (the bundled font as `data:`, no `<image>`), vector (exactly 2 `<path`, the `FORBIDDEN` table unchanged), raster (exactly one `<image>` and one `data:` in the SVG, one `<img>` in the HTML); `tests/api.test.ts:226` asserts the brand's name; `tests/sheet.test.ts` reads tolerances and projection from `DEFAULT_BRAND`; `tests/pdf.test.ts` keeps "no image XObject" for vector and gains a raster case expecting one; new `tests/brand.test.ts` (resolver cache, sanitiser accept/reject, fit within 0.8–0.95 of the diagonal for short and long names).
- **Testable**: `scripts/compare-sheets.ts` prints all 30 Ambica designs before and after and compares them mark for mark (the `electron/compare.ts` idea, moved); a demo brand with a PNG logo prints and its SVG opens in Inkscape.

### Phase 2 — Companies, users and login (5–7 days)

Goal: several companies on one server, each seeing only its own folder.

- **Registry** `src/tenancy/registry.ts` on **`node:sqlite`** (`DatabaseSync`; verified working on Node 26.5 with no warning — no native build on the VPS, bundles cleanly; kept behind one `Registry` class so `better-sqlite3` is a one-file swap). Tables: `tenants(id, slug UNIQUE, name, timezone, status active|suspended, created_at)`, `users(id, tenant_id NULL = vendor, email, email_lc UNIQUE, name, role vendor|admin|member, password_hash NULL until accepted, status, created_at, last_login_at)`, `invitations(id, kind invite|reset, tenant_id, email_lc, role, token_hash UNIQUE, invited_by, expires_at, accepted_at)`, `sessions(id_hash PK, user_id, tenant_id, created_at, last_seen_at, expires_at, ip, user_agent)`, an optional `audit`. A JSON registry was rejected: logins and invitation acceptance need unique constraints and transactions.
- **Tenant context** `src/tenancy/context.ts` (`AsyncLocalStorage<TenantContext>`, `runInTenant`, `currentTenant()` throwing a loud `NoTenantContextError` → 500, never another tenant's files) and `src/tenancy/tenants.ts` (`Map<tenantId, TenantContext>`, a lazy `StoreHandle` + `ratesResolver` + `brandResolver` per tenant, `reconcileClients` on first open, `forEachActive`). `createApp(source: StoreHandle | Tenants, options)`: a bare `StoreHandle` (tests, `--local`) runs every request in one fixed context with auth off, so `tests/api.test.ts` and `tests/concurrent.test.ts` stay green unchanged. The one line that changes: `const storeNow = () => currentTenant().handle.require()`.
- **Auth** `src/server/auth.ts` (~200 lines, no Passport or JWT): `crypto.scrypt` (async, `N=2^15, r=8, p=1, maxmem 64 MiB`, a per-user salt, `timingSafeEqual`, a dummy hash on unknown email); cookie `pallet_session=<sid>.<hmac>; HttpOnly; SameSite=Lax; Secure` (Secure when `PALLET_PUBLIC_URL` is https), the DB stores `sha256(sid)`, sliding 30 days, absolute 90; CSRF = SameSite plus a required `X-Requested-With: pallet-editor` header on every non-GET `/api` call; a login rate limit of 10 per 15 min per IP and per email (`src/server/ratelimit.ts`, in-memory); invitation tokens hashed at rest with a 7-day expiry, the admin copies the link by hand (SMTP is phase 5); password reset = an admin-created `reset` invitation; vendor bootstrap `pallet-tenant vendor-admin --email …` prints a set-password link. Routes: `POST /api/auth/login|logout`, `GET /api/session`, `GET /api/auth/invitation/:token`, `POST /api/auth/accept`. Middleware order: trust-proxy + log → headers → body limits → static/SPA → public auth routes → `requireSession` (suspended tenant → 403) → `requireRole('admin')` on `/api/admin/*`, `requireRole('vendor')` on `/api/vendor/*`. Members cannot delete clients or replace the library.
- **Housekeeping** `src/tenancy/housekeeping.ts`: a nightly per-tenant `backupLibrary` plus a registry `VACUUM INTO` (keep 14), an hourly session sweep; no backup at boot any more (restarts stay cheap). `POST /api/vendor/backup` on demand.
- **Editor**: `api.ts` adds `credentials: 'same-origin'`, the header, and an `Unauthenticated` error on 401; `App.tsx` boots on `api.session()` instead of `api.settings()`, and any 401 → `Login.tsx` (`#/invite/<token>` renders the accept form); `StoreFolderBar` becomes `SessionBar` (company, user, the `ratesProblem` banner kept, version, sign out, admin link); drafts keyed `pallet-draft:<tenantId>:<id>`.
- **Tests**: `tests/helpers.ts` gains `tempRegistry()`, `tempDataRoot()`, `seedTenant()`, `signIn()`; new `tests/auth.test.ts` (401, login/logout, wrong password, 429, missing header → 403, an invite accepted once, an expired invite, a suspended tenant, member vs admin), `tests/tenancy.test.ts` (store access outside a request throws; two tenants with the same design id and the same client name never see each other), `tests/registry.test.ts`.

### Phase 3 — Admin screens (4–5 days)

- `src/server/vendor.ts` + `src/editor/VendorAdmin.tsx`: create a company (slug, name, timezone, plan, seat cap), the first admin invitation, suspend/resume, enter a company, per-company counts and last activity, backup now.
- `src/server/admin.ts` + `src/editor/Admin.tsx`: users and invitations (create, reset link, disable); brand (name, logo upload, font upload, watermark toggle/text/size, projection convention, tolerances, units and currency, defaults) with a **live sheet preview** rendered by `renderSheet` on a fixture; a rates editor (writes the same `rates.json` through `parseRates`); "download everything" (the existing library export).
- `tests/admin.test.ts`; a manual walkthrough creating a second company with a raster logo and printing its sheet.

### Phase 4 — Deployment, backups, Ambica migration (2–3 days)

- Provision (Debian 12/13, 2 vCPU / 4 GB), Caddy on a real domain, systemd, Chromium, fonts, `PALLET_DATA_ROOT` on its own volume, the restic timer, healthchecks; a restore drill into a scratch data root that boots and shows a dashboard.
- `src/cli/tenant.ts` (`pallet-tenant vendor-admin | create | invite | brand | rates | import | verify`), talking to the registry and tenant folders directly — the same functions the vendor screen uses.
- Ambica: `create --slug ambica --timezone Asia/Kolkata`; `brand --logo ambica-logo.svg --font "ITC Anna Regular.otf" --family "Ambica Brand" --watermark-size 80 --code-placeholder AP-001`; `rates --from config/rates.json` (or the Drive folder's file); `import --from <library.json>` taken with the existing `GET /api/library.json` (ids preserved, `updatedAt` kept); `verify`: counts (30 designs / 14 clients as of now), every id present, `fingerprint()` equal per design, `reconcileClients` reports 0, one rendered sheet carries the name and the logo.
- Cut-over: freeze the Drive folder, take the final export, `import --mode replace`, send the invitation links, mark the Drive folder read-only as the archive. The last desktop build stays installed but unused for a week.

### Phase 5 — Polish and retirement (3–4 days)

- Rewrite `docs/guide.ts` for the hosted product (login, companies, no folders, no `npm start`, no SQLite); fix `Help.tsx:35,51,183-186`, `hints.ts:50`, `App.tsx:459-460,1744`; update `tests/guide.test.ts`.
- Remove Electron (A9), `StoreFolder.tsx`, `src/store/settings.ts`, `src/server/db.ts` + `src/cli/convert.ts` + `tests/migration.test.ts` + `better-sqlite3`, the Ambica assets from the tree, and the `AP-` codes in fixtures (rename to `PL-0xx`); `tsconfig.json` drops `electron`.
- README: replace the Branding, Installer/Updates and Storage sections with the hosted model; add a Deploy section; one product name, one spelling, everywhere. Optional: SMTP for invitations and self-service reset.

### Risks and how each is held

1. **Chromium on the VPS** (fonts, sandbox, memory) — done first, in phase 0, deployed single-tenant early; a warm-up print at boot; `MemoryMax` and the pool cap.
2. **Ambica's sheet changing under the brand refactor** — the `sizePt: 80` pin plus the all-30-designs before/after comparison in phase 1.
3. **Auth mistakes** (fixation, enumeration, cookie flags) — a tiny hand-rolled surface with full test coverage; Secure cookies forced on https.
4. **A tenant-context leak** — `NoTenantContextError` is loud; a test asserts that store access outside a request throws and that cross-tenant reads 404.
5. **`node:sqlite` maturity** — the `Registry` seam keeps `better-sqlite3` a one-file swap.
6. **Raster logos degrade the SVG export** for those companies — said plainly at onboarding; SVG preferred.
7. **The font is already in the public repo's history** — removing the file in phase 1 is not enough if the repo stays public; make it private or rewrite history (owner's call, see B1).
8. **Migration is one-way** once the team saves into the hosted tenant — the Drive folder stays read-only for a month.

### Considered and rejected

One process per company (N Chromiums, N ports, per-company ops); Postgres (another service to run and back up for tens of users); a JSON registry (no unique constraints for logins and invites); tenant-from-subdomain (wildcard DNS and TLS per company — can be added cosmetically later); `express-session`, Passport or JWT (either a session store to run or no revocation); brand in SQLite (a tenant folder should stay a complete, portable library); `helmet`, `pino`, `express-rate-limit` (fine, but about 60 owned lines cover it and match the codebase's habit).
