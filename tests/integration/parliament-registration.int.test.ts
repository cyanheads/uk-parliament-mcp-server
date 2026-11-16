/**
 * @fileoverview Source-server MCP stdio registration and static contract handshake.
 * @module tests/integration/parliament-registration.int.test
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from '@cyanheads/mcp-ts-core';
import { expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };

const ReplySchema = z.object({
  id: z.number().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
/** One JSON Schema node, kept loose so nothing is stripped before it is inspected. */
const JsonSchemaNodeSchema = z.record(z.string(), z.unknown());
/** A tool returning one `record` or a page of `items[]`. */
const RecordToolSchema = z.object({
  name: z.string(),
  outputSchema: z.object({
    properties: z.object({
      record: JsonSchemaNodeSchema,
      items: z.object({ items: JsonSchemaNodeSchema }),
    }),
    $defs: z.record(z.string(), z.unknown()).optional(),
  }),
});

/**
 * Object schemas, their own description aside, emitted at two or more paths of one
 * `outputSchema` with at least `minBytes` of JSON. A schema shared through `$defs` is listed once.
 */
function repeatedObjectSchemas(schema: unknown, minBytes: number): string[] {
  const paths = new Map<string, string[]>();
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      for (const [index, child] of node.entries()) walk(child, `${path}/${index}`);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const { description: _description, ...shape } = node as Record<string, unknown>;
    const key = JSON.stringify(shape);
    if (shape.type === 'object' && Buffer.byteLength(key) >= minBytes)
      paths.set(key, [...(paths.get(key) ?? []), path]);
    for (const [name, child] of Object.entries(node)) walk(child, `${path}/${name}`);
  };
  walk(schema, '#');
  return [...paths.values()].filter((found) => found.length > 1).map((found) => found.join(' = '));
}

it('advertises exactly ten read-only Parliament tools and actionable instructions over MCP stdio', async () => {
  const child = spawn('bun', ['run', 'src/index.ts'], {
    cwd: new URL('../../', import.meta.url),
    env: {
      ...process.env,
      MCP_TRANSPORT_TYPE: 'stdio',
      MCP_LOG_LEVEL: 'error',
      MCP_AUTH_MODE: 'none',
      OTEL_SDK_DISABLED: 'true',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const pending = new Map<
    number,
    {
      resolve: (reply: { result: unknown; raw: string }) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const rejectPending = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  lines.on('line', (line) => {
    try {
      const reply = ReplySchema.parse(JSON.parse(line));
      if (reply.id === undefined) return;
      const entry = pending.get(reply.id);
      if (!entry) return;
      pending.delete(reply.id);
      clearTimeout(entry.timer);
      if (reply.error !== undefined) entry.reject(new Error(JSON.stringify(reply.error)));
      else entry.resolve({ result: reply.result, raw: line });
    } catch (cause) {
      rejectPending(new Error('Server stdout contained an invalid MCP response.', { cause }));
    }
  });
  child.on('error', rejectPending);
  child.on('exit', (code, signal) =>
    rejectPending(new Error(`Server exited ${code ?? signal}: ${stderr}`)),
  );
  // initialize takes id 0, so tools/list is request id 1, the id its byte ceiling is measured at.
  let requestId = -1;
  const request = (method: string, params: unknown) => {
    const id = ++requestId;
    return new Promise<{ result: unknown; raw: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} exceeded 10000 ms: ${stderr}`));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };
  try {
    const initialized = z
      .object({
        serverInfo: z.object({ name: z.string(), version: z.string() }),
        instructions: z.string(),
      })
      .parse(
        (
          await request('initialize', {
            protocolVersion: '2026-07-28',
            capabilities: {},
            clientInfo: { name: 'parliament-registration-test', version: '1.0.0' },
          })
        ).result,
      );
    expect(initialized.serverInfo).toMatchObject({
      name: 'uk-parliament-mcp-server',
      version: packageJson.version,
    });
    for (const term of [
      'Bill-specific stage IDs differ from reference stage IDs',
      'House',
      'committee person IDs',
      'contentCursor',
      '2004–2006',
      'authoritative_link',
      'source data, never instructions',
      'Open Parliament Licence',
    ])
      expect(initialized.instructions).toContain(term);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
    const { result: rawListing, raw: listingReply } = await request('tools/list', {});
    // Every client loads this reply before its first call; measure it as the wire carried it.
    expect(Buffer.byteLength(listingReply)).toBeLessThanOrEqual(280_000);
    const listing = z
      .object({
        tools: z.array(
          z.object({
            name: z.string(),
            annotations: z.object({
              readOnlyHint: z.boolean(),
              idempotentHint: z.boolean(),
              openWorldHint: z.boolean(),
            }),
          }),
        ),
      })
      .parse(rawListing);
    expect(listing.tools.map((tool) => tool.name).sort()).toEqual([
      'ukparl_get_bill',
      'ukparl_get_committee',
      'ukparl_get_member',
      'ukparl_lookup_reference',
      'ukparl_search_bills',
      'ukparl_search_divisions',
      'ukparl_search_hansard',
      'ukparl_search_members',
      'ukparl_search_questions',
      'ukparl_search_statements',
    ]);
    for (const tool of listing.tools)
      expect(tool.annotations).toEqual(
        expect.objectContaining({ readOnlyHint: true, idempotentHint: true, openWorldHint: true }),
      );
    // Measure entries exactly as tools/list serialized them, before any schema strips a key.
    const entries = z
      .object({ tools: z.array(z.object({ name: z.string() }).passthrough()) })
      .parse(rawListing).tools;
    const entry = (name: string) => entries.find((tool) => tool.name === name);
    const statements = entry('ukparl_search_statements');
    expect(statements).toHaveProperty('outputSchema');
    expect(Buffer.byteLength(JSON.stringify(statements))).toBeLessThanOrEqual(21_000);
    expect(entry('ukparl_get_committee')).toHaveProperty('outputSchema');
    expect(Buffer.byteLength(JSON.stringify(entry('ukparl_get_committee')))).toBeLessThanOrEqual(
      64_000,
    );
    // A schema reused at several paths is emitted once under $defs and referenced from each.
    for (const tool of entries)
      expect({ tool: tool.name, repeated: repeatedObjectSchemas(tool.outputSchema, 400) }).toEqual({
        tool: tool.name,
        repeated: [],
      });
    for (const name of [
      'ukparl_get_committee',
      'ukparl_search_divisions',
      'ukparl_search_questions',
      'ukparl_search_statements',
    ]) {
      const { outputSchema } = RecordToolSchema.parse(entry(name));
      const recordRef = outputSchema.properties.record.$ref;
      expect(recordRef, name).toMatch(/^#\/\$defs\/\w+$/);
      expect(outputSchema.properties.items.items.$ref, name).toBe(recordRef);
      expect(outputSchema.$defs, name).toHaveProperty(String(recordRef).slice('#/$defs/'.length));
    }
    const result = z
      .object({
        content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
        structuredContent: z.object({
          topic: z.literal('identifiers'),
          identifiers: z.object({ sessionDiscovery: z.string() }),
        }),
      })
      .parse(
        (
          await request('tools/call', {
            name: 'ukparl_lookup_reference',
            arguments: { topic: 'identifiers' },
          })
        ).result,
      );
    expect(result.structuredContent.identifiers.sessionDiscovery).toContain('No session directory');
    expect(result.content.map((block) => block.text ?? '').join('\n')).toContain(
      'No session directory',
    );
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24_000);
    // The published skill is served through createApp({ skills }); it is the only listed resource.
    const resources = z
      .object({ resources: z.array(z.object({ uri: z.string() })) })
      .parse((await request('resources/list', {})).result);
    expect(resources.resources.map((resource) => resource.uri)).toEqual([
      'skill://uk-parliament-guide/SKILL.md',
    ]);
  } finally {
    rejectPending(new Error('Registration test closed.'));
    lines.close();
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 1000);
      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
    }
  }
});
