import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../src/server/app.js';
import { backupLibrary } from '../src/server/backup.js';
import { reconcileClients } from '../src/server/repository.js';
import { usePrinter } from '../src/sheet/pdf.js';
import { StoreHandle } from '../src/store/handle.js';
import { configuredStoreRoot } from '../src/store/settings.js';
import { closePrinter, printWithElectron } from './printer.js';

/**
 * The tool as an application.
 *
 * Inside is the same program that `npm run serve` runs: the API and the editor,
 * unchanged, on a port nobody else can reach. Electron supplies the two things
 * a browser tab cannot — a Chromium of its own to print with, and a folder
 * dialog — and otherwise stays out of the way.
 *
 * The window is a web page because that is what the editor already was. Nothing
 * here knows anything about pallets.
 */

const keep = Number(process.env.PALLET_BACKUPS ?? 20);

/** The built editor, wherever this copy of the app keeps it. */
function editorDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'editor')
    : resolve(app.getAppPath(), 'dist', 'editor');
}

/** The company mark, for the window and the dock. */
function iconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'icon.png')]
    : [resolve(app.getAppPath(), 'assets', 'icons', 'icon.png'),
       resolve(app.getAppPath(), 'Ambica Patterns (india) Pvt.Ltd..png')];
  return candidates.find((path) => existsSync(path));
}

/**
 * Where the designs are, and whether this copy may make that folder.
 *
 * A folder somebody chose and this program wrote down must already be there. If
 * it is not, Drive is not running or the folder has moved, and making an empty
 * one would show an empty library — so it is reported, and the window opens on
 * the screen that asks where the designs actually are.
 */
function openStore(): StoreHandle {
  const chosen = process.env.PALLET_STORE ?? configuredStoreRoot();
  if (chosen === undefined) {
    // Nobody has said yet. Nothing is made until they do.
    return new StoreHandle(undefined);
  }
  return new StoreHandle(chosen, {
    create: false,
    source: process.env.PALLET_STORE ? 'environment' : 'settings',
  });
}

async function chooseFolder(window: BrowserWindow): Promise<string | null> {
  const picked = await dialog.showOpenDialog(window, {
    title: 'Choose the folder to keep designs in',
    message: 'To share designs with the rest of the team, choose a folder Google Drive syncs.',
    properties: ['openDirectory', 'createDirectory'],
  });
  return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]!;
}

function buildMenu(window: BrowserWindow, handle: StoreHandle): void {
  const template: Parameters<typeof Menu.buildFromTemplate>[0] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Choose designs folder…',
          click: () => {
            void chooseFolder(window).then((picked) => {
              if (picked) window.webContents.reload();
            });
          },
        },
        {
          label: 'Show designs folder',
          click: () => {
            const root = handle.status().root;
            if (root && existsSync(root)) void shell.openPath(root);
          },
        },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function main(): Promise<void> {
  // Print through the Chromium in this app rather than hunting for one on the
  // machine. Set before anything can ask for a sheet.
  usePrinter((html) => printWithElectron(html));

  const handle = openStore();

  if (handle.ready()) {
    const adopted = reconcileClients(handle.require());
    if (adopted > 0) console.log(`Took in ${adopted} client(s) named only by their designs`);
    try {
      console.log(`Backed up to ${backupLibrary(handle.require(), { keep })}`);
    } catch (error) {
      console.error(
        `Could not back up the designs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Pallet spec',
    icon: iconPath(),
    show: false,
    backgroundColor: '#f1f5f9',
    webPreferences: {
      // The page is our own, served from this process over the loopback. It
      // needs nothing from Node, so it is given nothing.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Any free port, and only on the loopback: nothing outside this machine can
  // reach it. PORT pins it, which is for looking at the API while working on
  // the tool and has no use in a built app.
  const server = createApp(handle, {
    staticDir: editorDirectory(),
    chooseFolder: () => chooseFolder(window),
  }).listen(Number(process.env.PORT ?? 0), '127.0.0.1');

  await new Promise<void>((done) => server.once('listening', () => done()));
  const { port } = server.address() as AddressInfo;

  buildMenu(window, handle);
  await window.loadURL(`http://127.0.0.1:${port}/`);
  window.show();

  // A link to anywhere else is somebody's browser's business, not ours.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  app.on('window-all-closed', () => {
    server.close();
    closePrinter();
    if (process.platform !== 'darwin') app.quit();
  });
}

void app.whenReady().then(main);
