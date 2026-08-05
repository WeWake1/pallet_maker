/**
 * The guide, as an A4 document printed by the same pipeline as a spec sheet.
 *
 *   npm run guide
 *
 * Kept as code rather than a written file so the drawings in it are generated
 * from a real pallet, and cannot drift from what the tool actually produces.
 */
import { computeLayout } from '../src/geometry/layout.js';
import { renderIsometric } from '../src/render/isoView.js';
import { renderView } from '../src/render/views.js';
import { esc } from '../src/render/svg.js';
import { newPallet } from '../src/editor/templates.js';

const PAGE = { width: 210, height: 297, padding: 16 } as const;

export function renderGuide(): string {
  const pallet = newPallet({ id: 'guide-client', name: 'Demo Client' });
  const layout = computeLayout(pallet);
  const view = (kind: 'top' | 'side') =>
    renderView(layout, kind, { targetWidth: 300, targetHeight: 190, title: false });
  const iso = renderIsometric(layout, { targetWidth: 300, targetHeight: 200, title: false });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pallet spec generator — guide</title>
<style>${styles()}</style>
</head>
<body>

${page(`
  <h1>Pallet specification generator</h1>
  <p class="lead">
    A tool for turning a pallet's numbers into a printable specification sheet.
    You type the dimensions; it draws the pallet, works out the spacing, and
    prints the sheet. It runs on this machine only — no accounts, no internet.
  </p>

  <h2>The one rule worth knowing</h2>
  <p>
    <strong>The drawing is always made from the data.</strong> You never draw
    anything and you never drag anything. Every measurement on the sheet,
    including a board you have deliberately moved off centre, is a number stored
    against that board. Change the number and the drawing is made again.
  </p>
  <p>
    That is why the sheet and the record can never disagree, and why an old
    sheet can be printed again years later exactly as it was.
  </p>

  <h2>Starting it</h2>
  <ol>
    <li>Open a terminal in the project folder.</li>
    <li>Type <code>npm start</code> and press enter.</li>
    <li>Open <code>http://localhost:5179</code> in the browser.</li>
  </ol>
  <p class="note">
    Leave the terminal window open while you work — closing it stops the tool.
  </p>

  <h2>The screen</h2>
  <table class="plain">
    <tr><th>Designs</th><td>The screen you land on: every client in turn, with their designs as cards. Click a card to open it.</td></tr>
    <tr><th>+ Client</th><td>Adds a customer. They get a section of their own straight away, even before anything is drawn for them.</td></tr>
    <tr><th>+ New design</th><td>The blank card at the end of a client's row. Starts a fresh design for that client.</td></tr>
    <tr><th>Middle</th><td>The form. This is where all the typing happens.</td></tr>
    <tr><th>Right</th><td>The pallet drawn as you type — top, bottom, side, end, or in 3D — and any problems it has spotted.</td></tr>
    <tr><th>Top bar</th><td>Back to the designs, Import, Export, and the buttons for saving and printing.</td></tr>
  </table>
`, 1)}

${page(`
  <h2>Entering a pallet</h2>
  <p>
    A new pallet starts as a complete 1000 × 800 block pallet, because nearly
    every design is a variation on that one. You change what is different rather
    than building a pallet from nothing.
  </p>
  <ol>
    <li>Press <strong>New</strong>.</li>
    <li>Name the design. The pallet code is optional — fill it in when the shop gives you one.</li>
    <li>Set the overall length and width. Leave the height at 0 and it adds up the layers for you.</li>
    <li>
      Work down the layers. For each one set the length, width, thickness, how
      many boards and what timber — one row describes the whole layer.
    </li>
    <li>
      Where one board differs from the rest, open the layer's board list and
      correct that one. <strong>Add board</strong> and the <strong>×</strong>
      to remove one are in there too.
    </li>
    <li>Press <strong>Save</strong>.</li>
  </ol>

  <h2>Gaps look after themselves</h2>
  <p>
    You never type a gap. Boards sit flush with both outer edges and the space
    left over is shared equally between them, which is how they are actually
    built. Add a board and every gap narrows; make one wider and the rest adjust.
    The layer heading shows the gap it worked out.
  </p>
  <p>
    If the boards will not fit, the tool says so and names the layer instead of
    drawing them on top of each other. <strong>A wrong drawing on the shop floor
    is worse than no drawing.</strong>
  </p>

  <div class="figure">
    <div class="drawing">${view('top')}</div>
    <div class="caption">
      <strong>Seen from above.</strong> The top boards are solid; the centre
      boards and blocks underneath show through them as faint outlines, so you
      can see what sits where. The dots are nails, placed automatically wherever
      a board crosses what is under it: three at the corners of the pallet, two
      on a diagonal everywhere else.
    </div>
  </div>
`, 2)}

${page(`
  <h2>Moving one board off centre</h2>
  <p>
    Sometimes a board has to sit somewhere equal spacing would not put it.
  </p>
  <ol>
    <li>Click the board in the drawing on the right. It is outlined, and its row in the form lights up.</li>
    <li>Type a number of millimetres in the <strong>Nudge</strong> box under the drawing, or use the arrow keys — up and down move it 1&nbsp;mm, hold shift for 10.</li>
  </ol>
  <p>
    The sheet then prints that board's real distance from the nearest edge. It
    has to: without it the production team will space the boards evenly out of
    habit and build the wrong pallet.
  </p>
  <p class="note">
    You can select a board but you cannot drag one. A position that came from
    dragging would live on the drawing instead of on the board, and the two
    would drift apart.
  </p>

  <h2>Saving, and keeping an old design</h2>
  <p>
    <strong>Save</strong> overwrites the design. There is no history and nothing
    is kept behind your back: what is on screen is what is stored, and the date
    on the card is the date you last saved it.
  </p>
  <p>
    So if a design has been built to and you are about to rework it, press
    <strong>Duplicate</strong> first. That gives you two designs which have
    nothing to do with each other from then on — change one and the other is
    untouched. Rename the one you are keeping to something like
    <code>1000 x 800 (old)</code> and it will read plainly on the dashboard.
  </p>

  <div class="figure">
    <div class="drawing">${view('side')}</div>
    <div class="caption">
      <strong>Seen from the long side.</strong> Every view on the sheet comes
      from the same numbers, so they cannot disagree with each other.
    </div>
  </div>
`, 3)}

${page(`
  <h2>Getting things out of it</h2>
  <table class="plain">
    <tr><th>PDF</th><td>The specification sheet, A4 landscape. This is the thing you print and hand over.</td></tr>
    <tr><th>Sheet</th><td>The same sheet in a browser tab, for a quick look without saving a file.</td></tr>
    <tr><th>DXF</th><td>The plan for a CAD program, full size in millimetres, with each layer of the pallet on its own CAD layer.</td></tr>
    <tr><th>Export</th><td>The design as a file you can keep or send. <strong>Import</strong> reads one back.</td></tr>
  </table>
  <p>
    Both the PDF and the DXF are named for the design and the date it was last
    saved, so <code>AP-001-2026-08-03.pdf</code> is exactly what it says it is.
  </p>

  <h2>Where your designs live</h2>
  <p>
    In one file: <code>data/pallets.sqlite</code>, inside the project folder.
    Every time the tool starts it copies that file into
    <code>data/backups/</code> and keeps the last twenty copies.
  </p>
  <p class="note">
    Copy the <code>data</code> folder onto a memory stick now and then. It is
    small, and it is the whole record.
  </p>

  <h2>If something looks wrong</h2>
  <table class="plain">
    <tr><th>A red message</th><td>Something does not fit. It names the layer. Nothing will print until it is fixed.</td></tr>
    <tr><th>An amber message</th><td>Worth a look but not fatal, such as a layer that never crosses the one under it, so it has nothing to nail to.</td></tr>
    <tr><th>Save is greyed out</th><td>Either nothing has changed, or the pallet code and client are still empty.</td></tr>
    <tr><th>Nothing happens on PDF</th><td>The browser blocked the new tab. Allow pop-ups for this address.</td></tr>
  </table>

  <div class="figure">
    <div class="drawing">${iso}</div>
    <div class="caption">
      <strong>The whole pallet.</strong> Drawn from the same list of pieces as
      every other view, which is why nothing on the sheet can contradict
      anything else on it.
    </div>
  </div>
`, 4)}

</body>
</html>
`;
}

function page(content: string, number: number): string {
  return `<section class="page">
    <div class="body">${content}</div>
    <footer><span>Pallet specification generator</span><span>${esc(String(number))}</span></footer>
  </section>`;
}

function styles(): string {
  return `
  @page { size: ${PAGE.width}mm ${PAGE.height}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #1b1b1b;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: ${PAGE.width}mm;
    height: ${PAGE.height}mm;
    padding: ${PAGE.padding}mm;
    display: flex;
    flex-direction: column;
    page-break-after: always;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  .body { flex: 1; min-height: 0; }

  h1 { font-size: 20pt; margin: 0 0 3mm; letter-spacing: -0.01em; }
  h2 {
    font-size: 11pt;
    margin: 6mm 0 2mm;
    padding-bottom: 1mm;
    border-bottom: 0.5pt solid #ccc;
  }
  .page > .body > h2:first-child { margin-top: 0; }
  p, li, td, th { font-size: 9.5pt; line-height: 1.5; }
  p { margin: 0 0 2.5mm; }
  .lead { font-size: 11pt; line-height: 1.5; color: #333; }
  ol { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin-bottom: 1mm; }
  code {
    font-family: 'Consolas', 'Menlo', monospace;
    font-size: 9pt;
    background: #f1f1f1;
    padding: 0 1mm;
    border-radius: 1mm;
  }
  .note {
    background: #f7f7f4;
    border-left: 1.5mm solid #c9c2b4;
    padding: 2mm 3mm;
    margin: 3mm 0;
  }
  table.plain { width: 100%; border-collapse: collapse; margin: 0 0 3mm; }
  table.plain th {
    text-align: left;
    width: 34mm;
    vertical-align: top;
    font-weight: 600;
    padding: 1.2mm 3mm 1.2mm 0;
    border-bottom: 0.4pt solid #e4e4e4;
  }
  table.plain td { padding: 1.2mm 0; border-bottom: 0.4pt solid #e4e4e4; }

  .figure {
    margin-top: 5mm;
    padding-top: 4mm;
    border-top: 0.5pt solid #ccc;
    display: flex;
    gap: 5mm;
    align-items: center;
  }
  .figure .drawing { flex: 0 0 auto; }
  .figure svg { display: block; }
  .figure .caption { font-size: 8.5pt; line-height: 1.45; color: #444; }

  footer {
    display: flex;
    justify-content: space-between;
    border-top: 0.5pt solid #ccc;
    padding-top: 2mm;
    font-size: 8pt;
    color: #888;
  }
  `;
}
