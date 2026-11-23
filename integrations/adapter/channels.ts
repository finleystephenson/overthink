/**
 * @fileoverview The channels a product can be deployed on, as in the real shop: put on the website's chat widget,
 * given the hello@ inbox, the phone line, the text-message number, the Mutter and Squint inboxes, staff chat, the
 * suppliers@ inbox, the sales mailbox, or the pen that publishes posts, newsletters and product pages. A contact on a
 * channel the product is not on goes to staff, exactly as if the product were absent for it.
 *
 * Each channel belongs to one audience (activity-generation/people/audiences.ts): who is on the other end of it.
 */

/** Every channel, and where it is in the business. */
export const CHANNELS: Readonly<Record<string, string>> = {
  web_chat: 'the chat widget on the shop’s website (Front Desk shows the chats)',
  email: 'the hello@ inbox (Letterbox)',
  phone: 'the phone line, calls as text (Front Desk)',
  text: 'the text-message number (Front Desk)',
  mutter_dm: 'private messages to the shop on Mutter',
  squint_dm: 'private messages to the shop on Squint',
  mutter_mention: 'public Mutter posts that tag the shop, answered in public',
  internal: 'staff asking for help in their own work (Kettle, the team’s chat)',
  supplier_mail: 'the suppliers@ inbox: suppliers’ queries, delays and replies (Letterbox)',
  outreach: 'writing to prospect businesses from the sales mailbox (Letterbox)',
  publishing: 'posts on Mutter and Squint, newsletters through Megaphone, product pages in Till',
};

/** The channel names, in order. */
export const CHANNEL_NAMES: readonly string[] = Object.keys(CHANNELS);

/** Channels on which the simulator raises customer contacts (one conversation each). */
export const CONTACT_CHANNELS: readonly string[] = [
  'web_chat',
  'email',
  'phone',
  'text',
  'mutter_dm',
  'squint_dm',
  'mutter_mention',
];

/** Who is on the other end of each channel. */
export const CHANNEL_AUDIENCE: Readonly<Record<string, string>> = {
  web_chat: 'customers',
  email: 'customers',
  phone: 'customers',
  text: 'customers',
  mutter_dm: 'customers',
  squint_dm: 'customers',
  mutter_mention: 'customers',
  internal: 'staff',
  supplier_mail: 'suppliers',
  outreach: 'businesses',
  publishing: 'public',
};

/** Returns `list` checked, or throws naming the unknown channel and the choices. */
export function checkChannels(list: readonly string[], where = 'channels'): string[] {
  for (const c of list)
    if (!CHANNEL_NAMES.includes(c))
      throw new Error(`${where}: unknown channel "${c}". Channels: ${CHANNEL_NAMES.join(', ')}.`);
  return [...new Set(list)];
}
