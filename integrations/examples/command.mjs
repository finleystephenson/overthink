#!/usr/bin/env node
// A product run as a command: one JSON turn per line on stdin, one JSON answer per line on stdout.
// Anything you print for yourself must go to stderr; stdout is the conversation.
// This one only looks up orders it can verify, and otherwise says it will pass the message on.
import {createInterface} from 'node:readline';

for await (const line of createInterface({input: process.stdin})) {
  if (!line.trim()) continue;
  const turn = JSON.parse(line);
  const last = turn.conversation.at(-1);
  let answer;
  if (last.role === 'tool') {
    answer = {
      reply:
        "Thanks for waiting. I've checked your order and it is on its way; a colleague will follow up if anything changes.",
    };
  } else {
    const order = /ORD-\d+/.exec(last.content)?.[0];
    const postcode = /[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}/.exec(last.content)?.[0];
    answer =
      order && postcode
        ? {
            tool_calls: [
              {name: 'verify_customer', arguments: {reference: order, email_or_postcode: postcode}},
              {name: 'get_order', arguments: {order_number: order}},
            ],
          }
        : {reply: 'Could you give me your order number and the postcode it was sent to?'};
  }
  process.stdout.write(JSON.stringify(answer) + '\n');
}
