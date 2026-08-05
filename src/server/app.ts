import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { computeCosting } from '../costing/costing.js';
import { loadRates } from '../costing/load.js';
import type { Rates } from '../costing/rates.js';
import { palletToDxf } from '../dxf/drawing.js';
import { analysePallet } from '../geometry/layout.js';
import { PalletLayoutError } from '../geometry/types.js';
import { exportPdfBuffer } from '../sheet/pdf.js';
import { renderSheet } from '../sheet/sheet.js';
import type { Db } from './db.js';
import {
  ClientNotFoundError,
  ClientRepository,
  DuplicateClientError,
  PalletNotFoundError,
  PalletRepository,
} from './repository.js';

/**
 * The local API. One user, one machine, no authentication: the whole point of
 * this tool is that it is a program on the owner's computer.
 */

export interface AppOptions {
  /** Built editor to serve, when there is one. */
  staticDir?: string;
  /** Rates to cost with. Read from the config file when not given. */
  rates?: Rates;
}

export function createApp(db: Db, options: AppOptions = {}): Express {
  const app = express();
  const pallets = new PalletRepository(db);
  const clients = new ClientRepository(db);
  app.use(express.json({ limit: '4mb' }));

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
    const name = `${pallet.palletCode || 'pallet'}-${pallet.updatedAt}.pdf`;
    fresh(res);
    res.type('pdf').setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.send(pdf);
  }));

  app.get('/api/pallets/:id/costing', wrap((req, res) => {
    const pallet = pallets.get(idOf(req));
    res.json(computeCosting(analysePallet(pallet), options.rates ?? loadRates()));
  }));

  app.get('/api/pallets/:id/drawing.dxf', wrap((req, res) => {
    const pallet = pallets.get(idOf(req));
    const layout = analysePallet(pallet);
    const errors = layout.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) throw new PalletLayoutError(errors);

    const name = `${pallet.palletCode || 'pallet'}-${pallet.updatedAt}.dxf`;
    fresh(res);
    res
      .type('application/dxf')
      .setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(palletToDxf(layout));
  }));

  if (options.staticDir && existsSync(options.staticDir)) {
    app.use(express.static(options.staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile('index.html', { root: options.staticDir });
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
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
