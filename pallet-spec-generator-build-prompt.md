# Pallet Specification Sheet Generator — Build Brief

Give this whole file to Claude Code at the start. Then work through the stages
one at a time. Do not let it build everything in one run.

---

## 1. What this is

A desktop tool for a wooden pallet manufacturer that turns pallet dimensions into
a standardised, printable specification sheet. Today these sheets are drawn by
hand in Adobe Illustrator and only exist for some designs, so the production team
usually works from memory or a handwritten slip of numbers.

There are roughly 200 designs across 60+ clients. One person uses this tool —
the owner. There is no multi-user requirement, no authentication, no cloud.
It runs on his machine.

**The single most important architectural rule:** the drawing is always
regenerated from the data. Nothing is ever edited on the drawing itself. Every
adjustment, including manual nudges, is stored as a number on a component. If
this rule is broken the sheet and the record drift apart and the system is
worthless.

---

## 2. Stack

- **Vite + React + TypeScript** for the editor UI
- **Node + Express + better-sqlite3** for persistence, single local `.sqlite` file
- **Tailwind** for UI styling only — not for the spec sheet
- **Puppeteer** for PDF export, printing an A4 landscape HTML page
- **Zod** for validating the pallet document shape

The spec sheet is built as an HTML page with inline SVG, then printed to PDF by
Puppeteer. Do not use a canvas or a raster step anywhere — the PDF must be true
vector with selectable text.

Geometry lives in a framework-free TypeScript module with no React imports. It
must be usable from a plain Node script. This matters for testing.

---

## 3. Domain vocabulary

Use these exact terms throughout the code.

| Term | Meaning |
|---|---|
| Top board | Deck board on the top face |
| Centre board | Bearer between the top boards and the blocks |
| Bottom board | Deck board on the bottom face |
| Block | One of the 9 blocks in a 3×3 grid on a 4-way pallet |
| Runner | Full-length piece replacing the entire block layer on a 2-way pallet |
| Plywood sheet | Full panel replacing the top board layer |
| Layer | One horizontal level of the pallet |
| Slot | One position in a layer's left-to-right order |
| Wing | Deck overhanging the base below it |

`length` always runs the same direction as the top boards. `width` is across
them. Every dimension in the system is millimetres, integer.

---

## 4. Data model

```ts
type Direction = 'along_length' | 'across_width';

interface Pallet {
  id: string;
  palletCode: string;          // e.g. AP-001
  clientName: string;
  clientPartNo?: string;
  palletName: string;          // e.g. "1000 x 800"

  overallLength: number;
  overallWidth: number;
  overallHeight: number;       // derived by default, overridable

  palletType: 'block_4way' | 'stringer_2way' | 'plywood_type1'
            | 'plywood_type2' | 'wing' | 'other';
  deckType: 'single_face' | 'double_face_reversible'
          | 'double_face_non_reversible';
  entry: '2_way' | '4_way' | 'partial_4way';

  species: string;
  planing: 'none' | '1_side' | '2_side' | '4_side';
  staticLoadKg?: number;
  dynamicLoadKg?: number;

  nails: NailSpec[];
  notes?: string;

  revision: string;            // 'A', 'B', ...
  revisionDate: string;        // ISO
  supersedes?: string;         // id of the previous revision
  frozen: boolean;

  layers: Layer[];             // ordered top to bottom
}

interface NailSpec {
  label: string;               // e.g. "top board to centre board"
  type: string;                // e.g. "wire nail"
  sizeMm: number;
  count: number;
}

interface Layer {
  id: string;
  kind: 'top_deck' | 'bearer' | 'block' | 'runner' | 'bottom_deck';
  order: number;
  direction: Direction;        // ignored for grid layers

  // Extent ACROSS the direction the boards run.
  // null means the full pallet dimension.
  spanMm: number | null;
  offsetMm: number;            // default 0

  // Extent ALONG the direction the boards run. Only needed when the
  // base is inset on all four sides. null means flush.
  runSpanMm: number | null;
  runOffsetMm: number;         // default 0

  content:
    | { type: 'sequence'; slots: Slot[] }
    | { type: 'grid'; grid: BlockGrid }
    | { type: 'sheet'; sheet: SheetSpec };
}

interface Slot {
  partNo: number;              // slots with identical dimensions share a partNo
  thickness: number;
  width: number;
  length: number;
  material: string;
  joinedToPrev: boolean;       // no gap between this slot and the previous
  nudgeMm: number;             // manual override across the run, default 0
  variant?: string;            // e.g. "outer", "inner"
}

interface BlockGrid {
  rows: number;                // normally 3
  cols: number;                // normally 3
  cells: BlockCell[][];        // [row][col]
  rowSpanMm: number | null;
  rowOffsetMm: number;
  colSpanMm: number | null;
  colOffsetMm: number;
}

interface BlockCell {
  partNo: number;
  lengthMm: number;            // along the pallet length
  widthMm: number;             // across the pallet width
  heightMm: number;
  material: string;
  variant?: string;
}

interface SheetSpec {
  partNo: number;
  thickness: number;
  width: number;
  length: number;
  material: string;            // 'plywood'
}
```

Presswood pallets are moulded from compressed sawdust and have no components at
all. They are out of scope. Do not model them.

---

## 5. Layout engine

This is the core of the system. Put it in `src/geometry/` with no React imports.

### Sequence layers

```
available   = layer.spanMm ?? (direction === 'along_length'
                               ? pallet.overallWidth
                               : pallet.overallLength)
totalBoards = sum of slot.width
gapCount    = slots.length - 1 - (number of slots with joinedToPrev = true)
gap         = gapCount > 0 ? (available - totalBoards) / gapCount : 0

cursor = layer.offsetMm
for each slot:
    position = cursor + slot.nudgeMm
    cursor += slot.width
    if next slot exists and not next.joinedToPrev:
        cursor += gap
```

Boards are flush to both outer edges of the span. Gaps are always shared equally
and are never entered by the user — they are always computed.

Along the run, a board starts at `layer.runOffsetMm` and its extent is its own
`length`.

If `available - totalBoards` is negative, the layer is over-full. Surface this as
a validation error naming the layer. Do not silently overlap boards.

### Grid layers

Same calculation applied twice, once down the rows using
`rowSpanMm ?? pallet.overallLength`, once across the columns using
`colSpanMm ?? pallet.overallWidth`. Each cell can have its own dimensions, so a
3×3 grid where the middle row is wider than the outer two must work. Row extents
are driven by the widest cell in that row.

### Wings

A wing is not a special case. It falls out of span and offset. On a wing pallet
the deck layers use the full pallet dimension while the bearer, block and bottom
layers carry a smaller `spanMm` and a non-zero `offsetMm`. Both the top and the
bottom deck can overhang. When the base is inset on all four sides, `runSpanMm`
and `runOffsetMm` handle the other axis.

Compute the base footprint as the bounding box of the block or runner layer. The
overhang on each of the four sides is the difference between the deck outline and
that footprint. Any non-zero overhang must be dimensioned on the drawing.

### Output

The engine returns a flat list of placed pieces:

```ts
interface PlacedPiece {
  partNo: number;
  layerKind: Layer['kind'];
  x: number; y: number; z: number;   // origin at the bottom-left-bottom corner
  dx: number; dy: number; dz: number;
  material: string;
  variant?: string;
  nudged: boolean;
}
```

Every renderer and every exporter consumes only this list. Nothing downstream
recomputes geometry.

---

## 6. Drawing rules

Five views: isometric, top, bottom, side (the long face), end (the short face).
All are generated from `PlacedPiece[]`. All are SVG. First-angle projection.
Every dimension in mm, no units repeated on every number.

### Emphasis

In the top view the top boards are drawn solid and everything below them is
drawn faint. In the bottom view the bottom boards are solid and everything above
is faint. This is the single biggest readability win, so get it right.

The shop floor prints in black and white but the owner wants colour on screen and
in the PDF. So emphasis must be carried by **three** signals at once, not just
colour:

- colour, with one colour per layer kind
- opacity, roughly 100% for the near layer and 30% for layers behind
- stroke weight, roughly 1.2 for the near layer and 0.4 for layers behind

Check every view by converting it to greyscale. If the near layer stops reading
as the near layer, the weights are wrong.

### Nail dots

Place automatically. A nail dot goes wherever a deck board crosses a bearer,
block or runner beneath it. Distribute the count from the matching `NailSpec`
evenly across those crossings. Nail dots appear only in the top and bottom views.
Do not draw them on the side, end or isometric views.

### Dimensions to show

- overall length, width and height
- the width of each distinct board variant
- the computed gap, shown once per layer
- every non-zero overhang on a wing pallet
- for any piece where `nudged` is true, its actual position measured from the
  nearest edge

That last one matters. If a board is not where equal spacing would put it, the
production team will build it evenly spaced out of habit unless the real number
is printed.

### Isometric

Generate it geometrically from `PlacedPiece[]`. Standard 30° axonometric, three
visible faces per piece, back-to-front painter's ordering. It will look like a
clean technical axonometric rather than a shaded render, which is correct.

---

## 7. Sheet layout

A4 landscape. Two columns.

**Header band**, full width, in this order left to right:
client name and client part number, then pallet name and size, then date and
revision.

**Left column — data:**
1. Overall size
2. Components table, grouped by layer. Each row is one part number:
   part no, description, variant, quantity, thickness × width × length.
   A layer with two board widths produces two rows under the same layer heading.
3. Nails — one row per `NailSpec`, showing label, type, size and count
4. Load and material — static, dynamic, species, planing, surface

**Right column — drawing:**
Isometric and top view on the first row, bottom view and end view on the second,
side view spanning the full width on the third. A footer line reading
"First-angle projection, all dimensions in mm".

Do not add a detail bubble section, a part colour key section, a drawn-and-
approved block, or QC check points. These were considered and deliberately cut.

---

## 8. Exports

All three read `PlacedPiece[]`. Build them in this order.

**PDF** — the primary output. Render the sheet HTML, print with Puppeteer at A4
landscape, no margins beyond the template's own. Text must stay selectable.

**DXF** — R12 ASCII, generated directly. One `LWPOLYLINE` per piece outline, one
layer per pallet layer kind, `TEXT` entities for dimensions. R12 is verbose but
trivially correct and opens everywhere.

**CFT and costing** — timber volume is the sum of `dx × dy × dz × quantity` over
all pieces. 1 CFT = 28,316,846.6 mm³. Costing is volume × a configurable rate per
CFT, plus nails, plus a configurable overhead. Keep the rates in one config file,
never hardcoded.

---

## 9. Revisions

A published revision is frozen and never edited. Editing a frozen pallet creates
a new row with the next revision letter, `supersedes` pointing at the previous
id, and a fresh date. The old revision stays readable forever.

Every generated PDF prints its revision letter and date in the header. A pallet
built last year was built to rev A, and if a client raises a complaint the exact
sheet from that date has to be retrievable.

---

## 10. Editor UI

Left panel is the form. Right panel is a live preview of the top view that
updates as values change.

The form is layer-based. For each layer: add slots one at a time, set each slot's
thickness, width, length and material, tick joined-to-previous, choose the
direction, and optionally set span and offset.

Clicking a board in the preview selects it and focuses its row in the form.
**Selection only. No dragging.** A selected board takes a nudge value typed in
millimetres or stepped with the arrow keys, and that value is saved to
`slot.nudgeMm`.

Copying a design makes a full deep copy with a new id. Designs are never linked.
Editing one client's pallet must never affect another client's, even when the two
started from the same original.

---

## 11. Build stages

Stop at each checkpoint and wait for confirmation before continuing.

**Stage 1 — Geometry.** Data model, Zod schemas, layout engine, unit tests. No UI
and no rendering. Provide a CLI that loads a JSON pallet and prints
`PlacedPiece[]`.
*Checkpoint:* tests pass for a plain 1000×800 block pallet, a pallet with two top
board widths, a pallet with a joined middle pair, a pallet with a wider centre
block row, and a wing pallet with both decks overhanging.

**Stage 2 — Flat views.** SVG renderers for top, bottom, side and end. A script
writes them to files from a JSON fixture. No UI.
*Checkpoint:* views are correct, near-layer emphasis reads properly, and each view
still reads correctly when converted to greyscale.

**Stage 3 — Isometric.** Same pattern, written to a file.
*Checkpoint:* a wing pallet is recognisable and the overhang is visible.

**Stage 4 — Sheet and PDF.** HTML template, all five views placed, data column,
Puppeteer export.
*Checkpoint:* a generated PDF sits alongside the existing hand-drawn Illustrator
sheet and is judged clearer.

**Stage 5 — Editor.** React UI, live preview, click to select, nudge.
*Checkpoint:* a real pallet can be entered from scratch in a few minutes.

**Stage 6 — Storage and revisions.** SQLite, save, load, duplicate, freeze,
revise.
*Checkpoint:* editing a frozen pallet produces rev B and leaves rev A intact.

**Stage 7 — DXF and costing.**
*Checkpoint:* the DXF opens in a CAD viewer with correct dimensions.

**Stage 8 — Spreadsheet import.** Only build this if manual entry has proved slow
in practice. Decide after entering about 20 designs by hand.

---

## 12. Things that will go wrong

- **Do not** let editing happen on the drawing. Every change is a number on a
  component.
- **Do not** hardcode 3×3 blocks, 7 top boards, or any other count. Every
  quantity comes from the data.
- **Do not** treat wings as a special code path. They are span and offset values.
- **Do not** let the PDF renderer recompute any geometry. It consumes
  `PlacedPiece[]` and nothing else.
- **Do not** link designs that share a shape. Copy on create, always.
- When a design genuinely does not fit the model, fail loudly with a message
  naming the layer. Never silently produce a wrong drawing — a wrong drawing on
  the shop floor is worse than no drawing.

More special cases exist than are described here and more will surface. The layer
and slot model is deliberately general so that most of them are data rather than
code. When one truly does not fit, widen the model rather than adding a branch
for that one pallet.
