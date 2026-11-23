// A product behind a web address. Run: node integrations/examples/http-server.ts
// Rules, not AI: it looks the order up when the customer gives a number and postcode, and otherwise asks for them.
// Replace answer() with a call into your own product.
import http from 'node:http';

interface Turn {
  conversation: {role: string; content: string}[];
}

function answer(turn: Turn): object {
  const last = turn.conversation.at(-1);
  if (last?.role === 'tool') return {reply: `Here is what I found: ${last.content.slice(0, 300)}`};
  const text = turn.conversation.map((m) => (m.role === 'user' ? m.content : '')).join(' ');
  const order = /ORD-\d+/.exec(text)?.[0];
  const postcode = /[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}/.exec(text)?.[0];
  if (order === undefined || postcode === undefined) {
    return {reply: 'Could you give me your order number and the postcode it was sent to?'};
  }
  const verify = {
    name: 'verify_customer',
    arguments: {reference: order, email_or_postcode: postcode},
  };
  return {tool_calls: [verify, {name: 'get_order', arguments: {order_number: order}}]};
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  req.on('end', () => {
    const turn = JSON.parse(Buffer.concat(chunks).toString()) as Turn;
    res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(answer(turn)));
  });
});
server.listen(Number(process.env['PORT'] ?? 8737), '127.0.0.1');
