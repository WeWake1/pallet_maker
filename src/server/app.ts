import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { computeCosting } from '../costing/costing.js';
import { loadRates } from '../costing/load.js';
import type { Rates } from '../costing/rates.js';
import { palletToDxf } from '../dxf/drawing.js';
import { analysePallet } from '../geometry/layout.js';
import { PalletLayoutError } from '../geometry/types.js';
import { libraryFileName, parseLibrary } from '../library.js';
import { contentDisposition, downloadName } from '../sheet/filename.js';
import { exportPdfBuffer } from '../sheet/pdf.js';
import { renderSheet } from '../sheet/sheet.js';
import { renderSheetSvg } from '../sheet/svgSheet.js';
import { StoreUnavailableError } from '../store/files.js';
import type { StoreHandle } from '../store/handle.js';
import { rememberStoreRoot } from '../store/settings.js';
import { exportLibrary, importDesign, importLibrary } from './library.js';
import {
  ClientNotFoundError,
  ClientRepository,
  DuplicateClientError,
  PalletNotFoundError,
  PalletRepository,
} from './repository.js';

/**
 * The local API. No authentication: it listens only on this machine, and the
 * designs it serves are files in a folder that the operating system has already
 * decided this person can read. Sharing happens in the folder — Drive syncs it
 * between the few people who draw pallets — not over this port.
 */

export interface AppOptions {
  /** Built editor to serve, when there is one. */
  staticDir?: string;
  /** Rates to cost with. Read from the config file when not given. */
  rates?: Rates;
  /**
   * Ask the operating system for a folder, returning null if nobody picks one.
   *
   * Only the app can do this — a web page has no way to open a native dialog —
   * so it is absent when the tool is being run as a page, and the editor falls
   * back to a typed path. The server is running inside the app's own process,
   * which is what lets it offer this at all.
   */
  chooseFolder?: () => Promise<string | null>;
}

export function createApp(handle: StoreHandle, options: AppOptions = {}): Express {
  const app = express();
  // The repositories ask the handle which folder to use each time they are
  // used, so pointing the tool somewhere else takes effect without a restart.
  const storeNow = () => handle.require();
  const pallets = new PalletRepository(storeNow);
  const clients = new ClientRepository(storeNow);
  // Generous, because a whole library being imported arrives as one body and a
  // few hundred designs is a few megabytes of it. Nothing reaches this server
  // from outside the machine, so there is nothing for a tighter limit to guard.
  app.use(express.json({ limit: '64mb' }));

  // Express 5 types a route parameter as possibly absent; on these routes it
  // never is, because the path would not have matched.
  const idOf = (req: Request): string => String(req.params.id);

  const wrap =
    (handler: (req: Request, res: Response) => Promise<void> | void) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(handler(req, res)).catch(next);
    };

  // Documents are generated from the design as it stands at the moment they are
  // asked for. A browser holding on to yesterday's copy would hand the shop
  // floor a drawing of a pallet nobody is building any more, so never let one be
  // cached.
  const fresh = (res: Response): void => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
  };

  /**
   * Which folder the designs are in.
   *
   * Always answers, even when the folder cannot be reached — that is the whole
   * point of it. Everything else needs the designs; this is what the editor
   * asks when it cannot have them, so it can say where it was looking and offer
   * somewhere else.
   */
  app.get('/api/settings', wrap((_req, res) => {
    fresh(res);
    res.json({ ...handle.status(), canBrowse: options.chooseFolder !== undefined });
  }));

  /**
   * Use a different folder from now on.
   *
   * The folder is made if it is not there: somebody typing a path has said so
   * on purpose, and a first run has to be able to start a library somewhere.
   * That is the opposite of what happens at startup, where a folder that has
   * gone missing is reported rather than replaced with an empty one.
   */
  app.put('/api/settings', wrap((req, res) => {
    const root = (req.body as { root?: unknown }).root;
    if (typeof root !== 'string' || root.trim() === '') {
      res.status(400).json({ error: 'A folder has to be given' });
      return;
    }
    if (handle.status().source === 'environment') {
      res.status(409).json({
        error: 'PALLET_STORE is set, and it decides the folder. Unset it to choose one here.',
      });
      return;
    }

    const status = handle.use(root.trim());
    rememberStoreRoot(status.root!);
    res.json(status);
  }));

  /** Look again, for a folder that was not there when the tool started. */
  app.post('/api/settings/retry', wrap((_req, res) => {
    res.json(handle.retry());
  }));

  /**
   * Pick a folder in a native dialog, and use it.
   *
   * Answers 501 when there is no dialog to open, which is how the editor knows
   * to ask for a typed path instead rather than offering a button that cannot
   * do anything.
   */
  app.post('/api/settings/browse', wrap(async (_req, res) => {
    if (!options.chooseFolder) {
      res.status(501).json({ error: 'Choosing a folder needs the app rather than a browser tab' });
      return;
    }
    const picked = await options.chooseFolder();
    if (picked === null) {
      // Cancelled. Nothing changes, and nothing has gone wrong.
      res.json(handle.status());
      return;
    }
    const status = handle.use(picked);
    rememberStoreRoot(status.root!);
    res.json(status);
  }));

  // Rates go to the editor so it can cost a design as it is being changed,
  // rather than only once it has been saved.
  app.get('/api/rates', wrap((_req, res) => {
    res.json(options.rates ?? loadRates());
  }));

  // The dashboard, in one call: every client, each with their designs. Clients
  // with none are included, which is why they are a record of their own.
  app.get('/api/dashboard', wrap((_req, res) => {
    res.json(pallets.dashboard(clients));
  }));

  app.get('/api/clients', wrap((_req, res) => {
    res.json(clients.list());
  }));

  app.post('/api/clients', wrap((req, res) => {
    const body = req.body as { name?: unknown };
    res.status(201).json(clients.create(String(body.name ?? '')));
  }));

  app.patch('/api/clients/:id', wrap((req, res) => {
    const body = req.body as { name?: unknown };
    res.json(clients.rename(idOf(req), String(body.name ?? '')));
  }));

  // Deleting a client takes their designs with them, which the caller is told
  // before it is offered.
  app.delete('/api/clients/:id', wrap((req, res) => {
    clients.delete(idOf(req));
    res.status(204).end();
  }));

  app.get('/api/pallets', wrap((_req, res) => {
    res.json(pallets.list());
  }));

  app.get('/api/pallets/:id', wrap((req, res) => {
    res.json(pallets.get(idOf(req)));
  }));

  /**
   * One design from a file, as a new design of the named client's. This is the
   * other half of the download below: a design mailed over, or taken off a
   * backup, arriving in the library without anything having to be open.
   */
  app.post('/api/pallets/import', wrap((req, res) => {
    const body = req.body as { pallet?: unknown; clientId?: unknown };
    if (typeof body.clientId !== 'string') {
      res.status(400).json({ error: 'Which client the design is for has to be said' });
      return;
    }
    res.status(201).json(importDesign(body.pallet, body.clientId, pallets, clients));
  }));

  app.post('/api/pallets', wrap((req, res) => {
    res.status(201).json(pallets.save(req.body, clients));
  }));

  // Saving overwrites. There is no previous version kept anywhere, by design.
  app.put('/api/pallets/:id', wrap((req, res) => {
    const body = req.body as { id?: string };
    if (body.id !== idOf(req)) {
      res.status(400).json({ error: 'The document id does not match the address' });
      return;
    }
    res.json(pallets.save(req.body, clients));
  }));

  app.post('/api/pallets/:id/duplicate', wrap((req, res) => {
    res.status(201).json(pallets.duplicate(idOf(req), clients));
  }));

  app.delete('/api/pallets/:id', wrap((req, res) => {
    pallets.delete(idOf(req));
    res.status(204).end();
  }));

  /**
   * The design itself, as the document the store holds.
   *
   * The PDF is what the design looks like; this is the design. It is the only
   * output that can be read back in and worked on, which is what makes it the
   * one worth keeping a copy of.
   */
  app.get('/api/pallets/:id/design.json', wrap((req, res) => {
    const pallet = pallets.get(idOf(req));
    fresh(res);
    res
      .type('application/json')
      .setHeader(
        'Content-Disposition',
        contentDisposition(downloadName(pallet, 'json'), 'attachment'),
      );
    res.send(JSON.stringify(pallet, null, 2));
  }));

  app.get('/api/pallets/:id/sheet.html', wrap((req, res) => {
    const pallet = pallets.get(idOf(req));
    fresh(res);
    res.type('html').send(renderSheet(pallet, analysePallet(pallet)));
  }));

  // The primary output. Named for the design and the date it was last saved,
  // because the sheet a pallet was built to has to be findable again.
  app.get('/api/pallets/:id/sheet.pdf', wrap(async (req, res) => {
    const pallet = pallets.get(idOf(req));
    const layout = analysePallet(pallet);
    const errors = layout.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) throw new PalletLayoutError(errors);

    const pdf = await exportPdfBuffer(renderSheet(pallet, layout));
    fresh(res);
    res
      .type('pdf')
      .setHeader('Content-Disposition', contentDisposition(downloadName(pallet, 'pdf'), 'inline'));
    res.send(pdf);
  }));

  // The same sheet as one SVG, for taking into a drawing or page-layout
  // program. Downloaded rather than shown, because a browser would only render
  // what the PDF already shows better.
  app.get('/api/pallets/:id/sheet.svg', wrap((req, res) => {
    const pallet = pallets.get(idOf(req));
    const layout = analysePallet(pallet);
    const errors = layout.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) throw new PalletLayoutError(errors);

    fresh(res);
    res
      .type('image/svg+xml')
      .setHeader(
        'Content-Disposition',
        contentDisposition(downloadName(pallet, 'svg'), 'attachment'),
      );
    res.send(renderSheetSvg(pallet, layout));
  }));

  app.get('/api/pallets/:id/costing', wrap((req, res) => {
    const pallet = pallets.get(idOf(req));
    res.json(computeCosting(pallet, analysePallet(pallet), options.rates ?? loadRates()));
  }));

  app.get('/api/pallets/:id/drawing.dxf', wrap((req, res) => {
    const pallet = pallets.get(idOf(req));
    const layout = analysePallet(pallet);
    const errors = layout.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) throw new PalletLayoutError(errors);

    fresh(res);
    res
      .type('application/dxf')
      .setHeader(
        'Content-Disposition',
        contentDisposition(downloadName(pallet, 'dxf'), 'attachment'),
      );
    res.send(palletToDxf(layout));
  }));

  /**
   * The whole library as one file: every client, every design.
   *
   * The store is already a folder of JSON files, so this is not the only
   * readable copy any more. It is still the one that travels: every client and
   * every design as a single document, for a stick, an email, or an archive
   * that outlives the folder.
   */
  app.get('/api/library.json', wrap((_req, res) => {
    const library = exportLibrary(pallets, clients);
    fresh(res);
    res
      .type('application/json')
      .setHeader(
        'Content-Disposition',
        contentDisposition(libraryFileName(library.exportedAt), 'attachment'),
      );
    res.send(JSON.stringify(library, null, 2));
  }));

  /**
   * A library file read back in. Adds what is missing; by default it overwrites
   * nothing, and says how many designs it left alone so that overwriting them
   * can be asked for knowing the number.
   */
  app.post('/api/library/import', wrap((req, res) => {
    const body = req.body as { library?: unknown; mode?: unknown };
    const mode = body.mode === 'replace' ? 'replace' : 'skip';
    res.json(importLibrary(handle.require(), parseLibrary(body.library), pallets, clients, mode));
  }));

  if (options.staticDir && existsSync(options.staticDir)) {
    app.use(express.static(options.staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile('index.html', { root: options.staticDir });
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Not a fault in this program: the designs are somewhere it cannot read.
    // Its own status, so the editor can tell it apart from a design that is
    // merely missing and offer to be pointed somewhere else.
    if (error instanceof StoreUnavailableError) {
      res.status(503).json({ error: error.message, storeUnavailable: true });
      return;
    }
    if (error instanceof PalletNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof ClientNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof DuplicateClientError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof PalletLayoutError) {
      res.status(422).json({ error: error.message, issues: error.issues });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    // A bad document is the caller's fault; anything else is worth seeing.
    if (message.startsWith('Invalid ') || message === 'A client needs a name') {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: message });
  });

  return app;
}
