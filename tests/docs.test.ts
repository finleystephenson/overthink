/**
 * @fileoverview The entry points a coding agent finds first stay in place and in sync.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the README opens with the line for coding agents, and llms.txt points at the playbook', () => {
  const top = read('README.md').split('\n').slice(0, 5).join('\n');
  assert.match(top, /npx github:finleystephenson\/overthink init/);
  assert.match(top, /AGENTS\.md/);
  const llms = read('llms.txt');
  assert.match(llms, /^# Overthink/);
  for (const doc of [
    'AGENTS.md',
    'ai-instructions/README.md',
    'ai-instructions/synthetic-users.md',
    'activity-generation/README.md',
    'docs/run.md',
  ])
    assert.ok(llms.includes(`](${doc})`) && fs.existsSync(path.join(ROOT, doc)), doc);
});

test('the Claude Code skill and the plugin’s copy are the same file', () => {
  assert.equal(
    read('.claude/skills/overthink/SKILL.md'),
    read('integrations/claude-plugin/skills/overthink/SKILL.md'),
  );
});

test('the installed command is the launcher, and the package ships what it needs', () => {
  const pkg = JSON.parse(read('package.json')) as {
    name: string;
    bin: Record<string, string>;
    files: string[];
  };
  assert.equal(pkg.name, 'overthink', 'npx runs the bin named like the package');
  assert.equal(pkg.bin['overthink'], 'bin/overthink.mjs');
  for (const f of [
    'bin/',
    'activity-generation/',
    'ai-instructions/',
    'applications/',
    'business/data/',
    'infrastructure/',
    'integrations/',
    'observability/',
    'simulation/',
    'AGENTS.md',
    'LICENSE',
    'llms.txt',
  ])
    assert.ok(pkg.files.includes(f), f);
  assert.ok(
    pkg.files.includes('!business/data/world/'),
    'the built world is not shipped: it builds on first run',
  );
});

test('every guide AGENTS.md and the ai-instructions index point at exists', () => {
  for (const file of ['AGENTS.md', 'ai-instructions/README.md', 'docs/README.md', 'README.md']) {
    const dir = path.dirname(path.join(ROOT, file));
    for (const [, target] of read(file).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (target === undefined || /^https?:/.test(target)) continue;
      assert.ok(fs.existsSync(path.join(dir, target)), `${file} links to ${target}`);
    }
  }
});

test('the licence is Apache 2.0, with a NOTICE and the trademark note', () => {
  assert.match(read('LICENSE'), /Apache License\s+Version 2\.0, January 2004/);
  assert.match(read('NOTICE'), /Copyright 2026 Expanza Limited/);
  assert.ok(fs.existsSync(path.join(ROOT, 'TRADEMARKS.md')));
  assert.equal((JSON.parse(read('package.json')) as {license: string}).license, 'Apache-2.0');
});
