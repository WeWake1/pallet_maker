/**
 * Stands in for `puppeteer-core` when the app is built.
 *
 * The app prints through the Chromium inside it, so it sets its own printer
 * before anything can ask for a sheet and the browser-hunting one is never
 * reached. It is still *referenced* — `pdf.ts` falls back to it when nobody has
 * chosen — and a reference is enough to make the package a thing the app would
 * have to ship. This takes its place, so it does not.
 *
 * If this ever throws, the app failed to set its printer, which is a fault
 * here and not a missing dependency.
 */
export default {
  launch(): never {
    throw new Error(
      'The app prints with the Chromium inside it, and never launches another. ' +
        'Reaching this means the printer was not set at startup.',
    );
  },
};
