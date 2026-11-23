// Campaigns and website traffic.
import { rngFor } from "./rng.mjs";
import { DAY, START, dateOf, parse, growth } from "./calendar.mjs";
import { LAUNCH } from "./catalogue.mjs";

/** How much a campaign lifts orders while it runs. WHY: email to past buyers works best; paid search and social less. */
const LIFT = { email: 1.15, search: 1.08, social: 1.1, none: 1.3 };
/** Visits per pound of spend, by channel. WHY: rough small-shop figures; search clicks cost about 60p. */
const VISITS_PER_POUND = { email: 0, search: 1.6, social: 2.2, none: 0 };
/** Share of website visits that become an order. WHY: 1.5 to 2.5% is typical for a small UK shop. */
const CONVERSION = 0.021;
/** Share of baskets started that are abandoned without any stock problem. WHY: around 70% is normal online. */
const ABANDON = 0.7;
const CHANNEL_MIX = [["direct", 0.34], ["search", 0.31], ["social", 0.15], ["email", 0.1], ["referral", 0.1]];

const PRODUCT_NAMES = { "pocket-jungle": "Pocket Jungle", "skimming-stones": "Skimming Stones", "starter-puddle": "Starter Puddle", "biscuit-tin": "Biscuit Tin", "boombox-mini": "Boombox Mini", blip: "Blip", trophy: "Trophy", "indoor-helmet": "Indoor Helmet", "ice-by-post": "Ice by Post", daypack: "Daypack", "other-umbrella": "Other Umbrella", "bubble-wrap": "Bubble Wrap", "one-good-pen": "One Good Pen" };

/** Month names for the always-on campaign titles. */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The marketing plan for five years. Spend grows with the business and with the world's size (scale).
 * On top of the named campaigns, each month has an always-on search and social budget that brings the month's
 * total up to business/data/costs.json marketing_per_month (times scale and the size of the business then), so history
 * spends what the simulator spends. Always-on spend keeps the shop visible; it does not lift demand above the
 * normal level (that level already assumes it), so it has no lift of its own.
 */
export function planCampaigns(scale, now, costs) {
  const list = [];
  // WHY: spend follows the size of the business, so a tiny first-year shop does not outspend its sales.
  const add = (name, channel, start, end, spend, code = null, pct = 0) => {
    const size = 0.25 + 0.75 * growth(parse(start));
    if (parse(start) < parse(dateOf(now))) list.push({ name, channel, start, end, spend: Math.round(spend * scale * size), code, discount_pct: pct });
  };
  add("Launch week", "social", "2021-11-22", "2021-12-05", 300, "HELLO10", 10);
  for (let y = 2022; y <= 2026; y++) {
    add(`Spring search ${y}`, "search", `${y}-03-01`, `${y}-04-30`, 500);
    add(`Back to school ${y}`, "social", `${y}-09-01`, `${y}-09-21`, 350);
    add(`Christmas gift guide ${y}`, "email", `${y}-11-16`, `${y}-12-18`, 80, `GIFT${String(y).slice(2)}`, 10);
    add(`Christmas search ${y}`, "search", `${y}-11-20`, `${y}-12-20`, 800);
  }
  // WHY: one free newspaper mention, so a campaign with channel "none" exists and spend is not everything.
  add("Weekend paper gift guide mention", "none", "2024-12-07", "2024-12-14", 0);
  for (const [id, day] of Object.entries(LAUNCH)) {
    if (day <= "2022-01-01") continue;
    const end = dateOf(parse(day) + 13 * DAY);
    add(`Launch: ${PRODUCT_NAMES[id]}`, "social", day, end, 250);
  }
  if (costs) list.push(...alwaysOn(list, scale, now, costs));
  list.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  return list.map((c, i) => ({ id: "CMP-" + String(i + 1).padStart(3, "0"), ...c }));
}

/** One always-on campaign a month: the month's marketing budget less what named campaigns started that month. */
function alwaysOn(named, scale, now, costs) {
  const out = [];
  for (let d = new Date(START); d.getTime() < now; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const start = dateOf(Math.max(START, Date.UTC(y, m, 1)));
    const end = dateOf(Date.UTC(y, m + 1, 0));
    const month = start.slice(0, 7);
    const budget = costs.marketing_per_month * scale * growth(Date.UTC(y, m, 15)) * (m === 11 ? costs.marketing_december_multiplier : 1);
    const used = named.filter((c) => c.start.startsWith(month)).reduce((n, c) => n + c.spend, 0);
    const spend = Math.round(budget - used);
    if (spend > 0 && parse(start) < parse(dateOf(now))) out.push({ name: `Always-on search and social, ${MONTHS[m]} ${y}`, channel: "search", start, end, spend, code: null, discount_pct: 0, always_on: true });
  }
  return out;
}

const live = (c, t) => t >= parse(c.start) && t < parse(c.end) + DAY;

export function campaignBoost(t, campaigns) {
  return campaigns.reduce((m, c) => (live(c, t) && !c.always_on ? m * LIFT[c.channel] : m), 1);
}

export function activeCode(t, campaigns) {
  return campaigns.find((c) => c.code && live(c, t))?.code || null;
}

/** Adds visits and orders attributed to each campaign once the orders exist. */
export function finishCampaigns(seed, campaigns, orders) {
  return campaigns.map((c) => {
    const rng = rngFor(seed, "campaign", c.id);
    const inWindow = orders.filter((o) => live(c, parse(o.placed_at)));
    // WHY: a code proves the link; without one, credit the campaign with the lift it caused.
    const attributed = c.code ? inWindow.filter((o) => o.discount_code === c.code).length
      : c.always_on ? 0 : Math.round(inWindow.length * (1 - 1 / LIFT[c.channel]));
    const visits = c.channel === "email" ? Math.round(attributed / CONVERSION * rng.between(0.5, 0.8))
      : c.channel === "none" ? Math.round(attributed / CONVERSION) : Math.round(c.spend * VISITS_PER_POUND[c.channel] * rng.between(0.85, 1.15));
    return { ...c, visits, orders_attributed: attributed };
  });
}

/** One row per trading day: visits by channel, product page views, baskets started and abandoned, orders. */
export function webSessions(seed, days, orders, lostBaskets, cat) {
  const byDay = new Map();
  for (const o of orders) {
    const d = o.placed_at.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(o);
  }
  return days.map((day) => {
    const d = dateOf(day);
    const rng = rngFor(seed, "web", d);
    const list = byDay.get(d) || [];
    const placed = list.length;
    const lost = lostBaskets.get(d) || 0;
    const visits = Math.max(placed + lost, Math.round((placed + lost) / CONVERSION * rng.between(0.85, 1.15)) || rng.int(3, 12));
    const byChannel = {};
    let left = visits;
    CHANNEL_MIX.forEach(([ch, share], i) => {
      const n = i === CHANNEL_MIX.length - 1 ? left : Math.round(visits * share * rng.between(0.8, 1.2));
      byChannel[ch] = Math.max(0, Math.min(n, left));
      left -= byChannel[ch];
    });
    const views = {};
    for (const p of cat.products) {
      if (p.id && LAUNCH[p.id] > d) continue;
      const sold = list.reduce((n, o) => n + o.items.filter((i) => cat.skus[i.sku].product === p.id).length, 0);
      views[p.id] = Math.round(sold * rng.between(12, 25) + visits * 0.05 * rng.next());
    }
    const started = Math.round((placed + lost) / (1 - ABANDON));
    return { date: d, visits: byChannel, total_visits: visits, product_page_views: views, baskets_started: started,
      baskets_abandoned: started - placed, baskets_lost_to_stockouts: lost, orders: placed };
  });
}
