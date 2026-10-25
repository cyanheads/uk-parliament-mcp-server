/**
 * @fileoverview Bills discovery contracts across structured and formatted MCP consumption.
 * @module tests/tools/ukparl-search-bills.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ukparlSearchBills } from '@/mcp-server/tools/definitions/ukparl-search-bills.tool.js';
import { disposeBillsService } from '@/services/bills/bills-service.js';
import { digest, encodeCursor } from '@/services/parliament-http/parliament-cursors.js';
import { disposeParliamentHttp } from '@/services/parliament-http/parliament-http-service.js';
import { LICENCE_NOTICE } from '@/services/parliament-http/parliament-models.js';
import { bill, installBills, page, withFullBillsQueue } from '../services/bills/bills-fixtures.js';

function text(result: Awaited<ReturnType<typeof runToolContract>>) {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

afterEach(() => {
  disposeBillsService();
  disposeParliamentHttp();
});

describe('ukparl_search_bills', () => {
  it.each([{ items: [] }, { items: null }])(
    'rejects non-advancing empty Bills search pages $items before the advertised total',
    async ({ items }) => {
      const requests = installBills(() => page(items, 1));
      const result = await runToolContract(ukparlSearchBills, {});
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.ValidationError },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/page|pagination|total|remaining/i);
      expect(text(result)).not.toContain('No matches.');
      expect(requests).toHaveLength(1);
    },
  );

  it.each([{ items: [] }, { items: null }])(
    'accepts empty Bills search pages $items at the advertised total',
    async ({ items }) => {
      installBills(() => page(items, 1));
      const cursor = encodeCursor({
        v: 1,
        source: 'bills',
        selector: 'search',
        filters: digest({}),
        offset: 1,
        nativePageSize: 10,
      });
      const result = await runToolContract(ukparlSearchBills, { cursor });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        items: [],
        page: { returned: 0, total: 1, hasMore: false },
      });
      expect(ukparlSearchBills.output.parse(result.structuredContent).page).not.toHaveProperty(
        'nextCursor',
      );
      expect(text(result)).toContain('/page/hasMore\n```json\nfalse');
    },
  );

  it('normalizes aliases, blank forms and IDs without injecting session defaults', async () => {
    const requests = installBills(() => page([bill()]));
    const result = await runToolContract(ukparlSearchBills, {
      query: '  Synthetic  ',
      house: 'House of Lords',
      sessionId: '0035',
      memberId: '',
      cursor: '',
      contentCursor: '',
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      query: 'Synthetic',
      items: [
        {
          billId: '11',
          currentHouse: 'commons',
          includedSessionIds: ['34', '35'],
          currentStage: { house: 'unassigned', stageSittings: [{ id: '201' }, { id: '202' }] },
        },
      ],
      applied: {
        queryLocation: '/query',
        house: 'lords',
        sessionId: '35',
        source: 'bills',
        limit: 10,
      },
      notice: LICENCE_NOTICE,
    });
    expect([...requests[0]!.searchParams]).toEqual([
      ['SearchTerm', 'Synthetic'],
      ['CurrentHouse', 'Lords'],
      ['Session', '35'],
      ['Skip', '0'],
      ['Take', '10'],
    ]);
    for (const term of [
      'Synthetic',
      'unassigned',
      '/stageSittings/1/id',
      '202',
      LICENCE_NOTICE,
      'https://bills-api.parliament.uk/api/v1/Bills',
    ])
      expect(text(result)).toContain(term);
  });

  it('keeps omitted sparse fields absent and explicit nulls unknown on both surfaces', async () => {
    const requests = installBills(() => page([{ billId: 12, shortTitle: null, isAct: null }]));
    const result = await runToolContract(ukparlSearchBills, {});
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      items: [{ billId: '12', shortTitle: null, isAct: null }],
    });
    const output = ukparlSearchBills.output.parse(result.structuredContent);
    expect(output.items?.[0]).not.toHaveProperty('currentHouse');
    expect(text(result)).toContain('/items/0/isAct\n```json\nnull');
    expect(requests[0]?.searchParams.has('Session')).toBe(false);
  });

  it.each([[], null])(
    'renders a successful empty source collection %j with precise recovery',
    async (items) => {
      installBills(() => page(items));
      const result = await runToolContract(ukparlSearchBills, { query: 'No synthetic matches' });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        items: [],
        page: { returned: 0, total: 0, hasMore: false },
        totalCount: 0,
        notice: expect.stringContaining(
          'No matches. Repeat ukparl_search_bills with a broader query or fewer named filters.',
        ),
      });
      expect(text(result)).toContain('topic=bill_stages or topic=bill_types');
      expect(text(result)).toContain(LICENCE_NOTICE);
    },
  );

  it.each([1000, 1001, Number.MAX_SAFE_INTEGER])(
    'clamps safe read limit %s and composes licence/workload/continuation notices',
    async (limit) => {
      const requests = installBills(() => page([bill()], 100));
      const result = await runToolContract(ukparlSearchBills, { limit });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        requestedLimit: limit,
        applied: { limit: 20 },
        totalCount: 100,
        truncated: true,
        shown: 1,
        cap: 20,
        notice: expect.stringContaining(LICENCE_NOTICE),
      });
      expect(text(result)).toContain(`Requested limit ${limit} is capped at 20.`);
      expect(text(result)).toContain(LICENCE_NOTICE);
      expect(requests[0]?.searchParams.get('Take')).toBe('20');
    },
  );

  it.each([0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid limit %s before I/O',
    async (limit) => {
      const requests = installBills(() => page([]));
      const result = await runToolContract(ukparlSearchBills, { limit });
      expect(result.isError).toBe(true);
      expect(requests).toHaveLength(0);
    },
  );

  it('rejects unknown references with usable recovery on both surfaces', async () => {
    const requests = installBills(() => page([{ id: 7, name: 'Synthetic stage' }]));
    const result = await runToolContract(ukparlSearchBills, { stageIds: ['999'] });
    expect(result.structuredContent).toMatchObject({
      error: {
        data: {
          reason: 'unknown_reference_id',
          recovery: {
            hint: 'Call ukparl_lookup_reference for the matching filter topic and use an ID from its results.',
          },
        },
      },
    });
    expect(text(result)).toContain('unknown_reference_id');
    expect(text(result)).toContain('ukparl_lookup_reference');
    expect(requests.map((url) => url.pathname)).toEqual(['/api/v1/Stages']);
  });

  it('renders real origin queue saturation with same-tool recovery on both surfaces', async () => {
    await withFullBillsQueue(async () => {
      const result = await runToolContract(ukparlSearchBills, {});
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: { data: { reason: 'queue_full' } } });
      expect(text(result)).toContain(
        'Wait briefly, then repeat ukparl_search_bills with the same filters.',
      );
    });
  });

  it('renders content revision and selection recovery on both surfaces', async () => {
    let title = 'Synthetic old revision'.repeat(2000);
    installBills(() => page([bill(11, title)]));
    const first = await runToolContract(ukparlSearchBills, { query: 'Synthetic' });
    const cursor = ukparlSearchBills.output.parse(first.structuredContent).contentPage!.entries![0]!
      .contentCursor;
    const rebound = await runToolContract(ukparlSearchBills, {
      query: 'Different',
      contentCursor: cursor,
    });
    expect(rebound.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(rebound)).toContain('same filters and no cursor or contentCursor');
    title = 'Synthetic changed revision'.repeat(2000);
    const changed = await runToolContract(ukparlSearchBills, {
      query: 'Synthetic',
      contentCursor: cursor,
    });
    expect(changed.structuredContent).toMatchObject({
      error: { data: { reason: 'source_changed' } },
    });
    expect(text(changed)).toContain('original filters and no contentCursor');
  });

  it('rejects malformed and filter-rebound collection cursors on both surfaces', async () => {
    const requests = installBills(() => page([bill()], 2));
    const first = await runToolContract(ukparlSearchBills, { query: 'Synthetic', limit: 1 });
    const cursor = ukparlSearchBills.output.parse(first.structuredContent).page!.nextCursor!;
    for (const input of [{ query: 'Changed', limit: 1, cursor }, { cursor: 'malformed!' }]) {
      const result = await runToolContract(ukparlSearchBills, input);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_cursor' } },
      });
      expect(text(result)).toContain('same filters and no cursor or contentCursor');
    }
    expect(requests).toHaveLength(1);
  });

  it('advances byte-limited whole items by the actual emitted count without skipping rows', async () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      bill(11 + index, `${index}: ${'文'.repeat(1400)}`),
    );
    const requests = installBills((url) =>
      page(
        rows.slice(
          Number(url.searchParams.get('Skip')),
          Number(url.searchParams.get('Skip')) + Number(url.searchParams.get('Take')),
        ),
        rows.length,
      ),
    );
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await runToolContract(ukparlSearchBills, {
        limit: 5,
        ...(cursor ? { cursor } : {}),
      });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
      const output = ukparlSearchBills.output.parse(result.structuredContent);
      expect(requests.at(-1)?.searchParams.get('Skip')).toBe(String(ids.length));
      expect(output.delivery).toBe('full');
      expect(output.items!.length).toBeLessThan(5);
      expect(output.items!.length).toBeGreaterThan(0);
      expect(result.structuredContent).toMatchObject({
        ...(output.page!.hasMore ? { shown: output.items!.length, truncated: true } : {}),
        notice: expect.stringContaining(LICENCE_NOTICE),
      });
      for (const item of output.items!) {
        ids.push(item.billId);
        expect(text(result)).toContain(JSON.stringify(item.shortTitle));
      }
      cursor = output.page!.nextCursor;
    } while (cursor);
    expect(ids).toEqual(['11', '12', '13', '14', '15']);
    expect(requests.length).toBeGreaterThan(1);
  });
});
