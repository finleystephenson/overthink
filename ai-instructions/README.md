# Instructions for coding agents

You are the experimenter. Overthink gives you a working business, Overthought & Co., and the tools to act in it. You plan the test, create the people and activity, run it, and read what happened. Nothing here prescribes a test.

Read in this order, and only what the task needs:

| When | Read |
| --- | --- |
| Before anything: start the sandbox, connect the product, choose channels and access | [setup.md](setup.md) |
| Turning the user's goal into a scenario | [planning-a-test.md](planning-a-test.md) |
| Making synthetic people (do not skip this) | [synthetic-users.md](synthetic-users.md) |
| Running it, with and without the product | [running.md](running.md) |
| Reading and explaining what happened | [reading-results.md](reading-results.md) |
| Starting again | [resetting.md](resetting.md) |

Every action you can take is listed, with its fields, by `overthink act --help`, by the MCP tool list at `/mcp/activity`, and in [`activity-generation/README.md`](../activity-generation/README.md).

Three rules that apply everywhere:

1. **Records, not claims.** What happened is what the business's records show (emails, orders, refunds, cases, the trace), never what the product or a model says happened.
2. **Your model voices people; code decides outcomes.** Use a model to write what a person says. Let the shop's rules decide what happens to them.
3. **Facts first, then your view, labelled.** Report what the records show. If you propose fixes, say they are your proposals.
