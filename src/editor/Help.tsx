import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { GLOSSARY, HINTS } from './hints.js';
import { shortcutLabel } from './shortcuts.js';
import { Button } from './ui.js';

/**
 * What the editor knows that it was not saying.
 *
 * Everything in here existed already and was unreachable: the shortcuts were
 * written only inside the tooltips of the three buttons that have them, the
 * vocabulary was in the heads of the people who built the thing, and the rules
 * that make the editor make sense — Save overwrites, boards are selected and
 * never dragged, one row sets a whole layer — were in the README, which is not
 * open while anyone is working.
 *
 * The glossary is not written here. It comes from hints.ts, the same sentences
 * the ⓘ beside each field shows, so a word cannot come to be explained two
 * ways.
 */

const KEYS: Array<[string, string]> = [
  ['mod+z', 'Undo'],
  ['mod+shift+z', 'Redo'],
  ['mod+s', 'Save'],
];

const RULES: Array<{ heading: string; body: string }> = [
  {
    heading: 'The drawing is the design, not a picture of it',
    body: 'Everything on screen is rebuilt from the numbers on every keystroke, by the same renderer that prints the sheet. There is nothing to refresh, and what is on screen is what will print.',
  },
  {
    heading: 'One row sets a whole layer',
    body: 'In about eight designs in ten every board in a layer is the same size, so the boxed row at the top of each card — length, width, thickness, how many, what timber — describes the whole of it. The board-by-board table folded away underneath is for the odd board out.',
  },
  {
    heading: 'Boards are selected, never dragged',
    body: 'Click a board on the drawing to select it. The arrow keys nudge it, Shift by ten, Delete removes it, Esc lets it go. The nudge in millimetres is the only record of where a board sits.',
  },
  {
    heading: 'Gaps look after themselves',
    body: 'Boards are spread evenly across the space they are given. Change a width or a count and the gaps re-space themselves — there is no gap to type in. Slack going negative means the boards add up to more than the space, and the design will not print until it does not.',
  },
  {
    heading: 'Part numbers are worked out, not typed',
    body: 'A part is one kind of component at one size in one material. Two boards the same share a number; widen one and it becomes a part of its own. Nothing has to be kept in step by hand.',
  },
  {
    heading: 'Save overwrites, and there is no history',
    body: 'A design is edited in place. To keep an old version before reworking it, use Duplicate — that makes two designs that never meet again. Work between one Save and the next is kept in this browser, so closing the tab does not lose it, but only Save puts it in the library.',
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line-soft px-5 py-4 first:border-t-0">
      <h3 className="mb-3 text-micro font-semibold uppercase tracking-wider text-ink-faint">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Help({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-slate-900/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Help"
        className="relative flex h-full w-[26rem] max-w-full flex-col border-l border-line bg-card shadow-raised"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-title font-semibold text-ink">Help</h2>
          <Button onClick={onClose} label="Close help" title="Close (Esc)">
            ✕
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section title="How this works">
            <dl className="space-y-3">
              {RULES.map((rule) => (
                <div key={rule.heading}>
                  <dt className="text-ui font-semibold text-ink">{rule.heading}</dt>
                  <dd className="mt-0.5 text-label leading-relaxed text-ink-soft">{rule.body}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="Keyboard">
            <table className="w-full text-label">
              <tbody>
                {KEYS.map(([keys, what]) => (
                  <tr key={keys}>
                    <td className="w-24 py-1">
                      <kbd className="rounded border border-line bg-ground-soft px-1.5 py-0.5 font-sans text-micro text-ink-soft">
                        {shortcutLabel(keys)}
                      </kbd>
                    </td>
                    <td className="py-1 text-ink-soft">{what}</td>
                  </tr>
                ))}
                {/* Not shortcutLabel's to write: these are the keys themselves,
                    the same on every keyboard. */}
                <tr>
                  <td className="py-1">
                    <kbd className="rounded border border-line bg-ground-soft px-1.5 py-0.5 font-sans text-micro text-ink-soft">
                      ← ↑ ↓ →
                    </kbd>
                  </td>
                  <td className="py-1 text-ink-soft">Nudge the selected board, Shift for ten</td>
                </tr>
                <tr>
                  <td className="py-1">
                    <kbd className="rounded border border-line bg-ground-soft px-1.5 py-0.5 font-sans text-micro text-ink-soft">
                      Delete
                    </kbd>
                  </td>
                  <td className="py-1 text-ink-soft">Remove the selected board</td>
                </tr>
                <tr>
                  <td className="py-1">
                    <kbd className="rounded border border-line bg-ground-soft px-1.5 py-0.5 font-sans text-micro text-ink-soft">
                      Esc
                    </kbd>
                  </td>
                  <td className="py-1 text-ink-soft">Leave the field, then let the board go</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-micro text-ink-faint">
              Undo and Save work mid-field. The rest wait until nothing is being typed into, because
              Delete belongs to the digits under the cursor first.
            </p>
          </Section>

          <Section title="Words used here">
            <dl className="space-y-2.5">
              {GLOSSARY.map(({ term, hint }) => (
                <div key={term}>
                  <dt className="text-ui font-semibold text-ink">{term}</dt>
                  <dd className="mt-0.5 text-label leading-relaxed text-ink-soft">{HINTS[hint]}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="Getting it out">
            <dl className="space-y-2.5 text-label text-ink-soft">
              <div>
                <dt className="text-ui font-semibold text-ink">PDF</dt>
                <dd className="mt-0.5">The specification sheet, ready to print or send.</dd>
              </div>
              <div>
                <dt className="text-ui font-semibold text-ink">DXF</dt>
                <dd className="mt-0.5">The plan as a CAD file, for AutoCAD and the like.</dd>
              </div>
              <div>
                <dt className="text-ui font-semibold text-ink">SVG</dt>
                <dd className="mt-0.5">
                  The whole sheet as vector, to work on in Canva, Illustrator or Inkscape.
                </dd>
              </div>
              <div>
                <dt className="text-ui font-semibold text-ink">Export as file</dt>
                <dd className="mt-0.5">
                  The design itself, to send to another copy of this program. Export library on the
                  designs screen does the same for everything at once — keep that somewhere other
                  than this computer, because it is the only copy that survives it.
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-micro text-ink-faint">
              Every export saves the design first, so what is printed is what is recorded.
            </p>
          </Section>
        </div>
      </aside>
    </div>
  );
}
