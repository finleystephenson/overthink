/**
 * @fileoverview The running sandbox this project uses: written by `overthink up`, read by `overthink act` and
 * `overthink reset`. It lives in `.overthink/sandbox.json` in the developer's project.
 *
 * It holds the sandbox's owner key, so the file is readable by its owner only, `.overthink/` is git-ignored, and
 * the key works only for a server on this machine (it listens on 127.0.0.1) and only while that server runs.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Where a running sandbox is, and its owner key. */
export interface SandboxSession {
  /** The server's address, e.g. http://127.0.0.1:4747. */
  url: string;
  sandbox: string;
  key: string;
  pid: number;
  started_at: string;
}

/** The session file for a project folder. */
export function sessionFile(dir = process.cwd()): string {
  return path.join(dir, '.overthink', 'sandbox.json');
}

/** Writes the session file, owner-readable only. */
export function writeSession(s: SandboxSession, dir = process.cwd()): string {
  const file = sessionFile(dir);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`, {mode: 0o600});
  return file;
}

/** The session, or null when there is none (or it is unreadable). */
export function readSession(dir = process.cwd()): SandboxSession | null {
  try {
    const s = JSON.parse(fs.readFileSync(sessionFile(dir), 'utf8')) as Partial<SandboxSession>;
    if (typeof s.url !== 'string' || typeof s.sandbox !== 'string' || typeof s.key !== 'string')
      return null;
    return {
      url: s.url,
      sandbox: s.sandbox,
      key: s.key,
      pid: s.pid ?? 0,
      started_at: s.started_at ?? '',
    };
  } catch {
    return null;
  }
}

/** Deletes the session file if it still names this process (a later `up` may have replaced it). */
export function clearSession(pid: number, dir = process.cwd()): void {
  if (readSession(dir)?.pid === pid) fs.rmSync(sessionFile(dir), {force: true});
}
