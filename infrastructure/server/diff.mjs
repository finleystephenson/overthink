// Which records differ from the sandbox's starting state. Records are matched by their own id
// (number, id, month or date), so a change shows as one record with the fields that moved.

const SKIP = new Set(["audit"]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (r, i) => r?.number ?? r?.id ?? r?.month ?? r?.date ?? `#${i}`;

function fieldChanges(before, after) {
  const fields = {};
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (!same(before?.[k], after?.[k])) fields[k] = { before: before?.[k] ?? null, after: after?.[k] ?? null };
  }
  return fields;
}

export function diffStates(start, now) {
  const changes = [];
  for (const name of new Set([...Object.keys(start), ...Object.keys(now)])) {
    if (SKIP.has(name)) continue;
    const a = start[name];
    const b = now[name];
    if (same(a, b)) continue;
    if (Array.isArray(a) && Array.isArray(b)) {
      const before = new Map(a.map((r, i) => [keyOf(r, i), r]));
      const after = new Map(b.map((r, i) => [keyOf(r, i), r]));
      for (const [k, r] of after) {
        if (!before.has(k)) changes.push({ collection: name, id: k, change: "added", record: r });
        else if (!same(before.get(k), r)) changes.push({ collection: name, id: k, change: "changed", fields: fieldChanges(before.get(k), r) });
      }
      for (const [k, r] of before) if (!after.has(k)) changes.push({ collection: name, id: k, change: "removed", record: r });
    } else if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a)) {
      // Keyed objects such as stock (by SKU) and counters.
      for (const [k, f] of Object.entries(fieldChanges(a, b))) changes.push({ collection: name, id: k, change: "changed", fields: { value: f } });
    } else {
      changes.push({ collection: name, id: null, change: "changed", fields: { value: { before: a ?? null, after: b ?? null } } });
    }
  }
  const summary = {};
  for (const c of changes) (summary[c.collection] ||= { added: 0, changed: 0, removed: 0 })[c.change]++;
  return { summary, changes };
}
