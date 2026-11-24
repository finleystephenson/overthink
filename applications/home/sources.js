// What Overthink searches: one source per kind of record, each read through the engine's own reading tools (so on
// `overthink view` it reads the finished run's world, read-only). Every source answers the same row shape, so the
// results page can mix them:
//   { kind, id, app, where, title, snip, date, href }
// `id` is the record's own id, so a record your AI touched can carry the "Your AI" mark. An empty query browses the
// newest of that kind. A refusal or a missing tool gives no rows, never an error on the page.

const words = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
const hasAll = (text, ws) => { const t = String(text || "").toLowerCase(); return ws.every((w) => t.includes(w)); };
const money = (n) => `£${Number(n || 0).toFixed(2).replace(/\.00$/, "")}`;
const CHANNELS = { web_chat: "Website chat", email: "Email", phone: "Phone", text: "Text message", web: "Website chat" };
const say = (s) => String(s || "").replace(/_/g, " ");
const since = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The tabs, in order. `kinds` are the sources each tab searches. */
export const TABS = [
  { id: "all", label: "All", kinds: ["ai", "people", "orders", "email", "chat", "posts", "events", "reviews", "docs", "news", "products"] },
  { id: "ai", label: "Your AI", kinds: ["ai"] },
  { id: "email", label: "Email", kinds: ["email"] },
  { id: "chat", label: "Chat", kinds: ["chat"] },
  { id: "posts", label: "Posts", kinds: ["posts"] },
  { id: "orders", label: "Orders", kinds: ["orders", "products"] },
  { id: "people", label: "People", kinds: ["people"] },
  { id: "calendar", label: "Calendar", kinds: ["events"] },
  { id: "reviews", label: "Reviews", kinds: ["reviews"] },
  { id: "docs", label: "Files", kinds: ["docs"] },
  { id: "news", label: "News", kinds: ["news"] },
];

/**
 * The sources, over one world.
 * @param {object} world the shared client (applications/lib/client.js)
 * @return {Object<string, function(string, number): Promise<Array<object>>>} kind -> (query, limit) -> rows
 */
export function makeSources(world) {
  const read = async (tool, input) => {
    try {
      const r = await world.call(tool, input, { screen: true });
      return r.ok ? r.data : null;
    } catch {
      return null;
    }
  };
  // Lists the engine cannot search are read once and matched here.
  const once = new Map();
  const cached = (key, fn) => { if (!once.has(key)) once.set(key, fn()); return once.get(key); };

  return {
    async people(q, n) {
      const ws = words(q);
      const [cust, staff] = await Promise.all([
        read("list_customers", { ...(q ? { search: q } : {}), limit: n }),
        cached("staff", () => read("list_staff", {}).then((d) => d?.team || [])),
      ]);
      const team = staff.filter((s) => hasAll(`${s.name} ${s.job} ${say(s.role)}`, ws)).slice(0, Math.ceil(n / 2)).map((s) => ({
        kind: "people", id: s.id, app: "kettle", where: "The team",
        title: s.name, snip: `${s.job}. ${cap(say(s.role))}${s.book ? `, from ${s.book}` : ""}.`, date: s.joined || null,
        href: "../kettle/?team=people",
      }));
      const customers = (cust?.customers || []).map((c) => ({
        kind: "people", id: c.id, app: "front-desk", where: "Customers",
        title: c.name, snip: `Customer since ${since(c.joined)}. ${c.orders} ${c.orders === 1 ? "order" : "orders"}. ${c.email}`, date: null,
        href: `../front-desk/?customer=${encodeURIComponent(c.id)}`,
      }));
      return [...team, ...customers].slice(0, n);
    },

    async orders(q, n) {
      const d = await read("list_all_orders", { ...(q ? { search: q } : {}), limit: n });
      return (d?.orders || []).map((o) => ({
        kind: "orders", id: o.number, app: "till", where: `Orders › ${say(o.status)}`,
        title: `Order ${o.number.replace(/^ORD-/, "")} for ${o.customer_name}`,
        snip: `${money(o.total)}, ${say(o.payment_status)}. ${(o.items || []).join("; ")}`, date: o.placed_at,
        href: `../till/#orders/${encodeURIComponent(o.number)}`,
      }));
    },

    async products(q, n) {
      if (!q) return [];
      const d = await read("search_catalogue", { query: q });
      return (d?.results || []).slice(0, n).map((p) => ({
        kind: "products", id: p.id, app: "till", where: `Products › ${p.kind}`,
        title: p.name, snip: `${p.price?.from === p.price?.to ? money(p.price?.from) : `From ${money(p.price?.from)}`}. ${p.summary || ""}`, date: null,
        href: `../till/#products/${encodeURIComponent(p.for || p.id)}`,
      }));
    },

    async email(q, n) {
      const boxes = await cached("mailboxes", () => read("list_mailboxes", {}).then((d) => (d?.mailboxes || []).map((m) => m.mailbox)));
      const lists = await Promise.all(boxes.map((mailbox) => read("list_emails", { mailbox, ...(q ? { search: q } : {}), limit: n })));
      return lists.flatMap((d) => d?.emails || []).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, n).map((m) => ({
        kind: "email", id: m.id, thread: m.thread_id, app: "letterbox", where: `${m.mailbox}@ › ${m.folder}`,
        title: m.subject || "(no subject)", snip: `${m.from?.name || m.from?.address || "Someone"}: ${m.snippet || ""}`, date: m.at,
        href: `../letterbox/?mailbox=${encodeURIComponent(m.mailbox)}&email=${encodeURIComponent(m.id)}`,
      }));
    },

    async chat(q, n) {
      const all = await cached("contacts", () => read("list_contacts", {}).then((d) => d?.contacts || []));
      const ws = words(q);
      return all.filter((c) => hasAll(`${c.customer_name} ${c.about} ${c.summary} ${say(c.topic)} ${CHANNELS[c.channel] || c.channel}`, ws)).slice(0, n).map((c) => ({
        kind: "chat", id: c.id, app: "front-desk", where: `${CHANNELS[c.channel] || cap(say(c.channel))} › ${say(c.outcome)}`,
        title: `${c.customer_name || "A customer"}: ${c.summary || c.about || say(c.topic)}`,
        snip: `${c.about || ""} ${c.handled_by ? `Answered by ${say(c.handled_by)}` : "Waiting for an answer"}${c.case_number ? `, case ${c.case_number.replace(/^CASE-/, "")}` : ""}.`, date: c.at,
        href: `../front-desk/?contact=${encodeURIComponent(c.id)}`,
      }));
    },

    async posts(q, n) {
      const all = await cached("posts", () => read("list_social_posts", { limit: 100 }).then((d) => d?.posts || []));
      const ws = words(q);
      return all.filter((p) => hasAll(`${p.text} ${p.author?.name} ${p.author?.handle}`, ws)).slice(0, n).map((p) => {
        const net = p.network === "squint" ? "squint" : "mutter";
        return {
          kind: "posts", id: p.id, app: net, where: `${cap(net)} › ${p.kind}${p.author?.handle ? ` by @${p.author.handle}` : ""}`,
          title: `${p.author?.name || "Someone"}${p.kind === "post" ? " posted" : p.kind === "reply" ? " replied" : " commented"}`,
          snip: `${p.text}${p.likes ? ` · ${p.likes} likes` : ""}`, date: p.at, href: `../${net}/`,
        };
      });
    },

    async reviews(q, n) {
      const d = await read("list_reviews", { ...(q ? { search: q } : {}), limit: n });
      return (d?.reviews || []).map((r) => ({
        kind: "reviews", id: r.id, app: "front-desk", where: `Reviews › ${r.product_name}`,
        title: `${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)} ${r.reviewer} on ${r.product_name}`,
        snip: `${r.text}${r.reply ? ` Our reply: ${r.reply.text || r.reply}` : ""}`, date: r.date,
        href: `../front-desk/?review=${encodeURIComponent(r.id)}`,
      }));
    },

    async events(q, n) {
      // WHY a window, not everything: a calendar search means what is coming up or just happened, not 2021.
      const today = (await cached("today", () => world.clock().then((c) => String(c.now).slice(0, 10)).catch(() => null))) || new Date().toISOString().slice(0, 10);
      const shift = (d, days) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
      const d = await read("list_events", { from: shift(today, -30), to: shift(today, 60), ...(q ? { search: q } : {}) });
      const KIND = { meeting: "Meeting", supplier_call: "Supplier call", reminder: "Reminder", other: "Entry", delivery: "Delivery", booking: "Booking", task: "Task due", campaign: "Campaign", world: "In the world" };
      const soon = (d?.events || []).filter((e) => e.kind !== "shift" && e.status !== "cancelled")
        .sort((a, b) => Math.abs(Date.parse(a.start.slice(0, 10)) - Date.parse(today)) - Math.abs(Date.parse(b.start.slice(0, 10)) - Date.parse(today)));
      return soon.slice(0, n).map((e) => ({
        kind: "events", id: e.id, app: "calendar", where: `Calendar › ${KIND[e.kind] || "Entry"}`,
        title: e.title, snip: `${e.all_day ? (e.end !== e.start ? `Until ${new Date(`${e.end}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}` : "All day") : `${e.start.slice(11, 16)} to ${e.end.slice(11, 16)}`}${e.people?.length ? ` · ${e.people.map((p) => p.name).join(", ")}` : ""}${e.status === "tentative" ? " · not answered yet" : ""}.`,
        date: e.start.slice(0, 10),
        href: `../calendar/?view=day&date=${encodeURIComponent(e.start.slice(0, 10))}&event=${encodeURIComponent(e.id)}`,
      }));
    },

    async docs(q, n) {
      const d = await read("search_documents", { ...(q ? { query: q } : {}), limit: n });
      return (d?.documents || []).map((x) => ({
        kind: "docs", id: x.id, app: "files", where: `Files › ${x.kind}`,
        title: x.title, snip: `${cap(x.kind)}${x.status === "out_of_date" ? ", out of date" : ""}.${x.summary ? ` ${x.summary}` : ""}`, date: x.written_at || null,
        href: `../files/?doc=${encodeURIComponent(x.id)}`,
      }));
    },

    async news(q, n) {
      const all = await cached("news", () => read("list_news", { limit: 100 }).then((d) => d?.news || []));
      const ws = words(q);
      return all.filter((x) => hasAll(`${x.headline} ${x.story} ${x.section}`, ws)).slice(0, n).map((x) => ({
        kind: "news", id: x.id, app: "daily-overthinker", where: `The Daily Overthinker › ${x.section}`,
        title: x.headline, snip: x.story, date: x.at, href: "../daily-overthinker/",
      }));
    },
  };
}
