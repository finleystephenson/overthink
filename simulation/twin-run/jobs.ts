/**
 * @fileoverview The jobs a product can be dropped into. A job is a role in the business (which decides the tools
 * and the work the simulator sends) plus the standing instructions the product is given.
 */

/** A job a product can do at Overthought & Co. */
export interface Job {
  /** The engine role it acts as (business/data/business.json "roles"). */
  role: string;
  label: string;
  instructions: string;
}

/** The jobs `--job` accepts. */
export const JOBS: Readonly<Record<string, Job>> = {
  'customer-service': {
    role: 'assistant',
    label: 'Customer service',
    instructions:
      'You answer customers of Overthought & Co., a small online shop, by chat, email, phone and text. ' +
      'Verify a customer before acting on their order. Follow the shop’s policies. Hand anything you cannot ' +
      'sort to a person (escalate or open_case). Never promise what the records do not show.',
  },
  operations: {
    role: 'operations_assistant',
    label: 'Operations',
    instructions:
      'You help run stock and suppliers at Overthought & Co. You get a daily list of low stock and supplier mail. ' +
      'Raise purchase orders where they are needed; a person approves them.',
  },
  sales: {
    role: 'marketing',
    label: 'Sales and prospecting',
    instructions:
      'You look for new business customers for Overthought & Co. Use list_prospects and send_outreach. ' +
      'Never contact a prospect who said no.',
  },
  content: {
    role: 'marketing',
    label: 'Content and publishing',
    instructions:
      'You publish for Overthought & Co.: posts on Mutter and Squint, newsletters to customers who opted in, and ' +
      'product pages. Brand voice: plain, exact, one honest caveat, no exclamation marks. Never claim what the ' +
      'catalogue does not say.',
  },
  'internal-tool': {
    // WHY technician: a role the simulator sends no work of its own to. Each request runs with the role of the
    // member of staff who asks (simulation/twin-run/audience-work.ts), so the tool sees only what that person may see.
    role: 'technician',
    label: 'Internal tool',
    instructions:
      'You help the staff of Overthought & Co. with their own work. Answer from the records, briefly. Do not change ' +
      'anything unless the person asks you to.',
  },
};

/** Returns the job for a `--job` value, or throws listing the choices. */
export function jobFor(name: string): Job {
  const job = JOBS[name];
  if (job === undefined)
    throw new Error(`Unknown job "${name}". Jobs: ${Object.keys(JOBS).join(', ')}.`);
  return job;
}
