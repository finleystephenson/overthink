/**
 * @fileoverview The activity toolset on the sandbox server: HTTP routes and an MCP server, both made from the one
 * list of actions (actions.ts).
 *
 *   GET  /sandboxes/{id}/activity            the actions, with their input schemas
 *   POST /sandboxes/{id}/activity/{action}   run one; the body is its input
 *   /mcp/activity                            the same actions as MCP tools (streamable HTTP)
 *
 * All of them need the sandbox's owner key. WHY: activity speaks for people outside the company; a product under
 * test holds a role key and must never reach these, or it could write its own customers.
 */
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import type {IncomingMessage} from 'node:http';
import type {Principal, Sandbox, SandboxStore} from '../infrastructure/server/sandboxes.mjs';
import {ACTIONS} from './actions.ts';
import {openActivity} from './api.ts';

/** One route, in the shape infrastructure/server/http.mjs uses: method, pattern, handler → [status, body]. */
type Route = [
  string,
  RegExp,
  (
    req: IncomingMessage,
    url: URL,
    params: string[],
  ) => Promise<[number, unknown]> | [number, unknown],
];

/** What the server lends the routes. */
export interface RouteDeps {
  store: SandboxStore;
  /** The sandbox and principal, if the request carries that sandbox's owner key; otherwise it throws. */
  ownerOf(req: IncomingMessage, id: string): {sandbox: Sandbox; principal: Principal};
  readJson(req: IncomingMessage): Promise<unknown>;
}

/** The actions as a list a client can show. */
export function describeActions(): {
  name: string;
  title: string;
  description: string;
  input: unknown;
  read_only: boolean;
}[] {
  return ACTIONS.map((a) => ({
    name: a.name,
    title: a.title,
    description: a.description,
    input: a.input,
    read_only: a.readOnly === true,
  }));
}

/** The HTTP routes. */
export function activityRoutes(deps: RouteDeps): Route[] {
  return [
    [
      'GET',
      /^\/sandboxes\/([0-9a-f]{16})\/activity$/,
      (req, _url, [id]) => {
        deps.ownerOf(req, id ?? '');
        return [200, {ok: true, data: describeActions()}];
      },
    ],
    [
      'POST',
      /^\/sandboxes\/([0-9a-f]{16})\/activity\/([a-z_]+)$/,
      async (req, _url, [id, action]) => {
        const {sandbox, principal} = deps.ownerOf(req, id ?? '');
        const body = (await deps.readJson(req)) ?? {};
        if (typeof body !== 'object' || Array.isArray(body)) {
          return [
            200,
            {
              ok: false,
              error: {
                code: 'invalid_input',
                message: 'The body must be a JSON object: the action’s input.',
              },
            },
          ];
        }
        const r = await openActivity(deps.store, sandbox, {principal, via: 'http'}).perform(
          action ?? '',
          body as Record<string, unknown>,
        );
        // A refusal is a normal answer (HTTP 200, ok false), as for the business tools.
        return [200, r.ok ? {ok: true, data: r.data} : {ok: false, error: r.error}];
      },
    ],
  ];
}

/** An MCP server bound to one sandbox, offering the activity actions as tools. */
export function createActivityMcpServer(o: {
  store: SandboxStore;
  sandbox: Sandbox;
  principal: Principal;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the low-level Server, on purpose (see below)
}): Server {
  // WHY the low-level Server (as infrastructure/server/mcp.mjs): McpServer wants Zod schemas, and the actions'
  // JSON Schemas should reach the client unchanged. The SDK marks it deprecated for that reason only.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const server = new Server(
    {
      name: 'overthink-activity',
      title: 'Overthink activity (the sandbox around Overthought & Co.)',
      version: '0.1.0',
    },
    {
      capabilities: {tools: {}},
      instructions: [
        'These tools create activity in a sandboxed copy of Overthought & Co., a simulated business: synthetic people,',
        'their emails, chats, posts, orders, returns and reviews, supplier and staff events, world events, and the',
        'passing of time. They act for the world outside the company, never for the product being tested. Plan the',
        'test yourself (ai-instructions/planning-a-test.md); observe shows what happened; reset starts again.',
      ].join(' '),
    },
  );
  const act = openActivity(o.store, o.sandbox, {principal: o.principal, via: 'mcp'});
  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: ACTIONS.map((a) => ({
        name: a.name,
        title: a.title,
        description: a.description,
        inputSchema: a.input,
        annotations: {
          title: a.title,
          readOnlyHint: a.readOnly === true,
          destructiveHint: a.name === 'reset',
          openWorldHint: false,
        },
      })),
    }),
  );
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await act.perform(req.params.name, req.params.arguments ?? {});
    return {
      content: [{type: 'text', text: JSON.stringify(r.ok ? r.data : {error: r.error})}],
      isError: !r.ok,
    };
  });
  return server;
}
