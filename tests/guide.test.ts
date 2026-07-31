import { describe, expect, it } from 'vitest';
import { renderGuide } from '../docs/guide.js';

/**
 * The guide draws a real pallet with the real renderers, so that what it shows
 * a new user cannot drift away from what the tool does.
 */
describe('the guide', () => {
  const html = renderGuide();

  it('is four A4 pages', () => {
    expect([...html.matchAll(/class="page"/g)]).toHaveLength(4);
    expect(html).toContain('@page { size: 210mm 297mm; margin: 0; }');
  });

  it('shows drawings the tool actually produced', () => {
    expect([...html.matchAll(/<svg/g)]).toHaveLength(3);
    // The nail dots and dimensions are the generated ones, not a picture.
    expect(html).toContain('<circle');
    expect(html).toContain('1000');
  });

  it('says the things a new user has to know', () => {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('The drawing is always made from the data');
    expect(text).toContain('npm start');
    expect(text).toContain('You never type a gap');
    expect(text).toContain('data/pallets.sqlite');
  });
});
