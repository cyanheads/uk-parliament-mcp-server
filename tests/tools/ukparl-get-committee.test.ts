/**
 * @fileoverview Committee tool contracts, lossless continuation and both MCP surfaces.
 * @module tests/tools/ukparl-get-committee.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ukparlGetCommittee } from '@/mcp-server/tools/definitions/ukparl-get-committee.tool.js';
import { disposeCommittees } from '@/services/committees/committees-service.js';
import { disposeParliamentHttp } from '@/services/parliament-http/parliament-http-service.js';
import {
  business,
  businessDetail,
  committeeDetail,
  installCommittees,
  membership,
  page,
  publication,
  reconstruct,
  withFullCommitteeQueue,
} from '../services/committees/committees-fixtures.js';

type Result = Awaited<ReturnType<typeof runToolContract>>;
const text = (result: Result) =>
  result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

/** Check each scalar's exact reversible JSON value in the rendered consumption path. */
function assertRendered(value: unknown, rendered: string, path = ''): void {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value))
      if (child !== undefined)
        assertRendered(
          child,
          rendered,
          `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        );
  } else {
    const lines = rendered.split('\n');
    const index = lines.indexOf(path);
    expect(index, path).toBeGreaterThanOrEqual(0);
    expect(lines[index + 1], path).toMatch(/^`{3,}json$/);
    expect(JSON.parse(lines[index + 2]!), path).toStrictEqual(value);
  }
}

/** Follow the public recursive retrieval contract and reconstruct using its descriptors. */
async function retrieve(input: Record<string, unknown>, first: Result): Promise<unknown> {
  let output = ukparlGetCommittee.output.parse(first.structuredContent);
  let currentResult = first;
  expect(first.isError).not.toBe(true);
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(24000);
  if (output.delivery === 'full') {
    assertRendered(output, text(first));
    return output;
  }
  const initial = output.contentPage!;
  let fragments = '';
  const entries = new Map<string, unknown>();
  while (true) {
    const current = output.contentPage!;
    expect(current.path).toBe(initial.path);
    assertRendered(output, text(currentResult));
    if (current.fragment !== undefined) {
      expect(current.offset).toBe(fragments.length);
      fragments += current.fragment;
    }
    for (const entry of current.entries ?? []) {
      const child = await runToolContract(ukparlGetCommittee, {
        ...input,
        contentCursor: entry.contentCursor,
      });
      const value = await retrieve(input, child);
      expect(Buffer.byteLength(JSON.stringify(value))).toBe(entry.sizeBytes);
      entries.set(
        entry.path
          .slice(entry.path.lastIndexOf('/') + 1)
          .replaceAll('~1', '/')
          .replaceAll('~0', '~'),
        value,
      );
    }
    if (!current.hasMore) break;
    expect(current.nextCursor).toBeDefined();
    const next = await runToolContract(ukparlGetCommittee, {
      ...input,
      contentCursor: current.nextCursor,
    });
    expect(next.isError).not.toBe(true);
    expect(Buffer.byteLength(JSON.stringify(next))).toBeLessThanOrEqual(24000);
    output = ukparlGetCommittee.output.parse(next.structuredContent);
    currentResult = next;
  }
  if (initial.fragment !== undefined) return JSON.parse(fragments);
  return initial.kind === 'array' ? [...entries.values()] : Object.fromEntries(entries);
}

afterEach(() => {
  disposeCommittees();
  disposeParliamentHttp();
  vi.useRealTimers();
});

describe('ukparl_get_committee', () => {
  it.each([
    ['detail', { committeeId: '0011' }, '/api/Committees/11', committeeDetail()],
    ['inquiry', { businessId: '0031' }, '/api/CommitteeBusiness/31', businessDetail()],
    ['publication', { publicationId: '0051' }, '/api/Publications/51', publication()],
  ] as const)(
    'returns complete %s detail on both surfaces and never reads evidence documents',
    async (mode, selection, path, raw) => {
      const requests = installCommittees(() => raw);
      const result = await runToolContract(ukparlGetCommittee, { mode, ...selection });
      const decoded = await retrieve({ mode, ...selection }, result);
      const payload = ukparlGetCommittee.output.parse({ ...(decoded as object), delivery: 'full' });
      expect(payload.found).toBe(true);
      expect(reconstruct(payload.record!)).toStrictEqual(raw);
      expect(requests.every((url) => url.pathname === path)).toBe(true);
      expect([...requests[0]!.searchParams]).toEqual([['showOnWebsiteOnly', 'true']]);
      expect(result.structuredContent).toMatchObject({
        applied: { mode, showOnWebsiteOnly: true },
        notice: expect.stringContaining('No downloads or text extraction.'),
      });
      expect(text(result)).toContain('No downloads or text extraction.');
    },
  );

  it.each([
    ['joint', 'Joint'],
    [' HOUSE OF COMMONS ', 'Commons'],
    ['House of Lords', 'Lords'],
  ])('normalizes House %s without conflating Joint', async (house, upstream) => {
    const requests = installCommittees(() =>
      page([{ id: 11, house: upstream, name: 'Synthetic “name”\n```' }]),
    );
    const result = await runToolContract(ukparlGetCommittee, {
      house,
      query: '  Synthetic  ',
      committeeId: '',
      cursor: '',
      contentCursor: '',
    });
    expect(result.isError).not.toBe(true);
    const output = ukparlGetCommittee.output.parse(result.structuredContent);
    expect(JSON.parse(JSON.stringify(output.filters))).toStrictEqual({
      query: 'Synthetic',
      house: upstream!.toLowerCase(),
    });
    expect([...requests[0]!.searchParams]).toEqual([
      ['SearchTerm', 'Synthetic'],
      ['House', upstream],
      ['ShowOnWebsiteOnly', 'true'],
      ['Skip', '0'],
      ['Take', '10'],
    ]);
    assertRendered(output, text(result));
  });

  it.each(['all', 'current', 'former'] as const)(
    'retains %s membership namespaces and all role periods on both surfaces',
    async (membershipSelector) => {
      installCommittees(() => page([membership()]));
      const result = await runToolContract(ukparlGetCommittee, {
        mode: 'members',
        committeeId: '11',
        membership: membershipSelector,
      });
      expect(result.isError).not.toBe(true);
      const output = ukparlGetCommittee.output.parse(result.structuredContent);
      expect(output.items?.[0]).toMatchObject({ recordId: '71', memberId: '99' });
      expect(reconstruct(output.items![0]!)).toStrictEqual(membership());
      assertRendered(output, text(result));
      expect(result.structuredContent).toMatchObject({
        applied: {
          membershipStatus:
            membershipSelector === 'all'
              ? 'All'
              : membershipSelector === 'current'
                ? 'Current'
                : 'Former',
        },
      });
    },
  );

  it.each(['inquiries', 'publications'] as const)(
    'preserves every business/publication type in %s',
    async (mode) => {
      const raw = mode === 'inquiries' ? business() : publication();
      const requests = installCommittees(() => page([raw]));
      const input = {
        mode,
        committeeId: '11',
        query: 'work',
        ...(mode === 'publications' ? { businessId: '31' } : {}),
      };
      const result = await runToolContract(ukparlGetCommittee, input);
      const payload = ukparlGetCommittee.output.parse({
        ...((await retrieve(input, result)) as object),
        delivery: 'full',
      });
      expect(reconstruct(payload.items![0]!)).toStrictEqual(raw);
      expect(requests[0]!.searchParams.has('PublicationType')).toBe(false);
      expect(requests[0]!.searchParams.has('IsInquiry')).toBe(false);
    },
  );

  it('defaults membership to All and search omits absent filters', async () => {
    const requests = installCommittees(() => page([]));
    await runToolContract(ukparlGetCommittee, {});
    const members = await runToolContract(ukparlGetCommittee, {
      mode: 'members',
      committeeId: '11',
    });
    expect([...requests[0]!.searchParams]).toEqual([
      ['ShowOnWebsiteOnly', 'true'],
      ['Skip', '0'],
      ['Take', '10'],
    ]);
    expect(requests[1]!.searchParams.get('MembershipStatus')).toBe('All');
    expect(members.structuredContent).toMatchObject({
      filters: { membership: 'all' },
      applied: { membershipStatus: 'All' },
    });
  });

  it.each([
    { mode: 'detail' },
    { mode: 'members' },
    { mode: 'inquiry', committeeId: '11' },
    { mode: 'publication', businessId: '31' },
    { mode: 'search', committeeId: '11' },
    { mode: 'search', membership: 'current' },
    { mode: 'detail', committeeId: '11', limit: 1 },
    { mode: 'detail', committeeId: '11', cursor: 'x' },
    { mode: 'members', committeeId: '11', house: 'commons' },
    { mode: 'members', committeeId: '11', query: 'text' },
    { mode: 'inquiries', committeeId: '11', query: 'x' },
    { mode: 'publications', committeeId: '11', query: 'x' },
  ] as const)('rejects conflicting or incomplete branch input %j before I/O', async (input) => {
    const requests = installCommittees(() => page([]));
    const result = await runToolContract(ukparlGetCommittee, input);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        data: {
          reason: 'invalid_mode_arguments',
          recovery: { hint: expect.stringContaining('ukparl_get_committee') },
        },
      },
    });
    expect(text(result)).toContain('invalid_mode_arguments');
    expect(text(result)).toContain('fields documented for the selected mode');
    expect(requests).toHaveLength(0);
  });

  it.each([0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid limit %s before I/O',
    async (limit) => {
      const requests = installCommittees(() => page([]));
      const result = await runToolContract(ukparlGetCommittee, { limit });
      expect(result.isError).toBe(true);
      expect(requests).toHaveLength(0);
    },
  );

  it.each([
    { mode: 'detail', committeeId: '../11' },
    { mode: 'detail', committeeId: '11?ShowOnWebsiteOnly=false' },
    { mode: 'inquiry', businessId: 'https://example.test' },
    { house: 'unassigned' },
    { mode: 'members', committeeId: '11', membership: 'present' },
  ] as const)('rejects invalid source selector %j before I/O', async (input) => {
    const requests = installCommittees(() => page([]));
    const result = await runToolContract(ukparlGetCommittee, input);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams },
    });
    expect(requests).toHaveLength(0);
  });

  it.each([
    ['search', {}, 20],
    ['members', { committeeId: '11' }, 50],
  ] as const)(
    'clamps safe oversized %s limits with both-surface notices',
    async (mode, fields, cap) => {
      const requests = installCommittees(() => page([{ id: 1 }], 100));
      const result = await runToolContract(ukparlGetCommittee, {
        mode,
        ...fields,
        limit: Number.MAX_SAFE_INTEGER,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        requestedLimit: Number.MAX_SAFE_INTEGER,
        cap,
        shown: 1,
        truncated: true,
        total: 100,
        applied: { limit: cap, showOnWebsiteOnly: true },
      });
      expect(text(result)).toContain(`capped at ${cap}`);
      expect(requests[0]!.searchParams.get('Take')).toBe(String(cap));
    },
  );

  it.each([[], null])(
    'retains empty source state %j and recovery on both surfaces',
    async (items) => {
      installCommittees(() => page(items));
      const result = await runToolContract(ukparlGetCommittee, {});
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        items: [],
        sourcePage: { itemsState: items === null ? 'null' : 'present' },
        page: { returned: 0, total: 0, hasMore: false },
      });
      expect(text(result)).toContain('No website-visible records matched');
      expect(text(result)).toContain('mode=search');
    },
  );

  it.each([
    ['detail', { committeeId: '999' }],
    ['inquiry', { businessId: '999' }],
    ['publication', { publicationId: '999' }],
  ] as const)('renders missing %s as a successful guided miss', async (mode, fields) => {
    const requests = installCommittees(() => new Response(null, { status: 404 }));
    const result = await runToolContract(ukparlGetCommittee, { mode, ...fields });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ found: false });
    expect(result.structuredContent).not.toHaveProperty('record');
    expect(text(result)).toContain('discover the correct namespace ID');
    expect(requests).toHaveLength(1);
  });

  it('distinguishes a past-end collection from a missing collection endpoint', async () => {
    let missing = false;
    const requests = installCommittees((url) =>
      missing
        ? new Response(null, { status: 404 })
        : page(
            Number(url.searchParams.get('Skip')) === 0 ? [{ id: 11 }] : [],
            Number(url.searchParams.get('Skip')) === 0 ? 2 : 1,
          ),
    );
    const first = await runToolContract(ukparlGetCommittee, { limit: 1 });
    const cursor = ukparlGetCommittee.output.parse(first.structuredContent).page!.nextCursor!;
    const past = await runToolContract(ukparlGetCommittee, { limit: 1, cursor });
    expect(past.isError).not.toBe(true);
    expect(past.structuredContent).toMatchObject({
      items: [],
      page: { total: 1, returned: 0, hasMore: false },
    });
    expect(text(past)).toContain('No website-visible records matched');
    missing = true;
    expect((await runToolContract(ukparlGetCommittee, {})).isError).toBe(true);
    expect(requests).toHaveLength(3);
  });

  it('rejects strict, rebound and oversized-offset collection cursors before I/O', async () => {
    const requests = installCommittees(() => page([{ id: 11 }], 2));
    const first = await runToolContract(ukparlGetCommittee, { query: 'Synthetic', limit: 1 });
    const cursor = ukparlGetCommittee.output.parse(first.structuredContent).page!.nextCursor!;
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    const forged = (change: object) =>
      Buffer.from(JSON.stringify({ ...decoded, ...change })).toString('base64url');
    for (const input of [
      { query: 'Changed', limit: 1, cursor },
      { query: 'Synthetic', limit: 2, cursor },
      { cursor: 'malformed!' },
      { query: 'Synthetic', limit: 1, cursor: forged({ extra: 'field' }) },
      { query: 'Synthetic', limit: 1, cursor: forged({ v: 2 }) },
      { query: 'Synthetic', limit: 1, cursor: forged({ offset: 2147483648 }) },
    ]) {
      const result = await runToolContract(ukparlGetCommittee, input);
      expect(result.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_cursor' } },
      });
      expect(text(result)).toContain('same filters and no cursor or contentCursor');
    }
    expect(requests).toHaveLength(1);
  });

  it('advances whole records by emitted count across byte-limited pages without loss', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      id: 11 + index,
      name: `${index}: ${'文'.repeat(1000)}`,
    }));
    const requests = installCommittees((url) =>
      page(
        rows.slice(
          Number(url.searchParams.get('Skip')),
          Number(url.searchParams.get('Skip')) + Number(url.searchParams.get('Take')),
        ),
        5,
      ),
    );
    let cursor: string | undefined;
    const collected: unknown[] = [];
    do {
      const result = await runToolContract(ukparlGetCommittee, {
        limit: 5,
        ...(cursor ? { cursor } : {}),
      });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
      const output = ukparlGetCommittee.output.parse(result.structuredContent);
      expect(output.delivery).toBe('full');
      expect(requests.at(-1)!.searchParams.get('Skip')).toBe(String(collected.length));
      expect(output.items!.length).toBeGreaterThan(0);
      for (const item of output.items!) collected.push(reconstruct(item));
      assertRendered(output, text(result));
      cursor = output.page!.nextCursor;
    } while (cursor);
    expect(collected).toStrictEqual(rows);
    expect(requests.length).toBeGreaterThan(1);
  });

  it('reconstructs an oversized recursive entity graph and escaped Unicode scalar losslessly', async () => {
    const raw = {
      ...committeeDetail(),
      purpose: '<p>“quote” \\ \n``` 🏛️ 文</p>'.repeat(1000),
      contentLinks: Array.from({ length: 25 }, (_, index) => ({
        title: `Synthetic link ${index}`,
        url: `https://example.test/${index}`,
        displayOrder: index,
      })),
    };
    const requests = installCommittees(() => raw);
    const input = { mode: 'detail', committeeId: '11' } as const;
    const first = await runToolContract(ukparlGetCommittee, input);
    expect(ukparlGetCommittee.output.parse(first.structuredContent).delivery).toBe('outline');
    const decoded = ukparlGetCommittee.output.parse({
      ...((await retrieve(input, first)) as object),
      delivery: 'full',
    });
    expect(reconstruct(decoded.record!)).toStrictEqual(raw);
    expect(requests.length).toBeGreaterThan(10);
    expect(requests.every((url) => url.pathname === '/api/Committees/11')).toBe(true);
  });

  it('outlines only an indivisible first item and preserves the next collection cursor', async () => {
    const huge = { id: 11, name: '文🏛️'.repeat(6000) };
    installCommittees((url) =>
      page(Number(url.searchParams.get('Skip')) === 0 ? [huge, { id: 12 }] : [{ id: 12 }], 2),
    );
    const input = { limit: 2 };
    const first = await runToolContract(ukparlGetCommittee, input);
    const outline = ukparlGetCommittee.output.parse(first.structuredContent);
    expect(outline.collectionPage).toMatchObject({ returned: 1, total: 2, hasMore: true });
    const reconstructed = ukparlGetCommittee.output.parse({
      ...((await retrieve(input, first)) as object),
      delivery: 'full',
    });
    expect(reconstructed.items).toHaveLength(1);
    expect(reconstruct(reconstructed.items![0]!)).toStrictEqual(huge);
    const next = await runToolContract(ukparlGetCommittee, {
      limit: 2,
      cursor: outline.collectionPage!.nextCursor,
    });
    expect(
      ukparlGetCommittee.output.parse(next.structuredContent).items!.map((item) => item.recordId),
    ).toEqual(['12']);
  });

  it('renders content selection and changed-source recovery on both surfaces', async () => {
    let name = 'Original'.repeat(5000);
    installCommittees(() => ({ id: 11, name }));
    const input = { mode: 'detail', committeeId: '11' } as const;
    const first = await runToolContract(ukparlGetCommittee, input);
    const cursor = ukparlGetCommittee.output.parse(first.structuredContent).contentPage!
      .entries![0]!.contentCursor;
    const rebound = await runToolContract(ukparlGetCommittee, {
      ...input,
      committeeId: '12',
      contentCursor: cursor,
    });
    expect(rebound.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(rebound)).toContain('same filters and no cursor or contentCursor');
    name = 'Changed'.repeat(5000);
    const changed = await runToolContract(ukparlGetCommittee, { ...input, contentCursor: cursor });
    expect(changed.structuredContent).toMatchObject({
      error: { data: { reason: 'source_changed' } },
    });
    expect(text(changed)).toContain('original filters and no contentCursor');
  });

  it('rejects malformed, inherited, noncanonical and wrong-arm content paths on both surfaces', async () => {
    installCommittees(() => ({ id: 11, name: 'Oversized'.repeat(5000) }));
    const input = { mode: 'detail', committeeId: '11' } as const;
    const first = await runToolContract(ukparlGetCommittee, input);
    const cursor = ukparlGetCommittee.output.parse(first.structuredContent).contentPage!
      .entries![0]!.contentCursor;
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    const forged = (change: object) =>
      Buffer.from(JSON.stringify({ ...decoded, ...change })).toString('base64url');
    for (const contentCursor of [
      'malformed!',
      `${cursor}=`,
      forged({ unknown: true }),
      forged({ path: '/record/__proto__' }),
      forged({ path: '/record/entities/01' }),
      forged({ path: '/record/entities/99999' }),
      forged({ path: '/record/invalid~2escape' }),
      forged({ path: '/record/entities', arm: 'fragment' }),
    ]) {
      const result = await runToolContract(ukparlGetCommittee, { ...input, contentCursor });
      expect(result.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_cursor' } },
      });
      expect(text(result)).toContain('same filters and no cursor or contentCursor');
    }
  });

  it('rejects source page contradictions rather than rendering a complete empty match', async () => {
    for (const raw of [page([], 1), page([{ id: 1 }, { id: 2 }], 2)]) {
      const requests = installCommittees(() => raw);
      const result = await runToolContract(ukparlGetCommittee, { limit: 1 });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.ValidationError },
      });
      expect(requests).toHaveLength(1);
      disposeParliamentHttp();
    }
  });

  it('stops an in-flight exchange on caller cancellation without reporting no-match', async () => {
    const { initParliamentHttp } = await import(
      '@/services/parliament-http/parliament-http-service.js'
    );
    const { initCommittees } = await import('@/services/committees/committees-service.js');
    const entered = Promise.withResolvers<AbortSignal>();
    let exchanges = 0;
    initParliamentHttp({
      exchange: async (_url, _timeoutMs, _ctx, signal) => {
        exchanges++;
        entered.resolve(signal);
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
        throw new Error('Aborted exchange unexpectedly resumed.');
      },
    });
    initCommittees();
    const controller = new AbortController();
    const pending = runToolContract(
      ukparlGetCommittee,
      {},
      { context: { signal: controller.signal } },
    );
    const signal = await entered.promise;
    controller.abort(new DOMException('Synthetic caller stopped', 'AbortError'));
    const result = await pending;
    expect(signal.aborted).toBe(true);
    expect(exchanges).toBe(1);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.RequestCancelled, message: 'Synthetic caller stopped' },
    });
    expect(text(result)).toContain('Synthetic caller stopped');
  });

  it('renders actual origin queue saturation recovery on both surfaces', async () => {
    await withFullCommitteeQueue(async () => {
      const result = await runToolContract(ukparlGetCommittee, {});
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.RateLimited, data: { reason: 'queue_full' } },
      });
      expect(text(result)).toContain(
        'Wait briefly, then repeat ukparl_get_committee with the same selection.',
      );
    });
  });

  it.each([
    [400, 'http_invalid_params'],
    [401, 'http_unauthorized'],
    [403, 'http_forbidden'],
    [409, 'http_conflict'],
    [302, 'http_invalid_request'],
  ] as const)(
    'renders HTTP %s reason and declared recovery on both surfaces',
    async (status, reason) => {
      const requests = installCommittees(() => new Response('PRIVATE UPSTREAM BODY', { status }));
      const result = await runToolContract(ukparlGetCommittee, {});
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          data: { reason, recovery: { hint: expect.stringContaining('ukparl_get_committee') } },
        },
      });
      expect(text(result)).toContain(reason);
      expect(text(result)).toContain('ukparl_get_committee');
      expect(text(result)).not.toContain('PRIVATE UPSTREAM BODY');
      expect(requests).toHaveLength(1);
    },
  );

  it('retries a rate-limited exchange to exhaustion and renders its declared recovery', async () => {
    vi.useFakeTimers();
    const requests = installCommittees(
      () => new Response(null, { status: 429, headers: { 'Retry-After': '0' } }),
    );
    const pending = runToolContract(ukparlGetCommittee, {});
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(requests).toHaveLength(3);
    expect(result.structuredContent).toMatchObject({
      error: {
        data: {
          reason: 'http_rate_limited',
          recovery: { hint: expect.stringContaining('ukparl_get_committee') },
        },
      },
    });
    expect(text(result)).toContain('http_rate_limited');
    expect(text(result)).toContain('ukparl_get_committee');
  });

  it('rejects schema-invalid metadata and malformed JSON without no-match', async () => {
    for (const body of [
      Response.json({ id: 'bad' }),
      new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    ]) {
      const requests = installCommittees(() => body);
      const result = await runToolContract(ukparlGetCommittee, {
        mode: 'detail',
        committeeId: '11',
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).not.toHaveProperty('found');
      expect(requests).toHaveLength(1);
      disposeParliamentHttp();
    }
  });
});
