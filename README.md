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
| [src/sheet/](src/sheet/) | The A4 sheet, its PDF export and its SVG export |
| [src/sheet/content.ts](src/sheet/content.ts) | What the sheet says, with nothing about how it looks |
| [src/brand/](src/brand/) | The company name, the logo and the company font |
| [src/editor/](src/editor/) | The React editor: form, live preview, nudge |
| [docs/guide.ts](docs/guide.ts) | The user guide, drawings and all |
| [src/dxf/](src/dxf/) | DXF R12 output, from `PlacedPiece[]` |
| [src/costing/](src/costing/) | Timber volume and cost, at the rates in the config |
| [config/rates.json](config/rates.json) | Every rate the tool knows. Edit here, nowhere else |
| [src/server/](src/server/) | SQLite storage and the local API |
| [src/duplicate.ts](src/duplicate.ts) | Copying a design into one that is linked to nothing |
| [src/cli/layout.ts](src/cli/layout.ts) | Loads a JSON pallet, prints `PlacedPiece[]` |
| [src/cli/views.ts](src/cli/views.ts) | Writes the views to SVG files |
| [src/cli/sheet.ts](src/cli/sheet.ts) | Writes the specification sheet as HTML, PDF and SVG |
| [fixtures/](fixtures/) | Hand-written pallet documents used by the tests |
| [fixtures/stored/](fixtures/stored/) | Documents frozen as an earlier version wrote them. Never edited |
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
npm run sheet -- fixtures/wing-both-decks.json --svg       # the same sheet as one SVG
npm run dxf -- fixtures/wing-both-decks.json --out out    # R12 DXF
npm run brand                                            # re-embed the company font after it changes
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
`scale` to force one scale across several views, or `maxScale` to cap it while
still letting a view shrink to fit; `sharedScale` and `measureView` answer what a
set of views can agree on, and what each comes out as, without drawing any of
them.

## The sheet

A4 landscape, two columns: data on the left, drawings on the right. The page and
the columns are fixed in millimetres
([src/sheet/layout.ts](src/sheet/layout.ts)); the depth of the three drawing rows
is not, and comes off the pallet being drawn — see below. Every view is rendered
to the pixel size it will occupy rather than scaled to fit, so the stroke weights
land on paper as drawn.

**What the sheet says is settled once**, in
[src/sheet/content.ts](src/sheet/content.ts), with nothing in it about how any of
it looks. The sheet is then set out twice — as HTML for a browser to print, and
as SVG — so a row added to one appears on both and the two can never say
different things.

An attribute in the data column has three states, not two. A value prints. Left
blank it prints as a dash and stays on the sheet, because a question nobody has
answered yet is one the shop should be able to see is open. Set to `na` — typed
into a field, or picked as *not applicable* from a list — the whole row comes
off the sheet and the rows below it close up. Species, planing, both loads,
type, entry and deck all work this way; the overall size and the two tolerances
are on every sheet whatever the design.

The drawings run top and bottom view on the first row, side and end view on the
second, isometric across the full width on the third: plans with plans,
elevations with elevations, and the finished pallet closing the sheet.

**The four flat views share one scale**, so a length is the same length wherever
it appears. Fitting each view to its own cell instead is what made the same
pallet print two different heights: the end elevation is the short way across the
pallet, and in a cell as wide as the side elevation's it came out half again as
large. A drawing that measures one thing two ways is read as a drawing of
something built wrong.

**The rows follow from that scale rather than being set before it**
([`drawingRows`](src/sheet/sheet.ts)), in both directions. Each row is fitted as
a row: the two views on it are given the width of the drawing column less what
all the dimension lanes on that row cost, and the cells are then divided in
proportion to what each view asked for. Splitting a row down the middle instead
sets the shared scale by whichever view carries the most lanes — a plan spends
about a third of its width on them, an elevation a seventh — and wastes what the
other one did not need; fitting the row whole is worth 6–13% of scale across the
fixtures, for free.

Each row is then made as deep as its views turned out to be. A plan is about as
deep as it is wide and takes most of the height, an elevation is a long thin band
and takes little, and the isometric takes what is left — with a floor under it,
so that a deep footprint pulls the shared scale down instead of squeezing the
picture of the finished pallet into a strip. A view narrower than its cell is
centred in it.

The plans are captioned above and the elevations and isometric below, and every
caption is centred on its drawing rather than on the view's box — a view's lanes
are not the same depth on both sides, so the two are different places.

Dimension lanes are packed to avoid collisions. A view cell is 55–90 mm across
depending on what the row's other view needed, so two callouts on neighbouring
boards will print on top of each other unless they are given separate lanes.
Since lanes decide the margins, the margins decide the scale and the scale
decides what collides, `renderView` iterates until the lanes stop moving.

### Branding

A sheet goes out to customers, so it says whose drawing it is: **Ambica Patterns
India Pvt Ltd** corner to corner as a watermark, in the company's own face, and
the mark in the bottom right corner, where a title block's owner belongs on a
drawing.

The watermark is set on the sheet's true diagonal — `atan2(210, 297)`, about
35.3° — rather than at a round angle, so it runs to the corners of *this* page
rather than to the corners of a page it is not on. It is drawn **over** the
sheet, not under it: every view carries a white background of its own, so a
watermark beneath them would show only in the gaps between the drawings. At 6%
it never competes with a dimension line, which is the constraint that matters —
the sheet is built from on a bench. It takes no clicks and is `aria-hidden`,
because it is not information; it is whose drawing this is. Angle, opacity, size
and tracking are all in `WATERMARK` in
[src/sheet/layout.ts](src/sheet/layout.ts), and both renderers read them, so the
printed sheet and the SVG can never drift apart.

Both travel *inside* the document, and by different means.

The **font** is base64 in [src/brand/assets.ts](src/brand/assets.ts), generated
by `npm run brand` from the file in the project root. A sheet is handed to the
printer, and to the browser, as one self-contained string with no base URL to
resolve a file path against, so a linked face would simply not be there.
[tests/branding.test.ts](tests/branding.test.ts) checks every `url()` on the
sheet is a data URI.

The **logo is traced to geometry** in [src/brand/logo.ts](src/brand/logo.ts):
a triangle, the stem of a P, and a bowl that is a half-*ellipse* — 194 across
against 175.5 down — which is why it is measured off the artwork rather than
drawn from memory. Two `<path>`s, a few hundred bytes against fifty kilobytes of
base64, sharp at any size, and nothing raster left anywhere in the outputs:
[tests/pdf.test.ts](tests/pdf.test.ts) is back to asserting the PDF contains no
image XObject at all. The trace was checked against the PNG by compositing both
over white and comparing pixels — 0.33% differ, and those are the antialiased
edges.

**If the artwork ever changes, `logo.ts` has to be re-measured by hand.** Nothing
reads the PNG at build time.

The watermark costs the drawings nothing, since it lies over the page rather
than taking a band of its own. The logo costs 7 mm: the footer is that much
deeper than it was, so the mark stands beside the projection note instead of
over the drawing above it. The views auto-fit, so they simply came down by that
much. `SHEET` and `LOGO` in [src/sheet/layout.ts](src/sheet/layout.ts) hold it
all, and [tests/sheet.test.ts](tests/sheet.test.ts) checks the bands still add up
to the page.

### PDF

`puppeteer-core` drives a Chromium that is already on the machine rather than
downloading its own. It looks for Edge then Chrome in the usual places; set
`PALLET_BROWSER` to point it somewhere else.

The page carries its own A4 landscape `@page` rule and the browser is told to
honour it. Nothing but the logo is rasterised:
[tests/pdf.test.ts](tests/pdf.test.ts) prints a sheet and checks the result is
one page of the right size, with embedded fonts and at most two image
XObjects — the logo and the soft mask its transparency needs. A third would mean
something in the pipeline had rasterised a drawing.

### SVG

The whole sheet as one vector file, for taking a drawing somewhere else and
working on it: **SVG** in the editor, `/api/pallets/:id/sheet.svg`, or
`npm run sheet -- <file> --svg`. Canva, Illustrator, Inkscape and Figma all open
it and let every line and every word be moved, recoloured or deleted. The DXF
cannot do that job — it is a CAD file and page-layout software does not read it —
and the two are for different things.

It is the same page, not just the drawing: header, the written column, the five
views and the logo. SVG has no text layout of its own, so
[src/sheet/svgSheet.ts](src/sheet/svgSheet.ts) places every box on the same
millimetre grid the printed sheet is built on.

#### It has to stay takeable-apart

**Every mark on it is a basic shape or a run of text, and that is the whole
point.** A page-layout program parses a subset of SVG, and on meeting anything
outside that subset the usual behaviour is not to fail but to give up and
flatten the page to a picture — at which point the file is a worse PNG than a
PNG. The first version of this export did exactly that, and the four things
responsible were:

| Was | Now |
|---|---|
| Five nested `<svg>` roots, one per view | Each view is a `<g>`, placed with a translate — `SvgDocument.fragment` |
| A `<style>` block carrying the font as `@font-face` | No stylesheet; faces are named on each run |
| Three `<clipPath>`s | The data column stops rather than clips; the ghost layers are worked out as rectangle overlaps |
| An `<image>` holding the logo as base64 PNG | The logo is traced to two `<path>`s in [src/brand/logo.ts](src/brand/logo.ts) |

The file went from 200 kB to 73 kB in the process, and every board is now its
own element that can be picked up and moved.
[tests/branding.test.ts](tests/branding.test.ts) fails if any of the four comes
back, and checks the whole file is nothing but `circle`, `g`, `line`, `path`,
`polygon`, `rect`, `svg`, `text` and `title`.

One deliberate difference from the printed sheet. Where a bearer shows through
the deck, the PDF declares a clip and the SVG draws the overlap rectangles
instead. A clip cuts the ghost's outline; an overlap rectangle is stroked all
the way round, so it gains an edge on the two sides where the board cut it —
except those are the board's own edges, which already carry a stroke three times
heavier. Measured across every fixture, top and bottom views: at most **0.14% of
pixels differ at all, none by more than 32/255**. The PDF is untouched.

Two things to know about Canva specifically. Its SVG import is a Pro feature, so
on a free plan use the PDF — Canva converts PDF to editable elements too, and
this one is true vector. And the SVG carries no embedded font, so the company
name in the watermark comes through in whatever sans is available; it is sized
for that fallback (`WATERMARK.svgFontSize`, measured, not guessed) rather than
for ITC Anna, so it still runs corner to corner instead of off the page.

## The design library

The home screen: every client in turn, each with their designs as cards. A card
carries the three things most often wanted of a design that is not being changed
— **PDF** opens its sheet, **Copy** duplicates it and opens the copy, **×**
deletes it — so none of them needs the editor opened first. Each is offered on
the card itself, plainly and always visible, because a control that only appears
on hover is one nobody finds.

Copy opens the copy rather than leaving it on the dashboard: it carries the same
name and code as what it was copied from, so two cards that cannot be told apart
is exactly what leaving it there would produce. Rename one of them "… (old)" and
they read plainly.

Deleting from a card takes the browser's draft of that design with it. A draft
left behind would come straight back as a card of a design that has just been
thrown away, and could be saved again from there.

The search box narrows every client at once, by design name, code or client
name, and drops the clients left with nothing — a search that left every empty
client on screen would bury the handful that matched. Cards are ordered most
recently edited first. The store stamps a date and not a time, so that only
sorts to the day; a day's work is one bucket and the code is what tells those
apart. See `visibleSections` in
[src/editor/Dashboard.tsx](src/editor/Dashboard.tsx) and
[tests/dashboard.test.ts](tests/dashboard.test.ts).

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

### Undo, and the keyboard

Every change is a change to the document, and the drawing, the costing and the
problem list are all regenerated from it, so a step backwards is just an older
document put back — there is no second thing to unwind.
[src/editor/history.ts](src/editor/history.ts) keeps the list of them.

| | |
| --- | --- |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+Shift+Z`, `Ctrl+Y` | Redo |
| `⌘S` / `Ctrl+S` | Save |
| `←` `→` `↑` `↓` | Nudge the selected board, shift for 10 |
| `Delete` | Remove the selected board |
| `Esc` | Leave the field, then let the board go |

Undo and Save work from wherever the cursor is, mid-field included: the document
is what they act on, and the browser's own undo inside a text field knows
nothing about the board that was deleted a moment ago. The rest wait until
nothing is being typed into, because `Delete` belongs to the digits under the
cursor first.

A number typed digit by digit is **one** step, not four: edits to the same field
within 600 ms of each other fold together, and a pause or a move to another
field starts a new one. Saving clears the list — those steps are all in the
store now. Selecting a board is not a step at all, and neither is an edit that
landed on nothing; recording either would mean pressing Undo and watching
nothing happen.

A new pallet starts as a whole plain 1200 × 800 block pallet rather than an
empty stack of layers. Nearly every design is a variation on that one, so the
work is changing numbers rather than building a pallet before anything can be
seen.

### One size for the whole layer

In about eight designs in ten, every board in a layer is the same size. So each
layer is headed by a row that describes the whole of it — length, width,
thickness, how many, and what timber they are all made of. Seven identical top
boards is three numbers and a 7, not seven rows of the same numbers typed out
again. Blocks have the same row, over the whole grid.

The board-by-board table underneath is a correction tool rather than something
to read, so it is folded away. Its heading says how many components the layer
has and whether they are all one size; opening it is how the odd board out gets
its own numbers, and it opens by itself where a design already has more than one
size in the layer, or where a board has just been clicked on the drawing. Where
boards genuinely differ, the layer row above reads **mixed**.

A size set across a layer writes only what it was given. Nudges and joins are
each about where one board sits rather than what size it is, so they survive the
whole layer being resized.

### Dimensions read length, width, thickness

Every size in the editor and on the sheet is stated in that order, which is the
order the shop floor says them in, with the quantity last: a top board is
`1000 × 100 × 18`, seven off.

### Part numbers are worked out, not typed

A part is a distinct piece of timber — one kind of component, one size, one
material, one variant — and its number falls out of the design rather than being
entered against each board. Numbering runs from the top layer down, in the order
components appear. Two boards of one size share a number; widen one and it
becomes a part of its own, with no field to keep in step and no way for a number
to mean two different sizes. See [src/geometry/parts.ts](src/geometry/parts.ts);
the numbers appear on the components table of the printed sheet.

### The pallet code is optional

A design is drawn, saved and printed long before the shop has a code to give it.
Requiring one up front only meant a placeholder was typed in and never
corrected, so a design saves without it and the sheet prints its name alone.

### Unsaved work

The store is only ever written by **Save** — a half-finished edit must never
overwrite a design the shop is already building to, and there is no history to
recover it from. That used to leave the work between one Save and the next with
nowhere to live, so closing the tab lost it.

Every edit is now written to `localStorage` as it is typed, half a second behind
the keyboard, and immediately if the page is going away. Reopening a design
picks its draft up and says where it came from; the draft is dropped as soon as
the store holds the same thing. A design that was never saved has no row to be a
card of, so its draft appears on the dashboard as one, marked *never saved* —
without that, the only copy of an afternoon's work would be somewhere nothing on
screen could reach. Leaving the page with unsaved work also raises the browser's
own "leave site?" prompt, so an accidental close is caught rather than only
recovered from.

Drafts are not versions: nothing reads one but the editor that wrote it, they
are never validated (half the point is holding a design too unfinished to save),
and they are cleaned up after 30 days. Storage that is unavailable or full costs
the drafts and nothing else — see [src/editor/drafts.ts](src/editor/drafts.ts).

The editor is the one place a design may be incomplete. It lays out and previews
whatever it has, listing what is still missing alongside anything the layout
engine objects to, and refuses to print a sheet while the layout has errors.

Vite serves it with esbuild handling JSX, so there is no React plugin and no
Fast Refresh: editing a component reloads the page. `@vitejs/plugin-react`
requires Vite 8 while Vitest pins Vite 5, and one fewer dependency to keep in
step is worth more here than hot reload.

## Storage

One local SQLite file, `data/pallets.sqlite` by default and `PALLET_DB`
otherwise. A pallet is stored as its document, with the few fields the design
list needs lifted into columns: the document is the truth, the columns are an
index. `npm run serve` puts an Express API in front of it and serves the built
editor from the same port, so the whole tool is one process.

A design is edited in place. Saving overwrites it and there is no history: to
keep an old design, **duplicate it before reworking it** — the copy is a separate
row from that moment on and nothing done to either can reach the other. The date
a design carries is the whole of what says how current it is.

PDFs are served from the store rather than from the editor's working copy, and
named for the design and its date, so what is printed is what is recorded.

### Backups

Every start copies the database into `data/backups/` and keeps the last twenty
(`PALLET_BACKUPS` to change that). The copy is taken with SQLite's own backup,
not a file copy that could catch a half-written page.

That protects against this program spoiling the file. It does nothing about a
disk fault, so copy the `data` folder somewhere else now and then — or export
the library, below, which is the same designs in a form anything can read.

### Designs in and out of files

The database is a file only this program can read, on one machine. Designs leave
it as JSON, which is the document itself rather than a picture of it — the only
output that can be opened again and worked on. A PDF cannot: it is a printout
and a dead end.

**One design.** `JSON` on its card, or Export in the editor, writes
`<design> - <client> - <date>.json`. `Import` on a client's row reads one back
as a **new** design of theirs. It is given a new id on the way in, so a file
from somewhere else can never overwrite a design already held, and whose it is
gets settled by whoever imports it rather than by what the file says.

**Everything.** `Export library` writes `pallet-library-<date>.json`: every
client, every design, dates and all. That one file is the whole business record
in a form that fits in a Drive folder or on a stick, and is what to keep
somewhere other than this computer.

`Import library` reads one back. Designs keep their ids on the way out, so
importing the same file twice does nothing the second time, and a library
restored onto an empty machine comes back as exactly what it was rather than as
copies of it. **Nothing is overwritten**: designs already held are counted and
left alone, and only then is replacing them offered, with the number said out
loud. Clients are matched by name, because the same customer entered by hand on
two machines has one name and two ids.

The format is in [src/library.ts](src/library.ts) and what it does to the store
is in [src/server/library.ts](src/server/library.ts).

## Keeping designs safe across a change to this program

Once a couple of hundred designs are in it, that one file is the business
record — the thing a client complaint gets judged against. Everything below is
about not breaking it while the program keeps growing.

**A design is a JSON document, read back through the schema every time it is
opened.** That read is the one place where a change to this program can lose
somebody's work. Make a field required that a stored document has not got, and
every design drawn before the change stops opening at once. The database is
untouched and the backups are fine, and none of that helps, because nothing can
read them any more.

So the rule is: **a field added later must be optional or carry a default.**
Adding one that way is safe, and so is anything that only changes how the sheet
looks — the sheet is rendered fresh from the document every time it is asked
for, and nothing about it is stored. Renaming a field, removing one, or
tightening what an existing one will accept is not safe, and needs a migration
in [src/server/db.ts](src/server/db.ts) — the way the change that removed
revisions had one, which rewrote every row rather than dropping any.

Two guards, in [tests/compatibility.test.ts](tests/compatibility.test.ts):

- **Frozen snapshots.** [fixtures/stored/](fixtures/stored/) holds documents
  exactly as a version of this program wrote them, on the day it wrote them.
  They are never edited. Every one must still parse, still lay out and still
  print, on paper and as vector. Add a snapshot whenever the document shape
  changes, so the shape being retired is remembered.
- **What may be absent.** Every field a stored document is allowed not to carry
  is listed and checked one at a time. Taking one away must not stop a document
  parsing.

Both run in `npm test`. A change that would strand existing designs fails there
rather than in the shop.

One thing the tests cannot cover: **a sheet already sent to a client.** Changing
the output page changes what a reprint of an old design looks like — the drawing
is still correct, but it will not be pixel-for-pixel the document that was
emailed last year. If that matters for a particular job, keep the PDF that was
sent alongside the order rather than relying on being able to reproduce it.

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
| M pallet | A bottom deck whose boards run both ways: two across the width at the ends, three along the length between them |

A sheet that *replaces* the top boards is a `top_deck` whose content is a sheet,
which is what "plywood sheet replaces the top board layer" means. Type 3 is the
one that does not replace anything, so it has a layer kind of its own: `panel`.
That is the model being widened rather than a branch being added for one pallet.

### A deck that runs two ways

A layer runs one way, and for nearly every deck that is right. The M pallet is
the one it is wrong for: five bottom boards, two crossing the width at the ends
and three running along the length between them, every one of the five nailed
straight to the blocks. Those five are not two decks stacked — they are one
course of timber at one height, and a stack of layers cannot say so.

So a layer can be marked **same level as the layer above** (`sameLevelAsPrev`)
and share its height instead of sitting under it. Layers sharing a level share
a `zBottom`, the level counts once towards the pallet height, and each keeps its
own direction, span, offset and run — which is exactly what the cross-running
group needs in order to be cut short and placed between the boards it sits
between. The M pallet's bottom deck is two layers: `bottom-ends` across the
width, and `bottom-inner` along the length with a run of 1000 from 100.

That widens the model rather than adding a branch, so everything downstream
follows for free — costing, DXF, part numbers and the drawings all read the same
piece list. Three things did have to learn that a *course* is not a *layer*:

- **Nails.** A joint is between two courses. The M pallet's bottom joint is the
  blocks against all five boards, not the ends against the inner boards.
- **The near layer.** The top and bottom views draw the course you are looking
  at solid and everything under it faint. Holding back half a deck because it
  runs the other way would say it was underneath the rest, which it is not.
- **Height.** A course is as thick as its thickest layer, counted once.

Two layers at one height cannot both have timber in the same place, so an
overlap between them in plan is an error (`level_clash`) — usually a group that
was never cut short. **Fit between the boards on this level** in the editor does
that arithmetic: it reads the run left free by the boards sharing the level and
writes the run span, the run offset and the board lengths together, so the three
cannot disagree. It fills the fields in and leaves them yours to change; nothing
is applied behind the form.

## Nails

Nails are two things that deliberately do not talk to each other.

**Where they go** is the drawing. A joint is any two layers that meet, and a
crossing is one place where a piece of the upper crosses a piece of the lower.
Every crossing carries two nails on a diagonal — which is how a board is pinned
against turning on its fixing — and the four corners of the top face carry
three. Only the joints at the two faces count, since an internal joint is under
timber and can be neither seen nor reached.

That default covers most of a pallet. Anywhere it does not, the crossing is
clicked: open the top or bottom view in the editor, turn on **Place nails**, and
each click steps that crossing 0 → 1 → 2 → 3 → 4 and round again — one in the
centre, two on a diagonal, three in a triangle, four in a square. Only what you
changed is written to the document, keyed by the two boards that cross rather
than by a position, so resizing the pallet carries the nails along with it and a
crossing clicked back to its default stops being recorded at all.

The dots are drawn in the two plan views and in the pictorial ones. A NailDot
carries the height of the surface its head sits on, so the isometric can put it
on the timber rather than on the pallet's floor. Only the face being looked at
shows: the printed isometric has a fixed eye above the deck and shows the top
face; the editor's 3D view swaps to the underside as soon as the eye is dragged
below it.

**How many are bought** is the schedule on the sheet: label, type, size and
quantity, typed by hand and printed as written. Costing prices that table.

The two used to be one thing — the schedule was counted off the dots, and a
spec's label was matched against layer names by a list of words it might contain
("plywood", "centre board", "stringer") to decide which joint it overrode. It
guessed wrong more often than it guessed right, and a wrong count on a sheet is
worse than an empty field. So the guessing is gone: the drawing states where,
the estimator states how many, and neither is derived from the other.

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
editor, storage, DXF and costing.

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
