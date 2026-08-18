import { existsSync } from 'node:fs';

/**
 * Where to find a Chromium to print with.
 *
 * The tool uses puppeteer-core against a browser that is already on the
 * machine, rather than downloading its own copy. Set PALLET_BROWSER (or
 * PUPPETEER_EXECUTABLE_PATH) to override.
 */

const WINDOWS_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const POSIX_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
];

export function findBrowser(): string {
  const override = process.env.PALLET_BROWSER ?? process.env.PUPPETEER_EXECUTABLE_PATH;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`No browser at ${override} (from PALLET_BROWSER)`);
    }
    return override;
  }

  const candidates = process.platform === 'win32' ? WINDOWS_CANDIDATES : POSIX_CANDIDATES;
  const found = candidates.find((path) => existsSync(path));
  if (found) return found;

  throw new Error(
    'No Chromium browser found for PDF export. Install Edge or Chrome, or set ' +
      'PALLET_BROWSER to the executable.\nLooked in:\n' +
      candidates.map((path) => `  ${path}`).join('\n'),
  );
}
