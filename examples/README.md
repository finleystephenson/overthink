# Examples

| Example | What it shows |
| --- | --- |
| [`first-test/`](first-test/first-test.ts) | A small test written the way a coding agent writes one: people drawn from the population, one who tries to break the rules, messages spread over days, time moved, and the facts printed from the trace. Run it against `overthink up`. |
| [`benchmark/`](benchmark/README.md) | The older fixed-scenario benchmark: 23 scenario files run against an assistant and scored. Kept working as an example of one way to test, not the way. |

Examples of connecting a product (an HTTP service, a command, an OpenAI-compatible model) are in [`integrations/examples/`](../integrations/examples).

Run the first test against the example product, from this repository:

```sh
node integrations/examples/http-server.ts &                                   # a rules-based stand-in product on :8737
pnpm overthink up --adapter integrations/examples/http.adapter.ts             # terminal 1
node examples/first-test/first-test.ts                                        # terminal 2
```
