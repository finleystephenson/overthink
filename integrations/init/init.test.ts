import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {checkAdapter} from '../adapter/check.ts';
import {loadAdapter, openTransport} from '../adapter/load.ts';
import {jobFor} from '../../simulation/twin-run/jobs.ts';
import {adapterSource, detectOpenAi, gatherAnswers, writeAdapter} from './init.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

test('init writes a connector that passes check against the example HTTP product', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const product = spawn(
    process.execPath,
    [path.join(ROOT, 'integrations/examples/http-server.ts')],
    {
      env: {...process.env, PORT: String(port)},
      stdio: 'ignore',
    },
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overthink-init-'));
  try {
    await waitFor(`http://127.0.0.1:${port}/`);
    const answers = await gatherAnswers(
      {url: `http://127.0.0.1:${port}/`, channels: 'web_chat', yes: true},
      dir,
    );
    assert.equal(
      answers.transport,
      'http',
      'a plain web address is not mistaken for an OpenAI endpoint',
    );
    assert.deepEqual(answers.channels, ['web_chat']);
    const [file] = writeAdapter(dir, answers);
    assert.ok(file !== undefined);
    const adapter = await loadAdapter(file);
    assert.deepEqual(adapter.config.channels, ['web_chat']);
    const job = jobFor('customer-service');
    const transport = openTransport(adapter);
    try {
      const r = await checkAdapter({
        transport,
        role: job.role,
        instructions: job.instructions,
        scope: null,
      });
      assert.ok(r.ok, r.error ?? '');
    } finally {
      await transport.close();
    }
    assert.throws(() => writeAdapter(dir, answers), /already exists/);
  } finally {
    product.kill();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('an endpoint that lists models is detected as OpenAI-compatible', async () => {
  const fake = ((url: string) =>
    Promise.resolve(
      url.endsWith('/v1/models')
        ? new Response(JSON.stringify({data: [{id: 'llama3.2'}]}))
        : new Response('no', {status: 404}),
    )) as typeof fetch;
  assert.deepEqual(await detectOpenAi('http://localhost:11434', fake), {
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  });
  const src = adapterSource({
    transport: 'openai',
    url: 'http://localhost:11434/v1',
    model: 'llama3.2',
    channels: ['email'],
    audience: ['customers'],
    name: 'x',
    version: '1',
  });
  assert.match(src, /systemPromptFile/);
  assert.match(src, /channels: \["email"\]/);
});

test('unknown channels are refused with the list of real ones', async () => {
  await assert.rejects(
    gatherAnswers({command: 'node x.js', channels: 'fax', yes: true}, os.tmpdir()),
    /web_chat/,
  );
});

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`${url} never answered`);
}
