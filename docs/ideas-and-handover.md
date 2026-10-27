# Ideas and handover

Everything needed to pick this project up on another computer: where the work stands, the rules the owner works by, and three feature ideas talked through in October 2026, none of them started yet.

Last updated 27-10-2026.

---

## 1. Where things stand

- **Branch:** `main`, in step with `origin/main`. Recent commits:
  - `d208534` the text boxes in the design form are centred, and the top and bottom views line up on the exported PDF
  - `60f00fd` the owner took centring back off the material boxes again (layer table, per-board and per-block tables)
  - `fc5a20d` the `data/` folder was added to git (see the warning in section 6)
- **Live server:** `palletspec.app` on an Azure Debian VM. Updates go out with `deploy/deploy.sh pallet@palletspec.app`, run from the repo root.
- **Roadmap:** [commercialisation.md](commercialisation.md), part C. Phases 0–5 are done.

### Done in the October 2026 chat

**Centred text boxes.** Every number field centres its figure. This is built into `NumberInput`, `OptionalNumberInput`, `DecimalInput` and `NumberOrNaInput` in [src/editor/ui.tsx](../src/editor/ui.tsx), so any new number box is centred too. The short text boxes in the form (code, client part no, species, tolerances, nail rows) ask for it with `text-center` where they're used. Left as they were: the pallet-name heading, the Notes line, the dropdowns, and the sign-in and admin screens.

Offered and not done yet:
- centring the column headings over the layer table
- centring the text in the dropdowns

**Top and bottom views out of line on the PDF.**
- **Cause:** each view on the sheet is a box made of the drawing plus its dimension lines, and the sheet centred each box in its row. When the top boards run along the length and the bottom boards run across the width, the bottom view puts its board spacings *underneath*, which makes its box one row of dimensions taller. Centring the taller box lifted its drawing by half a row, about 3 mm on paper. When both decks run the same way, the boxes are the same height and the fault hid.
- **Fix:** the rows line up the drawings, not the boxes.
  - `ViewMeasure.chromeTop` in [src/render/views.ts](../src/render/views.ts) says how much sits above each drawing.
  - `lineUp()` in [src/sheet/sheet.ts](../src/sheet/sheet.ts) works out a `drops` value for each view.
  - The PDF (HTML sheet, `padding-top` per figure) and the SVG sheet ([src/sheet/svgSheet.ts](../src/sheet/svgSheet.ts), `place(..., drop)`) both use those drops.
  - The side and end elevations got the same fix. Stringer pallets with notch dimensions under the side view had the same problem.
  - Regression test: "lines the drawings of a row up with each other, not their boxes" in [tests/sheet.test.ts](../tests/sheet.test.ts).
- **Known side effect, open:** on pallets like the GMA 48×40, the "SIDE VIEW" and "END VIEW" captions sit at different heights, because each caption stays under its own dimension lines. Levelling them is offered and not done.

---

## 2. Setting up on a new computer

1. Install **Node 22** and **Google Chrome** (or Edge). PDF export drives an installed browser through `puppeteer-core`, so there is no bundled Chromium. The places it looks are listed in `src/sheet/findBrowser.ts`.
2. `git clone https://github.com/WeWake1/pallet_maker.git` then `npm install`.
3. Run it locally, in two terminals:
   - `npm run serve`: the API on `127.0.0.1:5179`, one folder, no sign-in (`--local`). Designs come from `PALLET_STORE`, or `data/library` when that isn't set.
   - `npm run dev`: the editor on Vite at `5180`, proxying `/api/` to 5179.
4. Checks: `npm run typecheck` and `npm test`. All 722 tests passed at the time of the fixes above.
5. Handy CLIs:
   - `npm run sheet -- fixtures/block-1000x800.json` writes the HTML and PDF to `out/`
   - add `--svg` for the SVG sheet, `--brand config/brand.json` for branding

### Testing in a browser without touching the real designs

`npm run serve` points at the real store by default. For screenshots or experiments, run a second copy on other ports with an empty folder:

```sh
PALLET_STORE=/some/scratch/folder PORT=5183 npx tsx src/server/main.ts --local
# plus Vite from a scratch config: root src/editor, port 5182, proxy '^/api/' to http://localhost:5183
```

Then create a client (`POST /api/clients {"name":"Demo Client"}`) and import a fixture with `POST /api/pallets/import {"clientId": "...", "pallet": <fixture json>}`. A script kept outside the repo needs a `node_modules` symlink to the project's to find `puppeteer-core`.

---

## 3. How the owner works (rules to keep)

On the old computer these were kept in Claude's memory, which does not come with the repo. They are written here so they travel with it.

- **The owner is the only author.** Never add `Co-Authored-By: Claude`, "Generated with Claude Code" or any other attribution to commits, PRs, tags or files. Don't commit to `main` or push without asking; describe the change and let the owner commit. Task branches are fine.
- **UI wording is terse.** Short labels only, no explanatory sentences on screen. If an explanation is needed, it goes in the ⓘ hint or the Help panel. Before deleting wording the owner hasn't named, list it with file:line and let them decide.
- **The look:**
  - one sheet with ruled sections, not boxed cards (tinted cards and coloured bands were called "AI generated")
  - sentence-case labels
  - fields as wide as their values, not full-width for a 4-digit number
  - SVG icons rather than typed glyphs
  - the layers as one aligned table
- **Dates are day first:** DD-MM-YYYY on the sheet, in file names and in the app.
- **Never use `data/library` as demo or seed data.** Those are real Ambica customers. Use `fixtures/`.
- **Commercial decisions already made, not to be reopened:**
  - one shared multi-tenant server (one store folder per company), invitation-only email + password login
  - **no pricing at all**
  - branding and people belong to the vendor alone, so customers get no settings
  - tolerances are per design
  - the desktop (Electron) app is retired
  - phones get a "mobile version coming soon" notice; tablets get the app
- **The GMA 48×40 example** comes from the NWPCA Pallet Design System sheet (Hinchcliff Products): https://www.qimarox.com/wp-content/uploads/2020/12/GMA-Stringer.pdf. Notch radius `NOTCH_RADIUS_MM = 38`. A notched runner always has exactly two notches.
- **Windows laptops are mixed x64 and ARM64.** The boss's is a Snapdragon X1. A wrong-architecture build gives no error under emulation, only lag.
- **Still open in the roadmap:**
  - Ambica assets left in the tree
  - `AP-` codes in the fixtures
  - self-service password reset
  - a mail provider plus SPF/DKIM
  - the ITC Anna font in `config/brand/font.otf` and in git history (a licence problem while the repo is public)

---

## 4. Ideas (not started)

Suggested order: **share link first** (it's on the roadmap already and reuses the most existing work), then **load display**, then **wooden boxes**.

### Idea 1: Load display

You enter what the customer ships, and the app shows it stacked on the pallet and tells you how many fit.

- **What you'd type:** the carton size, its weight, the tallest the load may go (say 1000 mm above the deck), and whether cartons may stick out past the edge.
- **What it works out**, for 300×300×200 cartons on a 1200×800 pallet:
  - 4 fit along the 1200 and 2 across the 800, so 8 per layer, with a 200 mm strip left over.
  - 5 layers fit in 1000 mm, so 40 cartons.
  - It then checks 40 × the carton weight against the static and dynamic loads the form already has.
- **Turning cartons matters:** 400×300 cartons give 6 per layer one way and 8 the other. The app tries both.
- **Stacking pattern:** cartons can sit straight in columns, or each layer can be turned to lock the stack together like brickwork (interlocked), which is more stable.
- **Other loads:** drums (round, e.g. 4 on a 1200×1000), sacks, or one big item like a machine entered as a block with a weight.
- **Where it shows:** stacked on the 3D view while designing, and optionally as a "load plan" on the PDF.
- **How hard:**
  - Cartons are easy. Every board is already a rectangular block (`PlacedPiece`: x, y, z, dx, dy, dz), and a carton is the same kind of shape, so the 3D view (`src/render/orbit.ts`) and the isometric can draw it.
  - Drums need a new round shape.
  - Several carton sizes on one pallet is a hard optimisation puzzle, so start with one product size per pallet.
- **Questions to settle:** does the load go on the printed sheet, or only on screen? Is weight per carton required or optional? Is overhang allowed by default?

### Idea 2: View-only share link

A link a pallet manufacturer sends to their client for one design. It carries everything the PDF does, plus a 3D pallet the client can turn round. Nothing on it can be edited. It's already listed under "Things customers will ask for" in [commercialisation.md](commercialisation.md) (B8).

- **How it works:** a "Share" button on a design creates a long, unguessable link, like `palletspec.app/s/7fK2…`. Anyone with the link can open it on a phone or computer without logging in.
- **What the client sees:**
  - the same header, specification and components table as the PDF, plus the four drawings
  - a 3D pallet they can drag and pinch to turn and zoom
  - tap a part and a card pops up with its name, size, quantity and material; the other pieces of the same part light up
  - a "Download PDF" button
- **Decisions to make:**
  - **Frozen or live:** recommended frozen at the moment of sharing, so the client sees exactly what was quoted. After edits, share again.
  - **Expiry and switch-off:** links can run out after a set time, and can be turned off.
  - **Opened count (optional):** "opened 3 times, last 2 days ago" helps sales follow-up.
- **Branding and privacy:** the page carries the manufacturer's logo and watermark only. It shows that one design and nothing else from their library, and isn't indexed by search engines.
- **How hard:** medium.
  - Already there: the drawings and the 3D model. Every piece already knows its part number (`partNo`), and the flat views can already tag pieces for clicking (`interactive` in `renderView`), so tap-to-see-details is simple.
  - New work: the public page, the link handling on the server (a random token stored hashed, like invitations in `src/server/invitations.ts`), a public route outside the signed-in API, and touch controls for phones.

### Idea 3: Wooden boxes (crates)

It's possible, and it fits better than you might expect, but it's the biggest of the three.

- **What a crate is:**
  - A base, which is basically a pallet (often called a skid). The current pallet engine can make that as it is.
  - Two sides, two ends and a lid. Each is a panel of boards or plywood, framed by cleats (battens around the edges and across the middle). Large crates also have diagonal braces.
  - Common styles: closed board crates, plywood boxes, open slatted crates, and fold-flat boxes.
- **How you'd use it:** at "New design" you pick Pallet or Box. You enter the inside size the goods need, plus clearance, weight and style. The app works out the outside size and builds every panel, the same way it builds boards from the layer settings today.
- **What already works:** every piece is a rectangular block with a position and a size. Upright wall boards are that too, so the drawings, 3D view, components table, nail schedule and DXF export mostly carry over.
- **What's new:**
  - Upright panels: today's layers only stack flat.
  - Rules for how panels meet, e.g. whether the side boards cover the ends of the end panels or the other way round.
  - Diagonal braces: the drawing code only handles pieces that sit square to the pallet, so angled pieces are the hardest new part.
  - A drawing for each panel, because shops build panels first and then assemble them.
  - Extra sheet details: inside and outside sizes, the ISPM-15 heat-treatment stamp, how the lid is fixed, and lifting points.
- **Suggested order:**
  1. Plywood boxes with cleats, where every piece is square-on.
  2. Board crates.
  3. Diagonal braces.
  4. Open crates.

---

## 5. Starting with Claude on the new computer

Open the repo and say something like: "read `docs/ideas-and-handover.md` and `docs/commercialisation.md`, then let's start on idea 2." The rules in section 3 apply from the first message.

## 6. Warning: customer designs are in a public repo

Commit `fc5a20d` removed `data/` from `.gitignore` and committed `data/library`: the real Ambica customer designs and their backups, 55 files. That commit has been pushed, and `github.com/WeWake1/pallet_maker` is **public**, so anyone can read those designs right now. If the goal was only to carry them to the new computer, the safer routes are:
- make the repository private on GitHub (Settings → General → Danger zone → Change visibility), or
- copy `data/` across by drive or USB, put `data/` back in `.gitignore`, and remove it from git history.

Deleting the folder in a new commit is not enough. It stays readable in the history until the history is rewritten.
