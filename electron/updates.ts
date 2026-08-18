import { app, dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';

/**
 * Keeping four copies of the tool on the same version.
 *
 * Four people update at their own pace if it is left to them, and then a bug
 * report is about a build nobody else is running. So the app looks for a new
 * version when it opens, fetches it quietly, and puts it in place the next time
 * it starts — nothing is interrupted, and nobody has to be told anything.
 *
 * The releases are on the repository, which is public, so there is no token in
 * the app and none on anybody's machine.
 *
 * Nothing here is fatal. A laptop with no internet — the Sunday this whole
 * design is for — must open the designs exactly as usual, so a failed check is
 * written down and otherwise ignored.
 */

const { autoUpdater } = electronUpdater;

export function watchForUpdates(window: BrowserWindow): void {
  // Never in development: there is no release to compare against, and the check
  // would only ever produce a confusing error.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  // Installing while somebody is mid-design would be rude. It goes in on the
  // next start instead, which is what `autoInstallOnAppQuit` means.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    console.error(`Could not check for updates: ${error.message}`);
  });

  autoUpdater.on('update-downloaded', ({ version }) => {
    console.log(`Version ${version} is ready and will be in place next time.`);
    void dialog.showMessageBox(window, {
      type: 'info',
      title: 'An update is ready',
      message: `Version ${version} has been downloaded.`,
      detail: 'It will be in place the next time you open Pallet Spec. Nothing to do now.',
      buttons: ['Right'],
    });
  });

  void autoUpdater.checkForUpdates().catch((error: unknown) => {
    // Offline is the ordinary case here, not a fault.
    console.error(
      `Could not check for updates: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}
