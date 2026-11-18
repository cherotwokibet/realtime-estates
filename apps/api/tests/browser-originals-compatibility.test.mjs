import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createCipheriv, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createCustomerOriginals } from '../dist/customer-browser-originals.js';
import { createBrowserOriginals } from '../dist/browser-originals.js';
test('shared original store reads the previous customer ciphertext format without migrating or rewriting retained commands', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE SCHEMA identity');
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/customer-browser-originals.sql', import.meta.url),
        'utf8',
      ),
    );
    const scope = {
      tenantId: '00000000-0000-4000-8000-000000000001',
      actorId: '00000000-0000-4000-8000-000000000013',
    };
    const command = {
      policy: 'customer-favourite-command-v1',
      operationId: '00000000-0000-4000-8000-000000009001',
      listingId: '00000000-0000-4000-8000-000000000100',
      expectedVersion: '0',
      saved: true,
    };
    const key = Buffer.from('04'.repeat(32), 'hex'),
      iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(
      Buffer.from(
        'customer-original-v1|' + scope.tenantId + '|' + scope.actorId + '|' + command.operationId,
      ),
    );
    const bytes = Buffer.concat([cipher.update(JSON.stringify(command), 'utf8'), cipher.final()]);
    const sealed = Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
    await db.query(
      'INSERT INTO identity.customer_browser_originals(tenant_id,actor_id,operation_id,sealed) VALUES($1,$2,$3,$4)',
      [scope.tenantId, scope.actorId, command.operationId, sealed],
    );
    assert.deepEqual(await createCustomerOriginals(db, '04'.repeat(32)).read(scope), command);
    assert.equal(
      (await db.query('SELECT sealed FROM identity.customer_browser_originals')).rows[0].sealed,
      sealed,
    );
    assert.throws(() =>
      createBrowserOriginals(
        db,
        '04'.repeat(32),
        'customer_browser_originals; DROP SCHEMA identity CASCADE',
        () => command,
      ),
    );
  } finally {
    await db.close();
  }
});
