// Where the customer's words come from. A "customer" is { next(history) -> { text, done, usage } }.
//  - scripted: plays the scenario's turns in order (the default; identical every run).
//  - AI-played: a model plays the customer from the scenario's setup and can push back or follow up.
// To add another provider, write one more function that returns an object with the same `next`.
// history is the chat so far: [{ role: "customer" | "assistant", text }].

export const END = "[END]";

/** Plays the scripted turns, then stops. */
export function scriptedCustomer(turns) {
  let i = 0;
  return { next: async () => (i < turns.length ? { text: turns[i++], done: false } : { text: null, done: true }) };
}

/** Test double for --dry: plays the scripted turns, pushes back once when the assistant has answered, then ends. */
export function fakeCustomer(turns) {
  let i = 0, pushed = false;
  return {
    next: async () => {
      if (i < turns.length) return { text: turns[i++], done: false };
      if (!pushed) { pushed = true; return { text: "Are you sure? Can I speak to a person?", done: false }; }
      return { text: null, done: true };
    },
  };
}

/** The instructions the customer-playing model gets. It sees the situation and the details the customer has, never the expected answer. */
export function customerPrompt(scenario, turns) {
  return [
    "You are playing a customer chatting to the support assistant of an online shop. Stay in character. Never mention that you are an AI or that this is a test.",
    `Situation: ${scenario.setup}`,
    turns.length ? `Details you have and might say, in your own words when it fits: ${turns.map((t) => `"${t}"`).join(" ")}` : "",
    "Write only the customer's next message: one to three short sentences, like a real person typing. Give order numbers, emails or postcodes when asked, using only the details above.",
    "If the assistant refuses something, you may push back once or twice if the situation suggests you would, but do not invent new facts.",
    `When your goal is met, the assistant has said it is passing you to a person, or you would give up, reply with exactly ${END} and nothing else.`,
  ].filter(Boolean).join("\n\n");
}

/** A model plays the customer (Anthropic SDK). `client.messages.create` is all it needs, so a stub works in tests. */
export function anthropicCustomer({ client, model, scenario, turns, maxTokens = 300 }) {
  const system = customerPrompt(scenario, turns);
  return {
    next: async (history) => {
      // From the customer model's side the assistant is the "user" and the customer's own lines are "assistant".
      const messages = history.length
        ? history.map((m) => ({ role: m.role === "customer" ? "assistant" : "user", content: m.text || "(no reply)" }))
        : [{ role: "user", content: "(The chat has just opened. Write your first message.)" }];
      const res = await client.messages.create({ model, max_tokens: maxTokens, system, messages });
      const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { text: text.startsWith(END) || !text ? null : text, done: text.startsWith(END) || !text, usage: res.usage };
    },
  };
}

/**
 * Run one conversation: ask the customer for a message, give it to the agent, repeat until the customer is done
 * or `maxTurns` is reached. Returns the new transcript lines and the customer model's token usage.
 */
export async function converseWith({ customer, agent, history, maxTurns, onReply }) {
  const added = [];
  const usage = [];
  for (let n = 0; n < maxTurns; n++) {
    const c = await customer.next([...history, ...added]);
    if (c.usage) usage.push(c.usage);
    if (c.done || !c.text) break;
    added.push({ role: "customer", text: c.text });
    const r = await agent.turn(c.text);
    added.push({ role: "assistant", text: r.reply });
    onReply?.(r);
  }
  return { added, usage };
}
