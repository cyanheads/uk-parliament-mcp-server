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
import { renderedPayload, text } from './rendered-payload.js';

afterEach(() => {
  disposeBillsService();
  disposeParliamentHttp();
});

describe('ukparl_search_bills', () => {
  it('pages the filtered search total and keeps an explicit past-end result and capped request', async () => {
    const rows = [bill(11), bill(12), bill(13)];
    const requests = installBills((url) =>
      page(
        rows.slice(
          Number(url.searchParams.get('Skip')),
          Number(url.searchParams.get('Skip')) + Number(url.searchParams.get('Take')),
        ),
        3,
      ),
    );
    const selection = {
      departmentId: '50',
      originatingHouse: 'commons',
      sortOrder: 'TitleDescending',
      inAmendableStage: false,
      limit: 2,
    };
    const first = await runToolContract(ukparlSearchBills, selection);
    const output = ukparlSearchBills.output.parse(first.structuredContent);
    const last = await runToolContract(ukparlSearchBills, {
      ...selection,
      cursor: output.page!.nextCursor!,
    });
    expect(last.structuredContent).toMatchObject({
      items: [{ billId: '13' }],
      page: { returned: 1, total: 3, hasMore: false },
    });
    expect(text(last)).toContain('13');
    // inAmendableStage=false selects the same bills as omission, so it is not part of the binding.
    const cursor = encodeCursor({
      v: 1,
      source: 'bills',
      selector: 'search',
      filters: digest({
        departmentId: '50',
        originatingHouse: 'commons',
        sortOrder: 'TitleDescending',
      }),
      offset: 99,
      nativePageSize: 2,
    });
    const empty = await runToolContract(ukparlSearchBills, { ...selection, cursor });
    expect(empty.structuredContent).toMatchObject({
      items: [],
      page: { returned: 0, total: 3, hasMore: false },
    });
    expect(renderedPayload(text(empty))).toMatchObject({ page: { hasMore: false } });
    const capped = await runToolContract(ukparlSearchBills, { ...selection, limit: 500 });
    expect(capped.structuredContent).toMatchObject({
      applied: { limit: 100 },
      requestedLimit: 500,
    });
    expect(requests.at(-1)!.searchParams.get('Take')).toBe('100');
    expect(
      requests.every(
        (url) =>
          url.searchParams.get('DepartmentId') === '50' &&
          !url.searchParams.has('IsInAmendableStage'),
      ),
    ).toBe(true);
  });
  it.each([
    { departmentId: '50' },
    { sortOrder: 'TitleDescending' },
    { originatingHouse: 'Commons' },
    { isDefeated: false },
    { isWithdrawn: false },
    { inAmendableStage: true },
  ])('binds both continuations to new selection %j', async (changed) => {
    let title = 'Synthetic title';
    const requests = installBills(() => page([bill(11, title)], 2));
    const first = await runToolContract(ukparlSearchBills, { limit: 1 });
    const output = ukparlSearchBills.output.parse(first.structuredContent);
    const cursor = output.page!.nextCursor!;
    title = 'Full title '.repeat(5000);
    const oversized = await runToolContract(ukparlSearchBills, { limit: 1 });
    const contentCursor = ukparlSearchBills.output.parse(oversized.structuredContent).contentPage!
      .entries![0]!.contentCursor;
    const before = requests.length;
    const rebound = await runToolContract(ukparlSearchBills, { limit: 1, ...changed, cursor });
    expect(rebound.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(rebound)).toContain('same filters and no cursor or contentCursor');
    expect(requests).toHaveLength(before);
    const content = await runToolContract(ukparlSearchBills, {
      limit: 1,
      ...changed,
      contentCursor,
    });
    expect(content.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(content)).toContain('same filters and no cursor or contentCursor');
  });

  it('treats inAmendableStage=false as omission for the query, applied filters and both continuations', async () => {
    let title = 'Synthetic title';
    const requests = installBills((url) =>
      page([bill(11 + Number(url.searchParams.get('Skip')), title)], 3),
    );
    const omitted = await runToolContract(ukparlSearchBills, { limit: 1 });
    const unrestricted = await runToolContract(ukparlSearchBills, {
      limit: 1,
      inAmendableStage: false,
    });
    const wire = (result: typeof omitted) =>
      JSON.parse(JSON.stringify(result.structuredContent)) as Record<string, unknown>;
    expect(wire(unrestricted).applied).toEqual(wire(omitted).applied);
    expect(wire(unrestricted).applied).not.toHaveProperty('inAmendableStage');
    expect(renderedPayload(text(unrestricted)).applied).not.toHaveProperty('inAmendableStage');
    expect(requests[1]!.href).toBe(requests[0]!.href);
    expect(requests[1]!.searchParams.has('IsInAmendableStage')).toBe(false);
    const fromFalse = ukparlSearchBills.output.parse(unrestricted.structuredContent).page!
      .nextCursor!;
    const fromOmitted = ukparlSearchBills.output.parse(omitted.structuredContent).page!.nextCursor!;
    for (const [input, cursor] of [
      [{}, fromFalse],
      [{ inAmendableStage: false }, fromOmitted],
    ] as const) {
      const next = await runToolContract(ukparlSearchBills, { limit: 1, ...input, cursor });
      expect(next.structuredContent).toMatchObject({ items: [{ billId: '12' }] });
      expect(requests.at(-1)!.searchParams.get('Skip')).toBe('1');
    }
    title = 'Full title '.repeat(5000);
    const oversized = await runToolContract(ukparlSearchBills, { limit: 1 });
    const contentCursor = ukparlSearchBills.output.parse(oversized.structuredContent).contentPage!
      .entries![0]!.contentCursor;
    const content = await runToolContract(ukparlSearchBills, {
      limit: 1,
      inAmendableStage: false,
      contentCursor,
    });
    expect(content.isError).not.toBe(true);
    expect(ukparlSearchBills.output.parse(content.structuredContent).delivery).not.toBe('full');
  });

  it.each(['TitleAscending', 'TitleDescending', 'DateUpdatedAscending', 'DateUpdatedDescending'])(
    'supports official order %s and blank optional selectors',
    async (sortOrder) => {
      const requests = installBills(() => page([]));
      const result = await runToolContract(ukparlSearchBills, {
        sortOrder,
        departmentId: ' ',
        originatingHouse: '',
        isDefeated: '',
        isWithdrawn: '',
        inAmendableStage: '',
      });
      expect(result.structuredContent).toMatchObject({
        items: [],
        applied: { sortOrder },
        page: { total: 0, hasMore: false },
      });
      expect(requests[0]!.searchParams.get('SortOrder')).toBe(sortOrder);
      expect(requests[0]!.searchParams.has('DepartmentId')).toBe(false);
      expect(requests[0]!.searchParams.has('OriginatingHouse')).toBe(false);
      expect(requests[0]!.searchParams.has('IsDefeated')).toBe(false);
      expect(requests[0]!.searchParams.has('IsWithdrawn')).toBe(false);
      expect(requests[0]!.searchParams.has('IsInAmendableStage')).toBe(false);
      expect(text(result)).toContain(sortOrder);
    },
  );

  it.each([
    { departmentId: '0' },
    { sortOrder: 'Newest' },
    { originatingHouse: 'All' },
    { isWithdrawn: 'maybe' },
    { isDefeated: 'maybe' },
    { inAmendableStage: 'maybe' },
  ])('rejects invalid direct filters %j before I/O', async (input) => {
    const requests = installBills(() => page([]));
    const result = await runToolContract(ukparlSearchBills, input);
    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });
  it.each([true, false])(
    'forwards direct search filters, including boolean %s, on both surfaces',
    async (flag) => {
      const requests = installBills(() => page([bill()], 2));
      const result = await runToolContract(ukparlSearchBills, {
        departmentId: '0050',
        sortOrder: 'DateUpdatedDescending',
        originatingHouse: 'House of Lords',
        isDefeated: flag,
        isWithdrawn: flag,
        inAmendableStage: flag,
        limit: 1,
      });
      expect(result.isError).not.toBe(true);
      const applied = {
        departmentId: '50',
        sortOrder: 'DateUpdatedDescending',
        originatingHouse: 'lords',
        isDefeated: flag,
        isWithdrawn: flag,
        ...(flag ? { inAmendableStage: true } : {}),
      };
      expect(result.structuredContent).toMatchObject({
        applied,
        page: { total: 2, returned: 1, hasMore: true },
      });
      expect(renderedPayload(text(result))).toMatchObject({ applied });
      if (!flag) {
        const wire = JSON.parse(JSON.stringify(result.structuredContent)) as { applied: object };
        expect(wire.applied).not.toHaveProperty('inAmendableStage');
        expect(renderedPayload(text(result)).applied).not.toHaveProperty('inAmendableStage');
      }
      expect([...requests[0]!.searchParams]).toEqual([
        ['DepartmentId', '50'],
        ['SortOrder', 'DateUpdatedDescending'],
        ['OriginatingHouse', 'Lords'],
        ['IsDefeated', String(flag)],
        ['IsWithdrawn', String(flag)],
        ...(flag ? [['IsInAmendableStage', 'true']] : []),
        ['Skip', '0'],
        ['Take', '1'],
      ]);
    },
  );
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
      expect(renderedPayload(text(result))).toMatchObject({ page: { hasMore: false } });
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
      'stageSittings',
      '202',
      LICENCE_NOTICE,
      'https://bills-api.parliament.uk/api/v1/Bills',
    ])
      expect(text(result)).toContain(term);
    expect(renderedPayload(text(result))).toMatchObject({
      items: [{ currentStage: { stageSittings: [{ id: '201' }, { id: '202' }] } }],
    });
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
    expect(renderedPayload(text(result))).toMatchObject({ items: [{ isAct: null }] });
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

  it.each([101, 1000, Number.MAX_SAFE_INTEGER])(
    'clamps safe read limit %s to 100 and composes licence/workload/continuation notices',
    async (limit) => {
      const requests = installBills(() => page([bill()], 1000));
      const result = await runToolContract(ukparlSearchBills, { limit });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        requestedLimit: limit,
        applied: { limit: 100 },
        totalCount: 1000,
        truncated: true,
        shown: 1,
        cap: 100,
        notice: expect.stringContaining(LICENCE_NOTICE),
      });
      expect(text(result)).toContain(`Requested limit ${limit} is capped at 100.`);
      expect(text(result)).toContain(LICENCE_NOTICE);
      expect(requests[0]?.searchParams.get('Take')).toBe('100');
    },
  );

  it.each([
    [undefined, 10],
    [1, 1],
    [100, 100],
  ])(
    'serves limit %s as %s whole bills and reports the 100 ceiling as cap without a clamp notice',
    async (limit, effective) => {
      const rows = Array.from({ length: 150 }, (_, index) => bill(11 + index));
      const requests = installBills((url) =>
        page(
          rows.slice(
            Number(url.searchParams.get('Skip')),
            Number(url.searchParams.get('Skip')) + Number(url.searchParams.get('Take')),
          ),
          rows.length,
        ),
      );
      const result = await runToolContract(ukparlSearchBills, limit === undefined ? {} : { limit });
      const output = ukparlSearchBills.output.parse(result.structuredContent);
      expect(requests[0]!.searchParams.get('Take')).toBe(String(effective));
      expect(output.delivery).toBe('full');
      expect(output.items).toHaveLength(effective);
      expect(result.structuredContent).toMatchObject({
        applied: { limit: effective },
        truncated: true,
        shown: effective,
        cap: 100,
      });
      expect(result.structuredContent).not.toHaveProperty('requestedLimit');
      expect(text(result)).not.toContain('is capped at');
    },
  );

  it('carries search provenance once at payload level, including empty and outlined pages', async () => {
    let title = 'Synthetic title';
    const requests = installBills((url) =>
      url.searchParams.has('SearchTerm') ? page([]) : page([bill(11, title), bill(12)]),
    );
    for (const input of [{}, { query: 'No synthetic matches' }]) {
      const result = await runToolContract(ukparlSearchBills, input);
      const output = ukparlSearchBills.output.parse(result.structuredContent);
      expect(output.source).toMatchObject({
        api: 'bills',
        url: requests.at(-1)!.href,
        retrievedAt: expect.any(String),
        licenceUrl: expect.any(String),
      });
      for (const item of output.items!) expect(item).not.toHaveProperty('source');
      expect(JSON.stringify(result.structuredContent).split('"licenceUrl"')).toHaveLength(2);
      expect(renderedPayload(text(result))).toMatchObject({
        source: { url: requests.at(-1)!.href },
      });
    }
    title = 'Full title '.repeat(5000);
    const outlined = ukparlSearchBills.output.parse(
      (await runToolContract(ukparlSearchBills, {})).structuredContent,
    );
    expect(outlined.delivery).toBe('outline');
    expect(outlined.provenance).toMatchObject({ api: 'bills', url: requests.at(-1)!.href });
  });

  it('documents the 100 page-size ceiling and the inAmendableStage omission rule', () => {
    expect(ukparlSearchBills.enrichment?.cap.description).toMatch(/ceiling/i);
    expect(ukparlSearchBills.enrichment?.cap.description).not.toMatch(/effective/i);
    expect(ukparlSearchBills.input.shape.limit.description).toMatch(/default 10, cap 100/);
    expect(ukparlSearchBills.input.shape.inAmendableStage.description).toMatch(
      /false equals omission/,
    );
    expect(ukparlSearchBills.output.shape.source.description).toMatch(/empty pages/);
  });

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

  it('renders an upstream 5xx and declares the call deadline with same-tool recovery', async () => {
    installBills(() => new Response('', { status: 501 }));
    const result = await runToolContract(ukparlSearchBills, {});
    const hint = ukparlSearchBills.errors?.find(
      (entry) => entry.reason === 'http_server_error',
    )?.recovery;
    expect(hint).toContain('ukparl_search_bills');
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: { reason: 'http_server_error', recovery: { hint } },
      },
    });
    expect(text(result)).toContain('http_server_error');
    expect(text(result)).toContain(hint);
    expect(ukparlSearchBills.errors).toContainEqual(
      expect.objectContaining({
        reason: 'call_deadline_exceeded',
        code: JsonRpcErrorCode.Timeout,
        thrownBy: 'service',
        recovery: expect.stringContaining('ukparl_search_bills'),
      }),
    );
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
    expect(text(changed)).toContain(
      'original filters and any collection cursor, but no contentCursor',
    );
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

  it.each([
    [2, [2, 2, 1]],
    [5, [5]],
  ])(
    'pages limit %s whole items past 24,000 reply bytes by emitted count without skipping rows',
    async (limit, sizes) => {
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
      const pages: number[] = [];
      let cursor: string | undefined;
      do {
        const result = await runToolContract(ukparlSearchBills, {
          limit,
          ...(cursor ? { cursor } : {}),
        });
        expect(result.isError).not.toBe(true);
        const output = ukparlSearchBills.output.parse(result.structuredContent);
        expect(requests.at(-1)?.searchParams.get('Skip')).toBe(String(ids.length));
        expect(output.delivery).toBe('full');
        expect(result.structuredContent).toMatchObject({
          ...(output.page!.hasMore
            ? { shown: output.items!.length, truncated: true, cap: 100 }
            : {}),
          notice: expect.stringContaining(LICENCE_NOTICE),
        });
        pages.push(output.items!.length);
        for (const item of output.items!) {
          ids.push(item.billId);
          expect(text(result)).toContain(JSON.stringify(item.shortTitle));
        }
        if (output.items!.length === 5)
          expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(24_000);
        cursor = output.page!.nextCursor;
      } while (cursor);
      expect(pages).toEqual(sizes);
      expect(ids).toEqual(['11', '12', '13', '14', '15']);
    },
  );
});
