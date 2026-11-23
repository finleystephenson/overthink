# integrations

How a product connects to the business.

| Path | What it is |
| --- | --- |
| `adapter/` | The contract a product speaks (`contract.ts`), its three transports (HTTP, a command, an OpenAI-compatible model), the tool gateway that applies its role and scope, the turn loop, `overthink check`. |
| `init/` | `overthink init`: writes `overthink.adapter.ts` in the developer's repo. |
| `deploy.ts` | A product deployed on channels of a live sandbox (`overthink up --adapter`): it answers activity where people wrote. |
| `examples/` | Products and adapters to copy: an HTTP service, a command, a do-nothing floor, an OpenAI-compatible adapter, a stand-in receptionist for the older web-address jobs. |
| `claude-plugin/` | The Claude Code plugin with the `/overthink` skill (listed by `.claude-plugin/marketplace.json` at the repository root). |

A product that is itself an MCP client connects to the business's `/mcp` with a role key instead: `docs/connect.md`.
