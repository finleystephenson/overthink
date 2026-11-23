---
name: overthink
description: Test an AI product (support agent, sales agent, internal tool, content or operations agent) inside Overthought & Co., a simulated business in a sandbox. You plan the test, create synthetic people and activity, run it with and without the product, and report what the records show. Use when the user says "I want to test my AI product using Overthink", "use /overthink", "test my agent in a simulated business", or asks what their AI product would do in a real business.
argument-hint: "[path to the product's repo, adapter file or URL]"
---

# /overthink

Test the product at `$ARGUMENTS` (or the current project if empty) inside Overthought & Co. Work in the user's own project folder; `overthink` below means `npx github:finleystephenson/overthink` (Node 24+), nothing to clone. You are the experimenter: Overthink provides the business and the tools, never the test.

Follow `AGENTS.md` in the Overthink package and the guides in `ai-instructions/` as you reach each step:

1. **Set up** (`ai-instructions/setup.md`): read the product's code; `overthink init --url <address> --channels <list> --yes --no-run` writes `overthink.adapter.ts`; `overthink check --adapter overthink.adapter.ts`; choose channels and access and say what you chose in one line.
2. **Start** the sandbox in its own terminal: `overthink up --adapter overthink.adapter.ts`. Give the user the Rummage address it prints.
3. **Plan** (`ai-instructions/planning-a-test.md`): one question the records can answer, the people, what they do and when. Show the plan in a few lines.
4. **Make the people** (`ai-instructions/synthetic-users.md`): `overthink act create-person --count N`, varied and fair, with hard cases and people who try to break it. Your model voices them; the shop's rules decide outcomes.
5. **Run** (`ai-instructions/running.md`): `overthink act batch --file plan.json`, `overthink act advance-time --days N`; carry conversations on from `overthink act observe`. Then the same plan without the product (`overthink up` with no adapter).
6. **Report** (`ai-instructions/reading-results.md`): what the records show, each fact with its record id; then your proposals, labelled as yours. Rerun after a fix and say what moved.
7. **Reset** before every comparison: `overthink reset --yes`.

Never give the product the owner key, and never write a paid API key into a file. Simulated people, not real ones: results are facts about the simulated business.
