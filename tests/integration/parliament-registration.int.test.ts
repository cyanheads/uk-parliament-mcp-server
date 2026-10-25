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

it('advertises exactly nine read-only Parliament tools and actionable instructions over MCP stdio', async () => {
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
      resolve: (result: unknown) => void;
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
      else entry.resolve(reply.result);
    } catch (cause) {
      rejectPending(new Error('Server stdout contained an invalid MCP response.', { cause }));
    }
  });
  child.on('error', rejectPending);
  child.on('exit', (code, signal) =>
    rejectPending(new Error(`Server exited ${code ?? signal}: ${stderr}`)),
  );
  let requestId = 0;
  const request = (method: string, params: unknown) => {
    const id = ++requestId;
    return new Promise<unknown>((resolve, reject) => {
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
        await request('initialize', {
          protocolVersion: '2026-07-28',
          capabilities: {},
          clientInfo: { name: 'parliament-registration-test', version: '1.0.0' },
        }),
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
      .parse(await request('tools/list', {}));
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
    ]);
    for (const tool of listing.tools)
      expect(tool.annotations).toEqual(
        expect.objectContaining({ readOnlyHint: true, idempotentHint: true, openWorldHint: true }),
      );
    const result = z
      .object({
        content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
        structuredContent: z.object({
          topic: z.literal('identifiers'),
          identifiers: z.object({ sessionDiscovery: z.string() }),
        }),
      })
      .parse(
        await request('tools/call', {
          name: 'ukparl_lookup_reference',
          arguments: { topic: 'identifiers' },
        }),
      );
    expect(result.structuredContent.identifiers.sessionDiscovery).toContain('No session directory');
    expect(result.content.map((block) => block.text ?? '').join('\n')).toContain(
      'No session directory',
    );
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24_000);
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
