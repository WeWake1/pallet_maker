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

- [x] Copy `data/pallets.sqlite` and `data/backups/` somewhere outside the repo
- [x] Export the full library via `GET /api/library.json` and save the file
- [x] Generate a PDF for **5 designs** covering different shapes — stringer,
      block, wing, M-pallet, plywood — and keep them as the reference set
- [x] Record `npm test` passing, and the count, as the baseline
- [x] Confirm the reference PDFs open correctly and the font renders

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

- [x] Write `src/store/files.ts` — read/write/list/delete over the folder
- [x] **Atomic writes**: write to `<id>.json.tmp`, then rename into place. A
      rename is instant, so Drive never sees a half-written design
- [x] **Tolerate bad files**: a design that fails to parse is skipped and
      reported, never fatal. Drive may hand us a file mid-download, and one bad
      file must not take down the dashboard
- [x] Reimplement `ClientRepository` and `PalletRepository` against the folder,
      keeping their current method signatures so `src/server/app.ts` is untouched
- [x] Port `ClientRepository.rename` — it rewrites `clientName` on every design
      of that client (`repository.ts:110-136`); same behaviour, now over files
- [x] Port the cascade: deleting a client deletes their designs
- [x] Rebuild the dashboard listing by reading the folder rather than SQL
- [x] Rework `src/server/backup.ts` — timestamped folder copy instead of
      `VACUUM INTO`, same `keep` limit

### Converter

- [x] Write `src/cli/convert.ts`: reads an existing `pallets.sqlite`, writes the
      folder layout, **never modifies the database**
- [x] Reuse the existing migration in `src/server/db.ts` so a database from the
      revisions-era version converts correctly too
- [x] Report counts on finish: clients, designs, anything skipped

### Verification — do not skip

- [x] Run the converter on the real `data/pallets.sqlite`
- [x] Compare counts: clients and designs out must equal rows in
- [x] Round-trip check: export `library.json` from the old DB and from the new
      folder, and diff them — they should be identical
- [x] Regenerate the 5 reference PDFs from the folder store and compare against
      Phase 0

### Tests

- [x] Rewrite `tests/repository.test.ts` (211 lines) against the folder store
- [x] Rewrite `tests/backup.test.ts` (96 lines) for folder backups
- [x] `tests/api.test.ts` (358 lines) — behaviour is unchanged; only the fixture
      setup should need touching
- [x] Keep `tests/migration.test.ts` (238 lines) — it now covers the converter
- [x] New: atomic write leaves no `.tmp` behind
- [x] New: an unparseable file is skipped, not fatal
- [x] New: an empty folder starts a fresh library cleanly

**Done when:** the app runs exactly as before on `npm start`, with the folder as
its store, all tests green, and PDFs matching Phase 0.

### What came out differently

- **A snapshot is one library file, not a folder copy.** `backups/pallets-<stamp>.json`
  is a single write that cannot be caught half-finished, and it goes back in
  through the import that already existed. A folder copy would have needed a
  restore path of its own.
- **`reconcileClients` was added.** Designs and `clients.json` sync separately
  and either can land first, so a design can arrive naming a client the folder
  does not hold yet. It is folded in from the design's own copy of the name at
  startup, and `dashboard` rebuilds it on the fly in the meantime — a design on
  disk is never missing from the dashboard.
- **The read cache compares nanoseconds, not milliseconds.** Two writes in the
  same millisecond at the same length would otherwise look like no write, and a
  colleague's change would not appear.
- **The converter preserves ids.** The first attempt reused `importLibrary`,
  which matches clients by name and mints fresh ids — correct for merging two
  libraries, wrong for a conversion. Caught by the round-trip check: the folder
  was equivalent to the database but not equal to it.
- **Converting twice was a real bug.** A database from the revisions era has no
  clients table, so ids are invented while it is read and a second run invented
  a second set. Found by a test, fixed by matching on name when the folder
  already holds clients.

---

## Phase 2 — Choosing the folder

- [x] Settings file in the OS app-data directory, **not** in the Drive folder —
      each person's Drive sits at a different path, so this cannot be shared
- [x] On first run with no folder set, ask for one
- [x] A way to change it later, and to see which folder is currently in use
- [x] Handle the folder being missing at startup — offline, unplugged drive,
      moved — with a clear message, not a crash
- [x] Dashboard re-reads the folder each time it opens, so a colleague's design
      appears without restarting

**Done when:** the store location can be pointed anywhere and survives a
restart.

### What came out differently

- **A missing folder is never re-made.** This turned out to be the safety rule
  of the phase, not a detail. Drive not started, folder renamed, disk unplugged
  — all look identical to a fresh install, and making an empty folder shows an
  empty library. Somebody then redraws designs that were never lost, Drive comes
  back, and there are two of everything. So a folder is created only when
  somebody has just named it, never because the settings mentioned it.
- **The tool starts anyway when the folder is unreachable.** It has to: the
  editor is where you say where the designs are, so refusing to start would
  leave no way to fix it. Designs return `503` with `storeUnavailable`, which
  the editor shows as a setup screen naming the path and the reason, with "Look
  again" for when Drive is merely slow to start.
- **The folder can change without a restart.** Repositories resolve the store
  per call rather than holding one, so choosing a new folder takes effect
  immediately.
- **`PALLET_STORE` wins over the chosen folder**, and the UI says so rather than
  letting a change be made that the next start would silently undo.

---

## Phase 3 — Electron shell

- [x] Add Electron; main process starts the existing Express app in-process on a
      free port and loads it in the window
- [x] Native folder picker wired to the Phase 2 setting
- [x] Swap `src/sheet/pdf.ts` to `webContents.printToPDF`, mapping the current
      options one for one:
      `printBackground` → `printBackground`,
      `preferCSSPageSize` → `preferCSSPageSize`,
      `width`/`height` in mm → `pageSize` in microns,
      zero margins → `margins: { marginType: 'none' }`
- [x] **Compare PDFs against Phase 0 references** — this is the gate on the
      whole phase
- [x] Keep `puppeteer-core` for the tools and tests, but out of the app —
      *changed, see below*
- [x] `better-sqlite3` out of the app — *changed, see below*
- [x] Window title, app icon, sensible default size
- [x] Menu: Reload, DevTools, Quit, and choosing the designs folder

**Done when:** the `.exe` runs from a desktop icon, saves to the Drive folder,
and prints PDFs identical to today's.

### The PDF gate, and what it found

`npm run compare:pdf` prints the five reference designs through Electron and
compares them with the Phase 0 PDFs. It compares the *marks on the page* rather
than the bytes of the file, because a PDF carries a creation date and an id that
differ on every print and would only ever say "different": the inflated content
streams, the strings drawn and their order, every drawing operator counted, the
paper size, and that nothing was rasterised.

First run: every drawn string and every operator matched exactly, and the
streams differed by about 1%. The cause was worth knowing rather than waving
through — Chrome's print pipeline emits **tagged-PDF** structure markers
(`/NonStruct <</MCID n>> BDC` … `EMC`) and Electron's did not. Accessibility
metadata, not marks on the page. With those stripped, every mark on every page
was byte-identical.

Electron will emit them too, with `generateTaggedPDF: true`. Turned on, all five
sheets are byte-identical to the browser-printed originals, tagging included —
so a reprint of an old design is the same document it always was.

### What came out differently

- **`puppeteer-core` was not deleted, it was demoted.** It is now a
  devDependency: the CLI tools, the tests and `npm run serve` still print with
  it, and the app never sees it. Deleting it outright would have left the test
  suite and the command line with no way to make a PDF, since they do not run
  inside Electron. The app build aliases the package to a stub, so
  `dist/electron/main.cjs` requires only `electron`, `express` and `zod` — the
  fragile hunt for a browser is gone from what ships, which was the point.
- **`better-sqlite3` likewise.** The converter still needs it, and the converter
  still has to exist for the one machine holding the old database.
- **`src/sheet/browser.ts` became `findBrowser.ts`** and the puppeteer printing
  moved to `browserPrinter.ts`, so `pdf.ts` names neither printer.
- **One print window, reused.** Making and destroying a window per sheet failed
  partway through a run of five: the next window began loading while the last
  was still being torn down. One window taking one sheet at a time is faster and
  has neither problem.
- **`react` and `react-dom` moved to devDependencies** — Vite bundles them into
  the editor, so they are not there at run time.
- **No app icon yet.** `assets/icons/` is empty, so the window falls back to the
  company PNG in the project root. Phase 4 needs a real `.ico`.

## Phase 4 — Packaging and updates

- [x] `electron-builder`, Windows NSIS installer, x64
- [x] `electron-updater` against the repository's Releases — **public, so no
      token anywhere**, neither in the app nor on anybody's machine
- [x] Check for updates on launch, install on next start
- [x] Version number visible in the app, so a bug report says which build
- [x] Test the update path properly — done against a local feed, see below

**Not doing:** code signing. A certificate costs a few hundred a year and there
are four users. The cost is a "Windows protected your PC" prompt on each new
version — click "More info" → "Run anyway".

### What the installer holds

`npm run dist:win` produces `release/Pallet Spec Setup 0.1.0.exe`, about 96 MB,
most of which is Electron. Inside, the only things shipped besides the app's own
bundle are `express`, `zod`, `electron-updater` and their dependencies — no
`puppeteer-core`, no `better-sqlite3`, no React, which is what Phase 3 was for.

The built editor, the costing rates and the icon ride along as resources.

### The update path, tested

Publishing a real release needs pushing, so it was tested against a local feed
instead: two builds, the newer one served over HTTP, the older one run against
it. It found the new version, downloaded it, and said so:

```
Checking for update
Found version 0.1.1
Downloading update from Pallet Spec-0.1.1-arm64-mac.zip
New version 0.1.1 has been downloaded to .../pending/
Version 0.1.1 is ready and will be in place next time.
```

— while going on running as 0.1.0, which is the whole point: nobody is
interrupted mid-design, and the new version is in place next time.

The one step this cannot reach is the swap itself on restart, which on macOS
needs a signed app. On Windows the NSIS installer does it without signing, so
the first real release is where that gets confirmed.

### What came out differently

- **No Wine needed.** The plan expected the Windows build might want it on a
  Mac. electron-builder 26 built the NSIS installer here without it.
- **The rates file had to be dealt with.** `loadRates` resolved
  `config/rates.json` against the working directory, which in an installed app
  is wherever the shortcut happened to launch from — costing would have failed
  on every machine. The rates now ship as a resource and are read once at
  startup, and a rates file that will not load costs costing and nothing else
  rather than refusing to open anybody's designs.
- **A macOS build exists too**, because it is what made it possible to run and
  check a packaged app on this machine. Not something anyone has to use.
- **The icon** is the company mark on a square white field, made from the PNG in
  the project root.

### Making a release

1. `npm version patch` (or `minor`)
2. `npm run release:win` — builds and uploads to a GitHub release
3. Publish the release on GitHub

Every installed copy picks it up the next time it opens.

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

## After Phase 5 — done since

- **A save can no longer overwrite somebody else's quietly.** The editor says
  which version it started from and the store refuses a save that would replace
  a newer one, putting the choice to whoever is at the keyboard. Judged on a
  hash of the document rather than the date, because two edits on the same
  afternoon share a date — which is exactly when two people are most likely to
  collide.
- **Prices moved into the shared folder.** `rates.json` there takes the place of
  the built-in one, so a change to the timber price reaches everybody at once
  instead of needing a release. A file that will not read does not fall back
  quietly: the built-in prices are used and the editor says so in a banner that
  stays, because quoting at prices you were never told about is the failure that
  matters.
- **`electron/` is type-checked now.** It was outside `tsconfig`, and esbuild
  does not check types, so the Electron main process had never been checked at
  all. Adding it found a real one: `margins: { marginType: 'none' }` is not
  Electron's shape — margins are inches, and its default is about 0.4in. It only
  ever printed correctly because `preferCSSPageSize` let the sheet's own `@page`
  rule win first. Now stated properly, and the PDF gate still passes.

## Deliberately not doing yet

- **The converter stays.** `convert.ts` and `better-sqlite3` were to be deleted
  once everyone was on the folder. They are devDependencies and not in the app,
  so they cost nothing shipped — and until the rollout is finished they are the
  only way back from `pallets.sqlite`. Delete them after Phase 5, not before.
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
