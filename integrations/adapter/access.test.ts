/**
 * @fileoverview Access levels, audiences and the `file#export@access` adapter spec.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {audiencesOf, channelsOf, jobOf} from '../../activity-generation/people/audiences.ts';
import {accessScope} from './access.ts';
import {AdapterError, adapterLabel, checkAdapter, loadAdapter} from './load.ts';

test('an adapter file can hold several versions, and any of them can be run at another access level', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overthink-access-'));
  const file = path.join(dir, 'overthink.adapter.mjs');
  fs.writeFileSync(
    file,
    "export const adapter = {name: 'bot', version: '1', transport: 'http', url: 'http://127.0.0.1:1/', audience: 'customers'};\n" +
      "export const v2 = {name: 'bot', version: '2', transport: 'http', url: 'http://127.0.0.1:1/', access: 'reply_only'};\n",
  );
  const a = await loadAdapter(file);
  assert.equal(a.config.version, '1');
  assert.deepEqual(a.config.audience, ['customers']);
  assert.equal(a.config.scope, undefined, 'full access: the role decides');
  const b = await loadAdapter(`${file}#v2`);
  assert.equal(b.config.version, '2');
  assert.deepEqual(b.config.scope, accessScope('reply_only'));
  const c = await loadAdapter(`${file}#v2@read_only`);
  assert.deepEqual(c.config.scope, {read: ['*'], act: []});
  assert.match(adapterLabel(c), /\(read_only\)$/);
  await assert.rejects(loadAdapter(`${file}@everything`), /Unknown access level/);
  await assert.rejects(loadAdapter(`${file}#nope`), /export a named `nope`/);
});

test('access and scope cannot both be given; audiences are checked', () => {
  assert.throws(
    () =>
      checkAdapter({
        transport: 'http',
        url: 'http://x/',
        access: 'read_only',
        scope: {read: ['*']},
      }),
    AdapterError,
  );
  assert.throws(
    () => checkAdapter({transport: 'http', url: 'http://x/', audience: 'aliens'}),
    /unknown audience/,
  );
});

test('audiences come from the adapter, else its channels; each audience has one job', () => {
  assert.deepEqual(audiencesOf({}), ['customers']);
  assert.deepEqual(audiencesOf({channels: ['publishing']}), ['public']);
  assert.deepEqual(audiencesOf({channels: ['email', 'mutter_dm']}), ['customers']);
  assert.equal(jobOf(['public']), 'content');
  assert.equal(jobOf(['staff']), 'internal-tool');
  assert.equal(jobOf(['businesses']), 'sales');
  assert.equal(jobOf(['suppliers']), 'operations');
  assert.throws(() => jobOf(['customers', 'public']), /separate runs/);
  assert.deepEqual(channelsOf(['suppliers']), ['supplier_mail']);
});
