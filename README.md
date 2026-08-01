# Pallet Specification Sheet Generator

Turns pallet dimensions into a standardised, printable specification sheet.
Build brief and staging plan: [pallet-spec-generator-build-prompt.md](pallet-spec-generator-build-prompt.md).

**The drawing is always regenerated from the data.** Nothing is ever edited on
the drawing itself; every adjustment, including a manual nudge, is a number on a
component.

## Where things are

| Path | What it is |
|---|---|
| [src/types.ts](src/types.ts) | Domain types — pallet, layer, slot, block grid, sheet |
| [src/schema.ts](src/schema.ts) | Zod shape for a pallet document, with defaults |
| [src/geometry/](src/geometry/) | The layout engine. No React, no zod, no I/O |
| [src/render/](src/render/) | SVG views, built from `PlacedPiece[]` alone |
| [src/sheet/](src/sheet/) | The A4 sheet and its PDF export |
| [src/editor/](src/editor/) | The React editor: form, live preview, nudge |
| [docs/guide.ts](docs/guide.ts) | The user guide, drawings and all |
| [src/dxf/](src/dxf/) | DXF R12 output, from `PlacedPiece[]` |
| [src/costing/](src/costing/) | Timber volume and cost, at the rates in the config |
| [config/rates.json](config/rates.json) | Every rate the tool knows. Edit here, nowhere else |
| [src/server/](src/server/) | SQLite storage, the revision rules, the local API |
| [src/revisions.ts](src/revisions.ts) | Next revision, and copying a design |
| [src/cli/layout.ts](src/cli/layout.ts) | Loads a JSON pallet, prints `PlacedPiece[]` |
| [src/cli/views.ts](src/cli/views.ts) | Writes the views to SVG files |
| [src/cli/sheet.ts](src/cli/sheet.ts) | Writes the specification sheet as HTML and PDF |
| [fixtures/](fixtures/) | Hand-written pallet documents used by the tests |
| [tests/](tests/) | Vitest suites |

## Commands

```
npm start                                             # build, then run the whole tool
npm run serve                                         # API and stored designs, port 5179
npm run dev                                           # the editor with live reload, port 5180
npm test                                              # unit tests
npm run typecheck
npm run layout -- fixtures/block-1000x800.json          # PlacedPiece[] as JSON
npm run layout -- fixtures/wing-both-decks.json --summary
npm run layout -- fixtures/block-1000x800.json --full   # whole layout result
npm run views -- fixtures/wing-both-decks.json --out out # five SVGs + contact sheet
npm run sheet -- fixtures/wing-both-decks.json --out out # the spec sheet, HTML and PDF
npm run sheet -- fixtures/wing-both-decks.json --html-only
npm run dxf -- fixtures/wing-both-decks.json --out out    # R12 DXF
npm run costing -- fixtures/block-1000x800.json           # timber volume and cost
npm run guide                                            # the user guide, HTML and PDF
```

`views` writes each view twice, in colour and desaturated, plus an HTML contact
sheet that puts the two side by side. That sheet is the greyscale check: if the
near layer stops reading as the near layer in the grey column, the weights are
wrong.

## Coordinate system

Origin at the bottom-left-bottom corner. `x` runs along the pallet length, which
is the direction the top boards run. `y` runs across the width. `z` runs up from
the underside of the bottom-most layer. Every input dimension is an integer
number of millimetres; computed gaps may be fractional.

## Engine entry points

- `computeLayout(pallet)` — strict. Throws `PalletLayoutError` naming the layer
  rather than producing a drawing that would be wrong.
- `analysePallet(pallet)` — same result but collects issues instead of throwing,
  so the editor can show a design that is still being worked on.
- `validatePallet(pallet)` — the issue list alone.

The result carries the flat `pieces` list that every renderer and exporter
consumes, plus the per-layer spacing (`gap`, `slack`, `positions`) and the wing
overhangs, so nothing downstream ever recomputes geometry.

## Views

Five views: isometric, top, bottom, side (the long face) and end (the short
face). The bottom view is mirrored across the width, so it is a real view from
underneath rather than a flipped top view.

Emphasis is carried by three signals at once, never colour alone: colour per
layer kind, opacity 100% near against 30% behind, and stroke weight 1.2 against
0.4. In the top and bottom views the layers behind would be hidden under the
near one, so they are drawn a second time as faint outlines clipped to the deck.
Where the bearers and blocks run is exactly what the production team needs.

The isometric is a standard 30 degree axonometric generated geometrically from
the same piece list: three visible faces each, stepped in tone, painted back to
front. Nothing in it is faint and nothing is dimensioned — it is the pictorial
view and the flat views carry the numbers.

Ordering the isometric needs more than a depth sort. The far end of a long deck
board is deeper than a bearer sitting under its near end, so a scalar sort paints
the bearer over the board it holds up. Pieces that overlap on screen are ordered
pairwise instead — one is behind another when it is entirely on the far side
along one axis — and the result is topologically sorted.

Lengths in the SVG are CSS pixels, so a view embedded at its natural size puts 1
unit at 1/96 inch on paper and the stroke weights above land as drawn. Pass
`scale` to force one scale across several views.

## The sheet

A4 landscape, two columns: data on the left, drawings on the right. Every box on
it is fixed in millimetres ([src/sheet/layout.ts](src/sheet/layout.ts)), and each
view is rendered to the exact pixel size of its cell rather than scaled to fit,
so the stroke weights land on paper as drawn.

The drawings run top and bottom view on the first row, side and end view on the
second, isometric across the full width on the third: plans with plans,
elevations with elevations, and the finished pallet closing the sheet. The rows
are deliberately unequal. An elevation is a long thin band that would sit in the
middle of a tall row with air above and below it, so it takes a fifth of the
height and the isometric takes what is left.

Each view fits its own cell rather than sharing one scale across the sheet. A
shared scale would size everything off the top view, and the side view — 1000
long against 156 tall — would then use a fifth of the row it is given.

Dimension lanes are packed to avoid collisions. A view cell is about 90 by 62 mm,
so two callouts on neighbouring boards will print on top of each other unless
they are given separate lanes. Since lanes decide the margins, the margins decide
the scale and the scale decides what collides, `renderView` iterates until the
lanes stop moving.

### PDF

`puppeteer-core` drives a Chromium that is already on the machine rather than
downloading its own. It looks for Edge then Chrome in the usual places; set
`PALLET_BROWSER` to point it somewhere else.

The page carries its own A4 landscape `@page` rule and the browser is told to
honour it. Nothing is rasterised anywhere: [tests/pdf.test.ts](tests/pdf.test.ts)
prints a sheet and checks the result is one page of the right size with embedded
fonts and no image XObject at all.

## The editor

`npm run dev`. Left panel is the form, right panel is a live preview of the top
view, regenerated from the document on every keystroke by the same renderer the
sheet and the PDF use — so what is on screen is what will print.

Clicking a board selects it and focuses its row in the form. **Selection only,
no dragging.** A selected board takes a nudge typed in millimetres or stepped
with the arrow keys (shift for 10), and that value is saved to `slot.nudgeMm`.
Nothing else records where the board is: nudge a board and the drawing prints
its real position from the nearest edge, because the number changed and the
drawing was rebuilt, not because anything moved the drawing.

A new pallet starts as a whole plain 1000 × 800 block pallet rather than an
empty stack of layers. Nearly every design is a variation on that one, so the
work is changing numbers rather than building a pallet before anything can be
seen.

The editor is the one place a design may be incomplete. It lays out and previews
whatever it has, listing what is still missing alongside anything the layout
engine objects to, and refuses to print a sheet while the layout has errors.

Vite serves it with esbuild handling JSX, so there is no React plugin and no
Fast Refresh: editing a component reloads the page. `@vitejs/plugin-react`
requires Vite 8 while Vitest pins Vite 5, and one fewer dependency to keep in
step is worth more here than hot reload.

## Storage and revisions

One local SQLite file, `data/pallets.sqlite` by default and `PALLET_DB`
otherwise. A pallet is stored as its document, with the few fields the design
list needs lifted into columns: the document is the truth, the columns are an
index. `npm run serve` puts an Express API in front of it and serves the built
editor from the same port, so the whole tool is one process.

A published revision is frozen and never edited. Editing one creates a new row
with the next revision letter, `supersedes` pointing at the previous id, and a
fresh date; the old row is not touched. Revision letters count like spreadsheet
columns, so Z is followed by AA.

**That rule is enforced by the database, not only by the code above it.**
Triggers on the table refuse any update or delete of a frozen row
([db.ts](src/server/db.ts)). A pallet built last year was built to rev A, and if
a client raises a complaint that row has to still say what it said then — which
has to hold even if a later version of this program forgets the rule.

PDFs are served from the store rather than from the editor's working copy, and
named for the design and its revision, so what is printed is what is recorded.

### Backups

Every start copies the database into `data/backups/` and keeps the last twenty
(`PALLET_BACKUPS` to change that). The copy is taken with SQLite's own backup,
not a file copy that could catch a half-written page, and the frozen-row
triggers come with it: a snapshot is as much the record as the original.

The triggers stop the program from spoiling the file. They do nothing about a
disk fault, so copy the `data` folder somewhere else now and then.

## The pallets it knows about

A pallet is layers, and a layer is boards, a block grid or a plywood sheet.
Everything below falls out of that; none of it is a code path of its own.

| | |
|---|---|
| Block, 4-way | Top boards, centre boards, a 3 x 3 block grid, bottom boards |
| Stringer, 2-way | Runners in place of the block layer: full length pieces along the pallet, so forks go in from two sides only |
| Wing | Any of these with the deck wider than the base. Span and offset, not a special case |
| Plywood type 1 | A sheet straight onto the blocks |
| Plywood type 2 | A sheet onto centre boards that connect the blocks |
| Plywood type 3 | A whole boarded pallet with a sheet laid over its top deck |

A sheet that *replaces* the top boards is a `top_deck` whose content is a sheet,
which is what "plywood sheet replaces the top board layer" means. Type 3 is the
one that does not replace anything, so it has a layer kind of its own: `panel`.
That is the model being widened rather than a branch being added for one pallet.

Nails follow from the same idea. A joint is any two layers that meet, and a nail
spec names the two by their vocabulary — "plywood sheet to centre board", "top
board to runner". Only the joints at the two faces are drawn, since an internal
joint is under timber and cannot be seen.

## DXF

The plan, at 1:1 in millimetres, one CAD layer per pallet layer kind so the shop
can switch the decks off and look at the blocks. Coordinates are the pallet's
own, straight off `PlacedPiece[]`, so measuring a board in CAD gives the number
that is in the document. Dimensions come from the same list the sheet
dimensions from, so the two outputs cannot disagree about which numbers a
drawing carries.

**R12 has no LWPOLYLINE.** The brief asks for R12 and for LWPOLYLINE, and those
cannot both be had: that entity arrived with R14. R12 is the part worth keeping,
since the reason to choose it is that it opens everywhere, so an outline here is
a closed `POLYLINE` with its `VERTEX` entities and a `SEQEND` — exactly the
verbosity being paid for. Group codes are typed: flags and colours are written
as integers, coordinates as reals, because a reader expecting an integer will
not take `1.0000`.

## Costing

Timber volume is the sum of `dx × dy × dz` over every placed piece, so it counts
what the drawing shows and nothing else. 1 CFT is 28,316,846.6 mm³.

Every rate is in [config/rates.json](config/rates.json) and nowhere else
(`PALLET_RATES` to point elsewhere). Timber is priced per CFT by material and
nails per thousand by type — a pallet with hardwood blocks under a pine deck
costs what its parts cost — and both fall back to `default`. Overhead is a fixed
amount per pallet plus a percentage of materials.

The editor costs the design as it is edited, using rates it fetches from the
server, so one file remains the only place a rate is written down. Costing never
appears on the sheet: that is a specification, not a quotation.

## Build stage

Stages 1 to 7 are complete: geometry, flat views, isometric, sheet and PDF,
editor, storage and revisions, DXF and costing.

The fixtures in [fixtures/](fixtures/) are the shapes the model has been taken
all the way through, from layout to sheet, DXF and costing: a plain block
pallet, two board widths, a joined pair, a deeper centre block row, a wing with
both decks overhanging, a nudged board, a plywood panel deck, and runners in
place of blocks. More special cases will surface. The layer and slot model is
deliberately general so that most of them are data rather than code; when one
truly does not fit, widen the model rather than adding a branch for that one
pallet.

Stage 8, spreadsheet import, is deliberately not built. The brief says to build
it only if manual entry has proved slow in practice, and to decide after
entering about 20 designs by hand.
