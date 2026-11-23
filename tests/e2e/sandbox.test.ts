/**
 * @fileoverview End to end, as a developer's agent uses it: the example product behind a web address, `overthink up`
 * with it deployed, people and activity created over HTTP (what `overthink act` and the MCP tools call), the product
 * answering where the person wrote, Rummage served, and a reset that puts everything back.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {ActivityClient} from '../../activity-generation/api.ts';
import {readSession} from '../../infrastructure/session.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const children: ChildProcess[] = [];
after(() => {
  for (const c of children) c.kill();
});

/** A port nobody is using now. */
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => {
        resolve(port);
      });
    });
  });
}

async function until(what: string, ok: () => boolean, ms = 30000): Promise<void> {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('up, act, the product answers, Rummage shows it, reset', {timeout: 120000}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overthink-e2e-'));
  const productPort = await freePort();
  const product = spawn(
    process.execPath,
    [path.join(ROOT, 'integrations/examples/http-server.ts')],
    {
      env: {...process.env, PORT: String(productPort)},
      stdio: 'ignore',
    },
  );
  children.push(product);
  fs.writeFileSync(
    path.join(dir, 'overthink.adapter.ts'),
    `export const adapter = {name: 'e2e product', transport: 'http', url: 'http://127.0.0.1:${String(productPort)}/', channels: ['web_chat', 'email']};\n`,
  );
  const port = await freePort();
  const up = spawn(
    process.execPath,
    [
      path.join(ROOT, 'bin/overthink.mjs'),
      'up',
      '--port',
      String(port),
      '--adapter',
      'overthink.adapter.ts',
    ],
    {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(up);
  let printed = '';
  up.stdout.on('data', (d: Buffer) => (printed += d.toString()));
  up.stderr.on('data', (d: Buffer) => (printed += d.toString()));
  await until('the session file', () => readSession(dir) !== null);
  const session = readSession(dir);
  assert.ok(session !== null);
  assert.match(printed, /Rummage/);
  const act = new ActivityClient(session);

  const [ann] = await act.createPeople({count: 1});
  assert.ok(ann !== undefined);
  const chat = await act.sendMessage({
    person: ann.customer_id,
    text: 'Hello, can you help me with my order?',
  });
  const mail = await act.sendEmail({
    person: ann.customer_id,
    subject: 'A question',
    body: 'Do you deliver to Leeds?',
  });
  assert.ok(chat.contact_id !== null && mail.contact_id !== null);
  await act.advanceTime(1);

  const seen = await act.observe(0, 500);
  const replies = seen.entries.filter((e) => e['kind'] === 'reply');
  assert.equal(replies.length, 2, 'one answer on the chat, one on the email');
  assert.ok(replies.every((r) => r['ok'] === true && typeof r['reply'] === 'string'));
  const thread = (await act.run('call_business_tool', {
    role: 'support_agent',
    tool: 'get_email_thread',
    input: {email_id: mail.email_id},
  })) as {messages: {folder: string}[]};
  assert.deepEqual(
    thread.messages.map((m) => m.folder),
    ['inbox', 'sent'],
    'the answer left from hello@',
  );

  const home = await fetch(`${session.url}/`, {headers: {accept: 'text/html'}, redirect: 'follow'});
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Rummage|<html/i);

  await act.reset();
  assert.equal((await act.observe(0)).entries.length, 0, 'the trace starts again');
  assert.equal(((await act.run('list_people')) as {total: number}).total, 0);

  up.kill('SIGTERM');
  await until('the session file to go', () => readSession(dir) === null);
  fs.rmSync(dir, {recursive: true, force: true});
});
