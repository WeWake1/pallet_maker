import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { brandResolver } from '../brand/resolve.js';
import type { Brand } from '../brand/types.js';
import { currentTenant, NoTenantContextError, runInTenant } from '../tenancy/context.js';
import type { TenantContext } from '../tenancy/context.js';
import { Tenants } from '../tenancy/tenants.js';
import { Mutex } from '../store/mutex.js';
import type { Registry } from '../tenancy/registry.js';
import { authRoutes, NO_SIGN_IN } from './authRoutes.js';
import {
  checkSession,
  requireRequestedWith,
  unauthenticated,
} from './auth.js';
import { computeCosting } from '../costing/costing.js';
import { DEFAULT_RATES_PATH } from '../costing/load.js';
import { ratesResolver } from '../costing/resolve.js';
import type { Rates } from '../costing/rates.js';
import { palletToDxf } from '../dxf/drawing.js';
import { analysePallet } from '../geometry/layout.js';
import { PalletLayoutError } from '../geometry/types.js';
import { today } from '../ids.js';
import { libraryFileName, parseLibrary } from '../library.js';
import { contentDisposition, downloadName } from '../sheet/filename.js';
import { exportPdfBuffer } from '../sheet/pdf.js';
import { PrinterBusyError } from '../sheet/pooledPrinter.js';
import { renderSheet } from '../sheet/sheet.js';
import { renderSheetSvg } from '../sheet/svgSheet.js';
import { StoreUnavailableError } from '../store/files.js';
import type { StoreHandle } from '../store/handle.js';
import { rememberStoreRoot } from '../store/settings.js';
import { securityHeaders } from './headers.js';
import { exportLibrary, importDesign, importLibrary } from './library.js';
import { requestId, requestLogger } from './log.js';
import type { Logger } from './log.js';
import {
  ClientNotFoundError,
  ClientRepository,
  ConcurrentEditError,
  DuplicateClientError,
  PalletNotFoundError,
  PalletRepository,
} from './repository.js';

/**
 * The API.
 *
 * It began as a local one — listening on this machine only, serving designs
 * from a folder the operating system had already decided this person could
 * read — and the desktop app still runs it that way. Hosted, it sits behind a
 * reverse proxy on the same box, and what it takes for granted narrows: bodies
 * are small unless the route is one that takes a whole library, every answer
 * says how it may be used, a failure is written down with an id rather than
 * described to whoever asked, and nothing that arrives over the network can
 * move the designs folder. Who may call it at all is the next thing to add.
 */

export interface AppOptions {
  /** Built editor to serve, when there is one. */
  staticDir?: string;
  /**
   * Rates to cost with, fixed. Only tests pass this; everything else lets the
   * designs folder or the built-in file decide.
   */
  rates?: Rates;
  /**
   * The rates that ship with the program, for when the designs folder has none
   * of its own. Defaults to the config file beside the working directory, which
   * is right everywhere except an installed app — where the working directory
   * is wherever the shortcut happened to be launched from.
   */
  ratesPath?: string;
  /**
   * The brand that ships with the program, for when the designs folder has
   * none of its own. A `brand.json` in the folder takes its place, which is
   * how a company changes its own logo without anybody rebuilding anything.
   */
  brandPath?: string;
  /** A brand to use whatever the folder says. Only tests pass this. */
  brand?: Brand;
  /**
   * Which build this is, for the editor to show.
   *
   * Worth having on screen because people update at their own pace, and a bug
   * report is a great deal easier to place when it says which version saw it.
   */
  version?: string | null;
  /**
   * Ask the operating system for a folder, returning null if nobody picks one.
   *
   * Only the app can do this — a web page has no way to open a native dialog —
   * so it is absent when the tool is being run as a page, and the editor falls
   * back to a typed path. The server is running inside the app's own process,
   * which is what lets it offer this at all.
   */
  chooseFolder?: () => Promise<string | null>;
  /**
   * Whether the designs folder may be changed over the API.
   *
   * Only the desktop app says yes: its API is on the loopback and the person
   * at the keyboard owns the machine, so pointing the tool at a different
   * folder is theirs to do. A hosted server never does — its folder is decided
   * when it starts, and a route that let a browser move it, and make the new
   * one, would be the most dangerous thing on the box.
   */
  allowFolderChange?: boolean;
  /** The time zone the date on a design is stamped in. UTC without one. */
  timezone?: string;
  /** Where each request is written down once answered. Nowhere without one. */
  log?: Logger;
  /** Anything else `/healthz` should report — the printer, mostly. */
  health?: () => Record<string, unknown>;
  /**
   * Who may use this server.
   *
   * Absent, nobody is asked: that is the desktop app and the command line,
   * where the machine has already decided who is at the keyboard. Present,
   * every route below the door needs a session, and which company's designs
   * those routes see comes from whose session it is.
   */
  auth?: AuthConfig;
}

export interface AuthConfig {
  registry: Registry;
  /** Signs the session cookie. At least 32 bytes, and not in the repository. */
  secret: string;
  /** Mark cookies Secure. True wherever the address is https. */
  secure: boolean;
  /** Where this server answers, for the links in invitations. */
  publicUrl: string;
}

/** The two routes that take a whole library in one body. */
const IMPORT_ROUTES = new Set(['/api/library/import', '/api/pallets/import']);

/**
 * The API, over one company's designs or over every company's.
 *
 * Given a folder, it serves that folder and asks nobody who they are: that is
 * the desktop app, where the machine has already decided. Given the companies
 * on a server, every request goes through the door first and the folder it
 * then reads is whichever belongs to whoever signed in.
 *
 * Not one route below knows the difference. Each asks for "the designs" and
 * gets the ones the request is entitled to, because the middleware put that
 * answer where the repositories look — see `src/tenancy/context.ts`.
 */
export function createApp(source: StoreHandle | Tenants, options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy on this machine the address of the person is in
  // the header the proxy adds; from anywhere else that header is ignored.
  app.set('trust proxy', 'loopback');

  const tenants = source instanceof Tenants ? source : null;
  const auth = options.auth;
  if (tenants && !auth) {
    throw new Error('A server holding several companies has to know who may use it: pass options.auth');
  }

  /**
   * The one company, when there is only one.
   *
   * The desktop app and the command line have a folder and no notion of who is
   * asking, so they get a context made once and used for every request. The
   * routes cannot tell, which is the point: there is one way to reach the
   * designs and it goes through the same place either way.
   */
  const sole: TenantContext | null = tenants
    ? null
    : {
        tenant: {
          id: 'sole',
          slug: 'sole',
          name: '',
          timezone: options.timezone ?? 'UTC',
          status: 'active',
          createdAt: '',
        },
        handle: source as StoreHandle,
        rates: ratesResolver(
          () => ((source as StoreHandle).ready() ? (source as StoreHandle).status().root : null),
          options.ratesPath ?? DEFAULT_RATES_PATH,
        ),
        brand: brandResolver(
          () => ((source as StoreHandle).ready() ? (source as StoreHandle).status().root : null),
          options.brandPath,
        ),
        lock: new Mutex(),
      };

  // Everything below reads the company in context rather than a folder chosen
  // when the server started.
  const storeNow = () => currentTenant().handle.require();
  const now = () => today(currentTenant().tenant.timezone);
  const pallets = new PalletRepository(storeNow, { now });
  const clients = new ClientRepository(storeNow, { now });
  const allowFolderChange = options.allowFolderChange === true && tenants === null;

  const ratesInUse = () => currentTenant().rates();
  const rates = (): Rates => options.rates ?? ratesInUse().rates;
  const brandInUse = () => currentTenant().brand();
  const brand = (): Brand => options.brand ?? brandInUse().brand;
  /** The company whose designs are being written, for the routes that hold it. */
  const writes = () => currentTenant().lock;

  app.use(requestLogger(options.log));
  app.use(securityHeaders);

  // A design is a few kilobytes. A whole library being imported arrives as one
  // body, and a few hundred designs is a few megabytes of it — so the two
  // routes that take one accept a great deal more than the rest, and the rest
  // accept little, because anything on the internet can send a body.
  const small = express.json({ limit: '2mb' });
  const large = express.json({ limit: '64mb' });
  app.use((req, res, next) => (IMPORT_ROUTES.has(req.path) ? large : small)(req, res, next));

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
   * Whether this server is up and can reach its designs.
   *
   * For whatever watches the server rather than for people: a plain yes or no
   * with enough detail to say which half is wrong. Not under /api/, because it
   * is not about pallets.
   */
  app.get('/healthz', wrap((_req, res) => {
    fresh(res);
    // Asked by whatever watches the server, before anybody has signed in, so
    // it reports the server rather than any one company's designs. On a
    // server holding several, that means the registry answers and the data
    // folder is there; on a laptop, that the one folder can be reached.
    let ok = true;
    let detail: Record<string, unknown>;
    if (tenants) {
      try {
        detail = { companies: auth!.registry.listTenants().length, foldersOpen: tenants.openCount };
      } catch (error) {
        ok = false;
        detail = { registry: error instanceof Error ? error.message : String(error) };
      }
    } else {
      const status = sole!.handle.status();
      ok = status.ready;
      detail = {
        store: {
          ready: status.ready,
          designs: status.designs,
          clients: status.clients,
          problem: status.problem,
        },
      };
    }
    res.status(ok ? 200 : 503).json({
      ok,
      version: options.version ?? null,
      uptimeSeconds: Math.round(process.uptime()),
      ...detail,
      ...(options.health?.() ?? {}),
    });
  }));

  /* ------------------------------------------------------------- the door */

  if (auth) {
    // Every request that changes something carries a header no form on
    // another site can add. Signing in is included: without it, a form
    // elsewhere could sign somebody into an account that is not theirs.
    app.use('/api', requireRequestedWith);
    // Signing in, signing out, and following an invitation: the only things
    // that happen before anybody is known.
    app.use(authRoutes(auth, options.log !== undefined));
  }

  /**
   * Who is asking, and therefore whose designs these are.
   *
   * Everything after this runs inside one company's context. A page of the
   * editor is allowed through without one, because the login screen is part
   * of it and has to load; anything under `/api/` is not.
   */
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!auth) {
      runInTenant(sole!, next);
      return;
    }
    const { principal } = checkSession(auth.registry, req, auth.secret);
    if (!principal) {
      if (req.path.startsWith('/api/')) {
        unauthenticated(res);
        return;
      }
      next();
      return;
    }
    req.principal = principal;
    if (principal.tenant) {
      runInTenant(tenants!.context(principal.tenant), next);
      return;
    }
    // Somebody who looks after the service belongs to no company, so there is
    // no folder to put them in. They may manage companies and nothing else.
    next();
  });

  /**
   * A route that needs designs, reached by somebody who has none.
   *
   * Only the vendor's own people can be here: they look after the service
   * rather than drawing pallets, and there is no folder that is theirs.
   */
  const needsCompany = (_req: Request, res: Response, next: NextFunction): void => {
    try {
      currentTenant();
      next();
    } catch (error) {
      if (error instanceof NoTenantContextError) {
        res.status(403).json({
          error: 'That account looks after the service and does not belong to a company.',
        });
        return;
      }
      next(error);
    }
  };
  app.use('/api', needsCompany);

  /**
   * Which folder the designs are in.
   *
   * Always answers, even when the folder cannot be reached — that is the whole
   * point of it. Everything else needs the designs; this is what the editor
   * asks when it cannot have them, so it can say where it was looking and offer
   * somewhere else. A hosted server keeps its paths to itself: there is nowhere
   * else to offer, and where on the disk the designs are is its own business.
   */
  app.get('/api/settings', wrap((_req, res) => {
    fresh(res);
    const status = currentTenant().handle.status();
    // The rates come along because a folder whose prices could not be read is
    // something whoever is quoting has to be told, and this is the one call the
    // editor makes whatever else is going on.
    const prices = options.rates ? { from: 'built-in' as const, problem: null } : ratesInUse();
    // A sheet going out under the wrong name, or under none, is not something
    // to discover from a customer, so a brand that would not read is carried
    // out to be said on screen the same way the prices are.
    const branding = options.brand ? { from: 'built-in' as const, problem: null } : brandInUse();
    res.json({
      ...status,
      root: allowFolderChange ? status.root : null,
      managedStore: !allowFolderChange,
      canBrowse: allowFolderChange && options.chooseFolder !== undefined,
      version: options.version ?? null,
      ratesFrom: prices.from,
      ratesProblem: prices.problem,
      brandFrom: branding.from,
      brandProblem: branding.problem,
    });
  }));

  /** The folder is the server's own. Said the same way on both routes below. */
  const refuseFolderChange = (res: Response): void => {
    res.status(403).json({
      error: 'The designs folder is decided by the server and cannot be changed from here.',
    });
  };

  /**
   * Use a different folder from now on.
   *
   * The folder is made if it is not there: somebody typing a path has said so
   * on purpose, and a first run has to be able to start a library somewhere.
   * That is the opposite of what happens at startup, where a folder that has
   * gone missing is reported rather than replaced with an empty one.
   */
  app.put('/api/settings', wrap((req, res) => {
    if (!allowFolderChange) {
      refuseFolderChange(res);
      return;
    }
    const root = (req.body as { root?: unknown }).root;
    if (typeof root !== 'string' || root.trim() === '') {
      res.status(400).json({ error: 'A folder has to be given' });
      return;
    }
    if (sole!.handle.status().source === 'environment') {
      res.status(409).json({
        error: 'PALLET_STORE is set, and it decides the folder. Unset it to choose one here.',
      });
      return;
    }

    const status = sole!.handle.use(root.trim());
    rememberStoreRoot(status.root!);
    res.json(status);
  }));

  /** Look again, for a folder that was not there when the tool started. */
  app.post('/api/settings/retry', wrap((_req, res) => {
    res.json(currentTenant().handle.retry());
  }));

  /**
   * Pick a folder in a native dialog, and use it.
   *
   * Answers 501 when there is no dialog to open, which is how the editor knows
   * to ask for a typed path instead rather than offering a button that cannot
   * do anything.
   */
  app.post('/api/settings/browse', wrap(async (_req, res) => {
    if (!allowFolderChange) {
      refuseFolderChange(res);
      return;
    }
    if (!options.chooseFolder) {
      res.status(501).json({ error: 'Choosing a folder needs the app rather than a browser tab' });
      return;
    }
    const picked = await options.chooseFolder();
    if (picked === null) {
      // Cancelled. Nothing changes, and nothing has gone wrong.
      res.json(sole!.handle.status());
      return;
    }
    const status = sole!.handle.use(picked);
    rememberStoreRoot(status.root!);
    res.json(status);
  }));

  // Rates go to the editor so it can cost a design as it is being changed,
  // rather than only once it has been saved.
  app.get('/api/rates', wrap((_req, res) => {
    res.json(rates());
  }));

  /**
   * Whose drawing this is, for the editor.
   *
   * It renders the sheet itself for the preview and for "open in a tab", so it
   * needs the same brand the server prints with — otherwise what is on screen
   * and what comes out of the printer would carry different names. The logo
   * and the font come with it, already encoded.
   */
  app.get('/api/brand', wrap((_req, res) => {
    fresh(res);
    res.json(brand());
  }));

  /**
   * Whether anybody has to sign in here.
   *
   * Registered only when nobody does — behind the door there is a fuller
   * answer to the same question. The editor asks it first on every load,
   * because it is the difference between showing a library and showing a
   * sign-in screen, and a server that asks nobody still has to say so.
   */
  if (!auth) {
    app.get('/api/session', wrap((_req, res) => {
      fresh(res);
      res.json(NO_SIGN_IN);
    }));
  }

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
  app.post('/api/pallets/import', wrap(async (req, res) => {
    const body = req.body as { pallet?: unknown; clientId?: unknown };
    if (typeof body.clientId !== 'string') {
      res.status(400).json({ error: 'Which client the design is for has to be said' });
      return;
    }
    const clientId = body.clientId;
    await writes().run(() => {
      res.status(201).json(importDesign(body.pallet, clientId, pallets, clients));
    });
  }));

  app.post('/api/pallets', wrap((req, res) => {
    res.status(201).json(pallets.save(req.body, clients));
  }));

  /**
   * Saving overwrites. There is no previous version kept anywhere, by design.
   *
   * `If-Match` carries the design as the editor found it. Where it is given, a
   * save is refused if somebody else has saved in between — the editor then
   * asks whoever is at the keyboard what to do, and sends the save again
   * without the header if they decide theirs should win. Absent, the save goes
   * through as it always did, which is what an older editor and every other
   * caller does.
   */
  app.put('/api/pallets/:id', wrap((req, res) => {
    const body = req.body as { id?: string };
    if (body.id !== idOf(req)) {
      res.status(400).json({ error: 'The document id does not match the address' });
      return;
    }
    const basedOn = req.header('if-match') ?? undefined;
    res.json(pallets.save(req.body, clients, basedOn));
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
    res.type('html').send(renderSheet(pallet, analysePallet(pallet), { brand: brand() }));
  }));

  // The primary output. Named for the design and the date it was last saved,
  // because the sheet a pallet was built to has to be findable again.
  app.get('/api/pallets/:id/sheet.pdf', wrap(async (req, res) => {
    const pallet = pallets.get(idOf(req));
    const layout = analysePallet(pallet);
    const errors = layout.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) throw new PalletLayoutError(errors);

    const pdf = await exportPdfBuffer(renderSheet(pallet, layout, { brand: brand() }));
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
    res.send(renderSheetSvg(pallet, layout, { brand: brand() }));
  }));

  app.get('/api/pallets/:id/costing', wrap((req, res) => {
    const pallet = pallets.get(idOf(req));
    res.json(computeCosting(pallet, analysePallet(pallet), rates()));
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
  app.post('/api/library/import', wrap(async (req, res) => {
    const body = req.body as { library?: unknown; mode?: unknown };
    const mode = body.mode === 'replace' ? 'replace' : 'skip';
    await writes().run(() => {
      res.json(importLibrary(currentTenant().handle.require(), parseLibrary(body.library), pallets, clients, mode));
    });
  }));

  if (options.staticDir && existsSync(options.staticDir)) {
    app.use(express.static(options.staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile('index.html', { root: options.staticDir });
    });
  }

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    // Not a fault in this program: the designs are somewhere it cannot read.
    // Its own status, so the editor can tell it apart from a design that is
    // merely missing and offer to be pointed somewhere else.
    //
    // Where the folder is named in the message, that is the whole use of it —
    // on a laptop it says which Drive folder has gone. On a server it is a
    // path on somebody else's machine, so what is said is that the designs
    // cannot be reached and why, and the path stays in the log.
    if (error instanceof StoreUnavailableError) {
      res.status(503).json({
        error: allowFolderChange
          ? error.message
          : `The designs cannot be reached: ${error.reason}`,
        storeUnavailable: true,
      });
      return;
    }
    // Every sheet that can print at once is printing. Come back shortly.
    if (error instanceof PrinterBusyError) {
      res.setHeader('Retry-After', '5');
      res.status(503).json({ error: error.message });
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
    // Not a fault and not a bad request: two people had the same design open.
    // Its own marker, because the editor answers it by asking rather than by
    // showing the message and giving up.
    if (error instanceof ConcurrentEditError) {
      res.status(409).json({ error: error.message, staleEdit: true });
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
    // The body could not be taken: too big, or not JSON. The parser says which
    // with a status of its own, and its messages are written to be shown.
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({
        error:
          status === 413
            ? 'That is more than this server takes in one request'
            : error instanceof Error
              ? error.message
              : String(error),
      });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    // A bad document is the caller's fault; anything else is worth seeing.
    if (message.startsWith('Invalid ') || message === 'A client needs a name') {
      res.status(400).json({ error: message });
      return;
    }
    // Ours, and not described to whoever asked: what went wrong on a server is
    // for the log, and the id is how a report and the log find each other.
    const id = requestId(req);
    console.error(`[${id}] ${req.method} ${req.path}:`, error);
    res.status(500).json({
      error: `Something went wrong on the server. Quote request ${id} when reporting it.`,
      requestId: id,
    });
  });

  return app;
}
