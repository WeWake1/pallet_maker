# Desktop app plan: JSON files on Google Drive

Turning the tool into a Windows `.exe` that keeps its designs as JSON files in a
shared Google Drive folder, so 3–4 people can use it from anywhere — office,
home, or a laptop with no internet at all.

## Why this shape

The tool is used occasionally, by a handful of people, who need it on days the
office is shut. A hosted server would mean paying for uptime and building a
login. A desktop app with its files in Drive needs neither: Google does the
syncing, the company's own Drive account holds the data, and the app works with
the internet switched off.

Two decisions carry the whole plan:

**SQLite has to go.** Not preference — safety. Google Drive copies files while
they are being written, and SQLite keeps side files (`pallets.sqlite-wal` is
sitting in `data/` right now). Sync those halfway and the database is corrupt.
One JSON file per design has no such problem, and shrinks a clash to the single
design two people both touched instead of the entire library.

**The Express server stays.** It moves inside Electron rather than being
replaced by it. `src/editor/api.ts` talks to `/api/...` over `fetch`, so as long
as the API is still there on localhost, the entire React frontend — Dashboard,
LayerEditor, Preview, drafts, history, shortcuts — needs no changes at all. The
swap happens underneath it, in the storage layer and the PDF printer.

## What is actually changing

| Piece | Now | After |
| --- | --- | --- |
| Storage | `data/pallets.sqlite` | `designs/<id>.json` + `clients.json` in a Drive folder |
| Backups | `VACUUM INTO` snapshots | Folder copy, plus Drive's own version history |
| PDF | `puppeteer-core` finds Chrome on the machine | Electron's built-in Chromium |
| Delivery | `npm start` on the dev's machine | Signed-in-nobody's-name `.exe`, auto-updating |
| Frontend | React on Vite | Unchanged |
| Geometry, sheet, DXF, costing | — | Unchanged |

Dependencies dropped at the end: `better-sqlite3`, `puppeteer-core`, `express`
stays (in-process).

---

## Phase 0 — Safety net

Nothing else starts until the current data is provably recoverable.

- [ ] Copy `data/pallets.sqlite` and `data/backups/` somewhere outside the repo
- [ ] Export the full library via `GET /api/library.json` and save the file
- [ ] Generate a PDF for **5 designs** covering different shapes — stringer,
      block, wing, M-pallet, plywood — and keep them as the reference set
- [ ] Record `npm test` passing, and the count, as the baseline
- [ ] Confirm the reference PDFs open correctly and the font renders

**Done when:** the library can be rebuilt from files that are not in this repo.

---

## Phase 1 — Storage: SQLite → JSON files

The biggest phase and the only risky one. The app still runs as it does today
(`npm start`, browser) throughout — Electron comes later. This keeps the change
testable in isolation.

### Layout on disk

```
<chosen folder>/
  clients.json            all clients: id, name, createdAt
  designs/
    <id>.json             one design, the same doc the DB stored
  backups/
    <timestamp>/          a copy of the two above
```

Filenames use the design **id**, not the pallet code or name. Names get edited;
a name-based filename would make every rename look to Drive like a delete plus a
create. The trade-off is that the Drive folder is not browsable by eye — worth
revisiting later with a generated index, but correctness first.

`clients.json` exists for one reason: a client with no designs yet. Every design
already carries `clientId` and `clientName` inside it (`src/schema.ts:119-120`),
so designs are self-describing — but a client created before their first design
would vanish without this file. `src/library.ts` already models exactly this
split, clients and designs as two lists, so the shape is proven.

### Work

- [ ] Write `src/store/files.ts` — read/write/list/delete over the folder
- [ ] **Atomic writes**: write to `<id>.json.tmp`, then rename into place. A
      rename is instant, so Drive never sees a half-written design
- [ ] **Tolerate bad files**: a design that fails to parse is skipped and
      reported, never fatal. Drive may hand us a file mid-download, and one bad
      file must not take down the dashboard
- [ ] Reimplement `ClientRepository` and `PalletRepository` against the folder,
      keeping their current method signatures so `src/server/app.ts` is untouched
- [ ] Port `ClientRepository.rename` — it rewrites `clientName` on every design
      of that client (`repository.ts:110-136`); same behaviour, now over files
- [ ] Port the cascade: deleting a client deletes their designs
- [ ] Rebuild the dashboard listing by reading the folder rather than SQL
- [ ] Rework `src/server/backup.ts` — timestamped folder copy instead of
      `VACUUM INTO`, same `keep` limit

### Converter

- [ ] Write `src/cli/convert.ts`: reads an existing `pallets.sqlite`, writes the
      folder layout, **never modifies the database**
- [ ] Reuse the existing migration in `src/server/db.ts` so a database from the
      revisions-era version converts correctly too
- [ ] Report counts on finish: clients, designs, anything skipped

### Verification — do not skip

- [ ] Run the converter on the real `data/pallets.sqlite`
- [ ] Compare counts: clients and designs out must equal rows in
- [ ] Round-trip check: export `library.json` from the old DB and from the new
      folder, and diff them — they should be identical
- [ ] Regenerate the 5 reference PDFs from the folder store and compare against
      Phase 0

### Tests

- [ ] Rewrite `tests/repository.test.ts` (211 lines) against the folder store
- [ ] Rewrite `tests/backup.test.ts` (96 lines) for folder backups
- [ ] `tests/api.test.ts` (358 lines) — behaviour is unchanged; only the fixture
      setup should need touching
- [ ] Keep `tests/migration.test.ts` (238 lines) — it now covers the converter
- [ ] New: atomic write leaves no `.tmp` behind
- [ ] New: an unparseable file is skipped, not fatal
- [ ] New: an empty folder starts a fresh library cleanly

**Done when:** the app runs exactly as before on `npm start`, with the folder as
its store, all tests green, and PDFs matching Phase 0.

---

## Phase 2 — Choosing the folder

- [ ] Settings file in the OS app-data directory, **not** in the Drive folder —
      each person's Drive sits at a different path, so this cannot be shared
- [ ] On first run with no folder set, ask for one
- [ ] A way to change it later, and to see which folder is currently in use
- [ ] Handle the folder being missing at startup — offline, unplugged drive,
      moved — with a clear message, not a crash
- [ ] Dashboard re-reads the folder each time it opens, so a colleague's design
      appears without restarting

**Done when:** the store location can be pointed anywhere and survives a
restart.

---

## Phase 3 — Electron shell

- [ ] Add Electron; main process starts the existing Express app in-process on a
      free port and loads it in the window
- [ ] Native folder picker wired to the Phase 2 setting
- [ ] Swap `src/sheet/pdf.ts` to `webContents.printToPDF`, mapping the current
      options one for one:
      `printBackground` → `printBackground`,
      `preferCSSPageSize` → `preferCSSPageSize`,
      `width`/`height` in mm → `pageSize` in microns,
      zero margins → `margins: { marginType: 'none' }`
- [ ] **Compare PDFs against Phase 0 references** — this is the gate on the
      whole phase
- [ ] Delete `src/sheet/browser.ts` and drop `puppeteer-core` once the
      comparison passes
- [ ] Drop `better-sqlite3`
- [ ] Window title, app icon from `assets/icons`, sensible default size
- [ ] Menu: at minimum Reload, DevTools, Quit

**Done when:** the `.exe` runs from a desktop icon, saves to the Drive folder,
and prints PDFs identical to today's.

---

## Phase 4 — Packaging and updates

- [ ] `electron-builder`, Windows NSIS installer, x64
- [ ] `electron-updater` against a **private** GitHub repo's Releases — free, no
      server needed
- [ ] Check for updates on launch, install on next start
- [ ] Version number visible in the app, so a bug report says which build
- [ ] Test the update path properly: install an older build, publish a newer
      one, confirm it updates itself

**Not doing:** code signing. A certificate costs a few hundred a year and there
are four users. The cost is a "Windows protected your PC" prompt on each new
version — click "More info" → "Run anyway".

---

## Phase 5 — Rollout

- [ ] Shared Drive folder set up, all four people given access
- [ ] **Google Drive Desktop set to "mirroring", not "streaming"** — streaming
      leaves files in the cloud and fetches on open, which breaks the offline
      Sunday case entirely. This is the single most likely thing to go wrong
- [ ] Convert the live database and put the result in the shared folder
- [ ] Install for one person first. Let it run a week before the rest
- [ ] One-page instructions: install, mirroring setting, folder location, the
      SmartScreen prompt, who to tell when it breaks
- [ ] Keep `data/pallets.sqlite` untouched until everyone is settled

---

## Deliberately not doing yet

- **Locking or merge on simultaneous edits.** Rare at this usage, and Drive
  keeps version history when it does happen. Revisit if it actually bites.
- **A human-readable Drive folder.** Ids are safer. An exported index can come
  later if browsing the folder turns out to matter.
- **macOS or Linux builds.** Everyone is on Windows.
- **Login or accounts.** Google Drive access *is* the permission model.

## If it goes wrong

Every phase before 5 leaves `data/pallets.sqlite` untouched, and the converter
only ever reads it. Rolling back means running the current version again. The
point of no return is Phase 5, once people start saving new work into the folder
— and from there Drive's version history is the safety net.

## Order and risk

| Phase | Risk | Note |
| --- | --- | --- |
| 0 Safety net | — | |
| 1 Storage | **High** | Real data. The one to be careful with. |
| 2 Folder | Low | |
| 3 Electron | Medium | PDF comparison is the gate |
| 4 Packaging | Low | Fiddly, not risky |
| 5 Rollout | Medium | Mirroring setting is the trap |

Phase 1 is worth doing on its own merits even if the desktop app were abandoned
tomorrow: it makes the designs plain files that outlive this program.
