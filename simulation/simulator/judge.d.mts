export type ContactOutcome = 'resolved' | 'handed_over' | 'partial' | 'failed' | 'wrong_action';
/** Decides what a tool achieved on one contact, from the records of its calls. */
export function judgeContact(
  topic: string,
  calls: readonly {tool: string; ok: boolean; result?: unknown; error?: {code: string} | undefined}[],
  reply: string | undefined,
): {outcome: ContactOutcome; why?: string; note?: string};
