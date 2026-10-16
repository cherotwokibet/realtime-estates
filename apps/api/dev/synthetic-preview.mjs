/**
 * Independently authored, deterministic synthetic fixtures for local browser QA.
 * No vendor exports, real prospects, provider credentials or property image bytes.
 * Disposable in-memory PGlite; fabricated sealed SQL provenance is a bootstrap
 * metadata fixture only. It is not actual workflow/decoder/native/storage proof.
 * Never deploy this harness or treat its synthetic identity context as authentication.
 */
import { randomUUID } from 'node:crypto';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createApiService } from '../dist/service.js';
import { DatabaseSafetyError, PostgresTransactionDatabase } from '../dist/database.js';
import { createDevelopmentServer } from '../dist/http.js';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const PREVIEW_FIXTURES = Object.freeze({
  rentId: id(100),
  saleId: id(101),
  otherCompanyListingId: id(200),
  rentSlug: 'synthetic-monthly-studio',
  saleSlug: 'synthetic-sale-apartment',
  otherSlug: 'synthetic-other-company-studio',
});
const COMPANIES = Object.freeze({
  'realtime-estates': Object.freeze({
    id: id(1),
    admin: id(10),
    name: 'Synthetic Realtime Preview',
  }),
  'sample-homes': Object.freeze({
    id: id(2),
    admin: id(20),
    name: 'Synthetic Sample Homes Preview',
  }),
});
const NOTICE = 'synthetic-preview-notice-v1';
class PreviewConfigurationError extends Error {}
function requireDevelopment() {
  if (process.env.NODE_ENV === 'production')
    throw new PreviewConfigurationError('Synthetic preview refuses NODE_ENV=production.');
}
function configuration({ tenantSlug = 'realtime-estates', scenario = 'normal', port = 4100 } = {}) {
  requireDevelopment();
  if (typeof tenantSlug !== 'string' || !Object.hasOwn(COMPANIES, tenantSlug))
    throw new PreviewConfigurationError(
      'PREVIEW_TENANT_SLUG must be realtime-estates or sample-homes.',
    );
  if (!['normal', 'empty', 'error'].includes(scenario))
    throw new PreviewConfigurationError('PREVIEW_SCENARIO must be normal, empty or error.');
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
    throw new PreviewConfigurationError(
      'PORT must be an integer from 0 through 65535; 0 selects an ephemeral loopback port.',
    );
  return { tenantSlug, scenario, port };
}
const fee = (id, name, amountMinor, overrides = {}) => ({
  id,
  name,
  amountStatus: 'known',
  amountMinor,
  timing: 'one_off',
  classification: 'fee',
  mandatory: true,
  ...overrides,
});
const base = {
  description:
    'Synthetic connected-preview fixture only. No real property is advertised or available. Image references are metadata placeholders without image files.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2000000,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic Nairobi area',
  publicPrecision: 'area',
  latitude: null,
  longitude: null,
  privateAddress: 'PRIVATE SYNTHETIC FIXTURE ADDRESS',
};
function listingFixtures() {
  return [
    {
      company: COMPANIES['realtime-estates'],
      id: PREVIEW_FIXTURES.rentId,
      slug: PREVIEW_FIXTURES.rentSlug,
      content: {
        ...base,
        title: 'Synthetic monthly studio',
        pricing: {
          declaration: 'complete',
          charges: [
            fee('service', 'Monthly service fee', 100000, { timing: 'per_rental_period' }),
            fee('deposit', 'Refundable security deposit', 2000000, {
              classification: 'refundable_deposit',
            }),
            fee('preparation', 'One-off preparation fee', 50000),
            fee('parking', 'Optional monthly parking', 30000, {
              mandatory: false,
              timing: 'per_rental_period',
            }),
            fee('cleaning-quote', 'Optional cleaning quote', null, {
              mandatory: false,
              amountStatus: 'quote_required',
            }),
          ],
        },
        location: {
          county: 'Nairobi',
          town: 'Synthetic Nairobi town',
          area: 'Synthetic preview area',
        },
      },
    },
    {
      company: COMPANIES['realtime-estates'],
      id: PREVIEW_FIXTURES.saleId,
      slug: PREVIEW_FIXTURES.saleSlug,
      content: {
        ...base,
        title: 'Synthetic sale apartment',
        purpose: 'sale',
        propertyType: 'apartment',
        amountMinor: 99999900,
        rentPeriod: null,
        bedrooms: 2,
        privateBathrooms: null,
        pricing: {
          declaration: 'incomplete',
          charges: [
            fee('legal', 'Known legal fee', 150000),
            fee('third-party-quote', 'Additional third-party amount to confirm', null, {
              amountStatus: 'quote_required',
            }),
          ],
        },
        location: { county: null, town: null, area: null },
      },
    },
    {
      company: COMPANIES['sample-homes'],
      id: PREVIEW_FIXTURES.otherCompanyListingId,
      slug: PREVIEW_FIXTURES.otherSlug,
      content: {
        ...base,
        title: 'Synthetic other-company studio',
        amountMinor: 3300001,
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: 'Synthetic Sample Town', area: null },
      },
    },
  ];
}
async function bootstrapAs(db, company, operation) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try {
    await db.query(
      `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-preview-seed',true)`,
      [company.id, company.admin],
    );
    const result = await operation();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function seed(db, scenario, tenantSlug) {
  await applyTestMigrations(db);
  for (const [slug, company] of Object.entries(COMPANIES)) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$3)', [
      company.id,
      slug,
      company.name,
    ]);
    await db.query(
      `INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')`,
      [company.id, company.admin],
    );
  }
  for (const fixture of listingFixtures()) {
    const { company, id: listing, slug, content } = fixture;
    await bootstrapAs(db, company, async () => {
      await db.query('SELECT app_api.create_listing($1,$2)', [listing, slug]);
      await db.query('SELECT app_api.save_draft_v2($1,1,0,$2::jsonb)', [
        listing,
        JSON.stringify(content),
      ]);
      await db.query(`SELECT app_api.confirm_availability($1,1,'available')`, [listing]);
    });
    // Privileged fabricated SQL provenance keeps the submission policy real.
    // There are NO image bytes behind these keys and NO actual processing proof.
    for (let position = 0; position < 4; position++)
      await seedSyntheticSealedMedia(db, {
        tenantId: company.id,
        listingId: listing,
        mediaId: id(Number(listing.slice(-3)) * 10 + position),
        position,
        altText: 'Synthetic SQL-only metadata placeholder; image not available',
      });
    await bootstrapAs(db, company, async () => {
      await db.query('SELECT app_api.submit_revision($1,1,2)', [listing]);
      await db.query('SELECT app_api.decide_revision($1,1,3,true)', [listing]);
      if (scenario === 'empty' && company.id === COMPANIES[tenantSlug].id)
        await db.query(`SELECT app_api.set_publication($1,3,'paused')`, [listing]);
    });
  }
}
function serializedRuntimePool(db) {
  // A single PGlite connection must serialize complete checkouts, including role
  // checks, BEGIN/SET LOCAL/context/COMMIT. Per-query queuing alone is insufficient.
  let tail = Promise.resolve();
  let closed = false;
  return {
    async connect() {
      if (closed) throw new DatabaseSafetyError();
      let unlock;
      const next = new Promise((resolve) => {
        unlock = resolve;
      });
      const previous = tail;
      tail = next;
      await previous;
      if (closed) {
        unlock();
        throw new DatabaseSafetyError();
      }
      let released = false;
      return {
        query: (sql, args) => db.query(sql, args ? [...args] : []),
        release() {
          if (!released) {
            released = true;
            unlock();
          }
        },
      };
    },
    async end() {
      closed = true;
      await tail;
      await db.close();
    },
  };
}
function json(status, payload, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Synthetic-Preview': 'true',
      ...extra,
    },
  });
}
function failure(status, code, message, extra = {}) {
  const requestId = randomUUID();
  return json(
    status,
    { error: { code, message }, requestId },
    { 'X-Request-Id': requestId, ...extra },
  );
}

/** Starts only an IPv4 loopback listener. Tenant/scenario are trusted startup configuration. */
export async function startSyntheticPreview(options = {}) {
  const { tenantSlug, scenario, port } = configuration(options);
  const db = new PGlite();
  let database;
  let server;
  try {
    await seed(db, scenario, tenantSlug);
    await db.exec(
      'CREATE ROLE synthetic_preview_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO synthetic_preview_login; SET SESSION AUTHORIZATION synthetic_preview_login;',
    );
    database = new PostgresTransactionDatabase(serializedRuntimePool(db));
    await database.checkConnection();
    const service = createApiService({
      database:
        scenario === 'error'
          ? {
              async transaction() {
                throw new DatabaseSafetyError();
              },
            }
          : database,
      tenantId: COMPANIES[tenantSlug].id,
      privacyNoticeVersion: NOTICE,
      verifyAuthorization: async () => {
        throw new Error('Synthetic preview has no identity provider.');
      },
    });
    let allowedHosts = new Set();
    server = createDevelopmentServer(async (request) => {
      const url = new URL(request.url);
      if (!allowedHosts.has(url.host) || !allowedHosts.has(request.headers.get('host') ?? ''))
        return failure(404, 'NOT_FOUND', 'Preview host is unavailable.');
      if (request.method !== 'GET')
        return failure(405, 'METHOD_NOT_ALLOWED', 'Synthetic preview is read-only.', {
          Allow: 'GET',
        });
      if (request.headers.has('authorization') || request.headers.has('cookie'))
        return failure(400, 'INVALID_INPUT', 'Synthetic preview accepts no credentials.');
      if (url.pathname === '/health')
        return json(200, {
          status: 'synthetic-preview',
          synthetic: true,
          persistentStorage: false,
          authentication: false,
          tenantSlug,
          scenario,
          media: 'metadata-only',
          productionReady: false,
        });
      if (!['/v1/properties', '/v2/properties'].includes(url.pathname))
        return failure(404, 'NOT_FOUND', 'Preview route is unavailable.');
      if (
        [...url.searchParams.keys()].some((key) => key !== 'limit') ||
        url.searchParams.getAll('limit').length > 1
      )
        return failure(400, 'INVALID_INPUT', 'Only one bounded limit query is supported.');
      const response = await service(request);
      response.headers.set('X-Synthetic-Preview', 'true');
      return response;
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new PreviewConfigurationError('Expected a loopback TCP listener.');
    allowedHosts = new Set([`127.0.0.1:${address.port}`, `localhost:${address.port}`]);
    let closing;
    const close = () =>
      (closing ??= (async () => {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeIdleConnections();
        });
        await database.close();
      })());
    return Object.freeze({
      origin: `http://127.0.0.1:${address.port}`,
      tenantSlug,
      scenario,
      close,
    });
  } catch (error) {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    if (database) await database.close();
    else await db.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const portText = process.env.PORT ?? '4100';
    if (!/^\d+$/.test(portText))
      throw new PreviewConfigurationError('PORT must contain only digits.');
    const preview = await startSyntheticPreview({
      tenantSlug: process.env.PREVIEW_TENANT_SLUG ?? 'realtime-estates',
      scenario: process.env.PREVIEW_SCENARIO ?? 'normal',
      port: Number(portText),
    });
    console.log(
      `Synthetic preview on ${preview.origin}; tenant=${preview.tenantSlug}; scenario=${preview.scenario}; disposable database, metadata-only images, no authentication or writes.`,
    );
    const stop = () => {
      void preview.close().then(
        () => {
          process.exitCode = 0;
        },
        () => {
          process.exitCode = 1;
        },
      );
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    console.error(
      error instanceof PreviewConfigurationError
        ? error.message
        : 'Synthetic preview could not start. Build the local domain/API and inspect the synthetic fixture configuration.',
    );
    process.exitCode = 1;
  }
}
