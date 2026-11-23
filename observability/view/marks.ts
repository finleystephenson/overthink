/**
 * @fileoverview "Your AI" marks: every record the product created or changed, and every message it wrote.
 *
 * Marks come from two places and nowhere else: the product's own calls in the sandbox trace (a call that changed
 * something marks the records its audit names) and the conversation records Overthink writes for it at the end of an
 * arm (observability/view/materialise.ts). So a product that does nothing has no marks, and every mark points back at one call
 * or one line it wrote.
 */
import type {TraceEntry} from '../../infrastructure/server/sandboxes.mjs';

/** What a mark is about. */
export type MarkKind = 'action' | 'message' | 'conversation';

/** One record the product created, changed or wrote. */
export interface Mark {
  /** The record's id as the apps show it (EM-000123, CT-00012, CASE-9001, ORD-10442 ...). */
  id: string;
  kind: MarkKind;
  /** The app that shows the record best. */
  app: string;
  /** The conversation (session id) it belongs to. */
  session: string;
  /** The trace entry, for an action. */
  seq?: number;
  tool?: string;
  /** In plain words: what the product did. */
  what: string;
}

/** Record ids the engine writes, by prefix. */
const ID_PATTERN = /\b(?:ORD|CASE|RET|EM|CH|SP|CT|CONV|PO|TASK|REV|FIX|BKG|REG|SHP|TH)-\d+\b/g;

/** The app each kind of record lives in. */
const APP_BY_PREFIX: Readonly<Record<string, string>> = {
  ORD: 'till',
  CASE: 'front-desk',
  RET: 'front-desk',
  CT: 'front-desk',
  CONV: 'front-desk',
  REV: 'front-desk',
  FIX: 'front-desk',
  BKG: 'front-desk',
  REG: 'front-desk',
  EM: 'letterbox',
  TH: 'letterbox',
  CH: 'kettle',
  SP: 'mutter',
  PO: 'stockroom',
  TASK: 'kettle',
  SHP: 'till',
};

/** The app a record id belongs in. */
export function appFor(id: string): string {
  return APP_BY_PREFIX[id.split('-')[0] ?? ''] ?? 'front-desk';
}

/** True for a trace entry that changed the business. Reads (and refused calls) change nothing. */
export function changedSomething(e: TraceEntry): boolean {
  return e.ok === true && Array.isArray(e['changes']) && (e['changes'] as unknown[]).length > 0;
}

/**
 * Marks for the product's calls: one per record each changing call names in its audit lines, its result or its
 * input. A changing call that names no record still gets one mark, on the call itself, so none is hidden.
 */
export function actionMarks(trace: readonly TraceEntry[]): Mark[] {
  const marks: Mark[] = [];
  for (const e of trace) {
    if (!changedSomething(e)) continue;
    const changes = (e['changes'] as unknown[]).map(String);
    const ids = new Set<string>();
    for (const text of [
      ...changes,
      JSON.stringify(e['result'] ?? null),
      JSON.stringify(e['input'] ?? null),
    ])
      for (const m of text.matchAll(ID_PATTERN)) ids.add(m[0]);
    const base = {
      kind: 'action' as const,
      session: e.actor?.session ?? '',
      seq: e.seq,
      tool: String(e.tool),
      what: `${String(e.tool)}: ${changes[0] ?? 'changed a record'}`,
    };
    if (ids.size === 0) marks.push({...base, id: `call-${e.seq}`, app: 'front-desk'});
    for (const id of ids) marks.push({...base, id, app: appFor(id)});
  }
  return marks;
}
