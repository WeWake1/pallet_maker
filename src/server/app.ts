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
import { FrozenPalletError, PalletNotFoundError, PalletRepository } from './repository.js';

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
  app.use(express.json({ limit: '4mb' }));

  // Express 5 types a route parameter as possibly absent; on these routes it
  // never is, because the path would not have matched.
  const idOf = (req: Request): string => String(req.params.id);

  const wrap =
    (handler: (req: Request, res: Response) => Promise<void> | void) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(handler(req, res)).catch(next);
    };

  // Rates go to the editor so it can cost a design as it is being changed,
  // rather than only once it has been saved.
  app.get('/api/rates', wrap((_req, res) => {
    res.json(options.rates ?? loadRates());
  }));

  app.get('/api/pallets', wrap((_req, res) => {
    res.json(pallets.list());
  }));

  app.get('/api/pallets/:id', wrap((req, res) => {
    res.json(pallets.get(idOf(req)));
  }));

  app.get('/api/pallets/:id/history', wrap((req, res) => {
    res.json(pallets.history(idOf(req)));
  }));

  app.post('/api/pallets', wrap((req, res) => {
    res.status(201).json(pallets.save(req.body));
  }));

  app.put('/api/pallets/:id', wrap((req, res) => {
    const body = req.body as { id?: string };
    if (body.id !== idOf(req)) {
      res.status(400).json({ error: 'The document id does not match the address' });
      return;
    }
    res.json(pallets.save(req.body));
  }));

  app.post('/api/pallets/:id/freeze', wrap((req, res) => {
    res.json(pallets.freeze(idOf(req)));
  }));

  app.post('/api/pallets/:id/revise', wrap((req, res) => {
    res.status(201).json(pallets.revise(idOf(req)));
  }));

  app.post('/api/pallets/:id/duplicate', wrap((req, res) => {
    res.status(201).json(pallets.duplicate(idOf(req)));
  }));

  app.delete('/api/pallets/:id', wrap((req, res) => {
    pallets.delete(idOf(req));
    res.status(204).end();
  }));

  app.get('/api/pallets/:id/sheet.html', wrap((req, res) => {
    const pallet = pallets.get(idOf(req));
    res.type('html').send(renderSheet(pallet, analysePallet(pallet)));
  }));

  // The primary output. Named for the design and its revision, because the
  // sheet a pallet was built to has to be findable again.
  app.get('/api/pallets/:id/sheet.pdf', wrap(async (req, res) => {
    const pallet = pallets.get(idOf(req));
    const layout = analysePallet(pallet);
    const errors = layout.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) throw new PalletLayoutError(errors);

    const pdf = await exportPdfBuffer(renderSheet(pallet, layout));
    const name = `${pallet.palletCode || 'pallet'}-rev-${pallet.revision}.pdf`;
    res.type('pdf').setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.send(pdf);
  }));

  app.get('/api/pallets/:id/costing', wrap((req, res) => {
    const pallet = pallets.get(idOf(req));
    res.json(computeCosting(analysePallet(pallet), pallet.nails, options.rates ?? loadRates()));
  }));

  app.get('/api/pallets/:id/drawing.dxf', wrap((req, res) => {
    const pallet = pallets.get(idOf(req));
    const layout = analysePallet(pallet);
    const errors = layout.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) throw new PalletLayoutError(errors);

    const name = `${pallet.palletCode || 'pallet'}-rev-${pallet.revision}.dxf`;
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
    if (error instanceof FrozenPalletError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof PalletLayoutError) {
      res.status(422).json({ error: error.message, issues: error.issues });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    // A bad document is the caller's fault; anything else is worth seeing.
    if (message.startsWith('Invalid pallet document')) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: message });
  });

  return app;
}
