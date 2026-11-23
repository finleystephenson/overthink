#!/usr/bin/env node
// The floor: passes on every contact (no reply, no tool calls), so staff do all the work. A twin run with it shows
// zero difference in the business, which is how Overthink proves its two arms are fair.
import {createInterface} from 'node:readline';

for await (const line of createInterface({input: process.stdin})) {
  if (line.trim()) process.stdout.write('{}\n');
}
