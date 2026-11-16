/**
 * @fileoverview Spoken Hansard contracts, limit-sized paging and lossless content retrieval.
 * @module tests/tools/ukparl-search-hansard.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ukparlSearchHansard } from '@/mcp-server/tools/definitions/ukparl-search-hansard.tool.js';
import { HansardItemSchema } from '@/services/hansard/hansard-schemas.js';
import { initHansardService } from '@/services/hansard/hansard-service.js';
import {
  advanceCollectionCursor,
  readCollectionCursor,
} from '@/services/parliament-http/parliament-cursors.js';
import {
  disposeParliamentHttp,
  initParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import { contribution, installHansard, spoken } from '../services/hansard/hansard-fixtures.js';
import { renderedPayload, text } from './rendered-payload.js';

type Result = Awaited<ReturnType<typeof runToolContract>>;
type Output = ReturnType<typeof ukparlSearchHansard.output.parse>;
function output(result: Result): Output {
  expect(result.isError).not.toBe(true);
  const value = ukparlSearchHansard.output.parse(result.structuredContent);
  // Full pages are sized by limit; outline and fragment replies keep fitting the content budget.
  if (value.delivery !== 'full')
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24_000);
  expect(renderedPayload(text(result))).toEqual(result.structuredContent);
  return value;
}
/** Serve a consistent synthetic collection by the requested skip/take window. */
function windowed(rows: unknown[]) {
  return (url: URL) => {
    const skip = Number(url.searchParams.get('queryParameters.skip'));
    const take = Number(url.searchParams.get('queryParameters.take'));
    return spoken(rows.slice(skip, skip + take), rows.length);
  };
}
/** `hint`, when given, is the tool's own declared recovery, which no throw-site hint may replace. */
function error(result: Result, reason: string, hint?: string) {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    error: { data: { reason, recovery: { hint: hint ?? expect.any(String) } } },
  });
  const structured = result.structuredContent as {
    error: { data: { recovery: { hint: string } } };
  };
  expect(text(result)).toContain(reason);
  expect(text(result)).toContain(structured.error.data.recovery.hint);
}

/** Public continuation consumer, independent of production delivery helpers. */
async function reconstruct(input: Record<string, unknown>, first?: Output): Promise<unknown> {
  let value = first ?? output(await runToolContract(ukparlSearchHansard, input));
  if (value.delivery === 'full') return value;
  let page = value.contentPage!;
  if (page.fragment !== undefined) {
    let encoded = page.fragment;
    while (page.hasMore) {
      value = output(
        await runToolContract(ukparlSearchHansard, { ...input, contentCursor: page.nextCursor }),
      );
      page = value.contentPage!;
      expect(page.offset).toBe(encoded.length);
      expect(page.fragment!.length).toBeGreaterThan(0);
      expect(/[\uD800-\uDBFF]$/.test(page.fragment!)).toBe(false);
      encoded += page.fragment;
    }
    expect(encoded.length).toBe(page.totalCodeUnits);
    return JSON.parse(encoded);
  }
  const restored: Record<string, unknown> | unknown[] = page.kind === 'array' ? [] : {};
  for (;;) {
    expect(page.entries!.length).toBeGreaterThan(0);
    for (const entry of page.entries!) {
      const key = entry.path.split('/').at(-1)!.replaceAll('~1', '/').replaceAll('~0', '~');
      Object.defineProperty(restored, key, {
        value: await reconstruct({ ...input, contentCursor: entry.contentCursor }),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (!page.hasMore) break;
    value = output(
      await runToolContract(ukparlSearchHansard, { ...input, contentCursor: page.nextCursor }),
    );
    page = value.contentPage!;
  }
  return restored;
}

afterEach(() => {
  disposeParliamentHttp();
  vi.useRealTimers();
});
describe('ukparl_search_hansard', () => {
  it.each(['startDate', 'endDate'])('advertises the YYYY-MM-DD pattern for %s', (field) => {
    const schema = z.toJSONSchema(ukparlSearchHansard.input, {
      io: 'input',
      target: 'draft-2020-12',
    });
    expect(schema.properties?.[field]).toMatchObject({
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    });
  });

  it.each(['startDate', 'endDate'])(
    'rejects syntactically invalid %s in input validation before I/O',
    async (field) => {
      const requests = installHansard(() => spoken([]));
      const result = await runToolContract(ukparlSearchHansard, { [field]: '2026-1-01' });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams, data: { issues: expect.any(Array) } },
      });
      expect(text(result)).toContain(field);
      expect(requests).toEqual([]);
    },
  );
  it.each([-1, -2, -2147483648, '-1', '-27', 0, '0'])(
    'preserves source speaker sentinel %j without exposing a Members join on either surface',
    async (MemberId) => {
      installHansard(() => spoken([{ ...contribution(), MemberId }], 2));
      const result = await runToolContract(ukparlSearchHansard, {
        startDate: '1803-11-22',
        endDate: '1803-11-22',
        limit: 1,
      });
      const value = output(result);
      expect(value.items![0]).toMatchObject({
        memberId: null,
        sourceMemberId: String(MemberId),
        memberName: 'Synthetic speaker',
        attributedTo: '  Attribution  ',
        text: ' <p>Complete 1 &amp; source\n"文🏛️"</p> ',
        preview: 'Preview only…',
      });
      expect(value.page).toMatchObject({
        returned: 1,
        total: 2,
        hasMore: true,
        nextCursor: expect.any(String),
      });
      expect(text(result)).toContain('sourceMemberId');
    },
  );

  it.each([42, '42', null, undefined])(
    'keeps nonsentinel speaker identity %j distinct without duplicate metadata',
    async (MemberId) => {
      installHansard(() => spoken([{ ...contribution(), MemberId }]));
      const value = output(await runToolContract(ukparlSearchHansard, {}));
      expect(value.items![0]!.memberId).toBe(MemberId == null ? MemberId : '42');
      expect(value.items![0]).not.toHaveProperty('sourceMemberId');
    },
  );

  it.each([
    { ItemId: -1 },
    { DebateSectionId: -1 },
    { ItemId: '-1' },
    { DebateSectionId: '-1' },
    { MemberId: -1.5 },
    { MemberId: Number.MIN_SAFE_INTEGER - 1 },
  ])(
    'rejects malformed source identifiers %j without widening other namespaces',
    async (changes) => {
      installHansard(() => spoken([{ ...contribution(), ...changes }]));
      const result = await runToolContract(ukparlSearchHansard, {});
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.ValidationError },
      });
      expect(text(result)).toContain('Parliament JSON did not match');
    },
  );

  it.each([
    { memberId: '-1' },
    { memberId: '0' },
    { debateSectionId: '-1' },
    { debateSectionId: '0' },
  ])('rejects nonpositive input joins %j before network I/O', async (input) => {
    const requests = installHansard(() => spoken([]));
    const result = await runToolContract(ukparlSearchHansard, input);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams },
    });
    expect(requests).toEqual([]);
  });
  it.each(['House of Commons', ' LORDS '])(
    'uses the exact Spoken route and query allowlist for %s',
    async (house) => {
      const requests = installHansard(() => spoken([contribution()]));
      const result = output(
        await runToolContract(ukparlSearchHansard, {
          query: ' Synthetic ',
          memberId: '0042',
          house,
          startDate: '2005-01-01',
          endDate: '2005-01-31',
          debateSectionId: '00123',
          limit: 2,
        }),
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]!.origin).toBe('https://hansard-api.parliament.uk');
      expect(requests[0]!.pathname).toBe('/search/contributions/Spoken.json');
      expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({
        'queryParameters.searchTerm': 'Synthetic',
        'queryParameters.memberId': '42',
        'queryParameters.house': house === 'House of Commons' ? 'Commons' : 'Lords',
        'queryParameters.startDate': '2005-01-01',
        'queryParameters.endDate': '2005-01-31',
        'queryParameters.debateSectionId': '123',
        'queryParameters.skip': '0',
        'queryParameters.take': '2',
        'queryParameters.outputType': 'List',
      });
      expect(result.items![0]!.text).toBe(contribution().ContributionTextFull);
      expect(result.items![0]!.attributedTo).toBe('  Attribution  ');
      const id = result.items![0]!.debateSectionId;
      output(await runToolContract(ukparlSearchHansard, { debateSectionId: id }));
      expect(requests[1]!.searchParams.get('queryParameters.debateSectionId')).toBe('123');
    },
  );

  it.each(['SittingDateAsc', 'SittingDateDesc'] as const)(
    'sends sortOrder %s as queryParameters.orderBy beside every filter and echoes it on both surfaces',
    async (sortOrder) => {
      const requests = installHansard(() => spoken([contribution()]));
      const result = await runToolContract(ukparlSearchHansard, {
        query: 'Synthetic',
        memberId: '42',
        house: 'commons',
        startDate: '2005-01-01',
        endDate: '2005-01-31',
        debateSectionId: '123',
        sortOrder,
      });
      output(result);
      expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({
        'queryParameters.searchTerm': 'Synthetic',
        'queryParameters.memberId': '42',
        'queryParameters.house': 'Commons',
        'queryParameters.startDate': '2005-01-01',
        'queryParameters.endDate': '2005-01-31',
        'queryParameters.debateSectionId': '123',
        'queryParameters.orderBy': sortOrder,
        'queryParameters.skip': '0',
        'queryParameters.take': '5',
        'queryParameters.outputType': 'List',
      });
      expect(result.structuredContent).toMatchObject({ applied: { sortOrder } });
      expect(renderedPayload(text(result))).toMatchObject({ applied: { sortOrder } });
    },
  );

  it('sends no orderBy and echoes no sortOrder when sortOrder is omitted or blank', async () => {
    const requests = installHansard(() => spoken([contribution()]));
    for (const input of [{}, { sortOrder: '' }]) {
      const result = await runToolContract(ukparlSearchHansard, input);
      output(result);
      expect(requests.at(-1)!.searchParams.has('queryParameters.orderBy')).toBe(false);
      const wire = JSON.parse(JSON.stringify(result.structuredContent)) as { applied: object };
      expect(wire.applied).not.toHaveProperty('sortOrder');
      expect(renderedPayload(text(result)).applied).not.toHaveProperty('sortOrder');
    }
  });

  it.each(['Relevance', 'sittingdateasc', 'SittingDate'])(
    'rejects unknown sortOrder %s before I/O',
    async (sortOrder) => {
      const requests = installHansard(() => spoken([]));
      const result = await runToolContract(ukparlSearchHansard, { sortOrder });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams },
      });
      expect(text(result)).toContain('sortOrder');
      expect(text(result)).toContain('SittingDateAsc');
      expect(requests).toEqual([]);
    },
  );

  it('carries request provenance once at payload level, including empty pages', async () => {
    const requests = installHansard((url) =>
      spoken(
        url.searchParams.has('queryParameters.searchTerm') ? [] : [contribution(), contribution(2)],
      ),
    );
    for (const input of [{}, { query: 'nothing' }]) {
      const result = await runToolContract(ukparlSearchHansard, input);
      const value = output(result);
      expect(value.source).toMatchObject({
        api: 'hansard',
        url: requests.at(-1)!.href,
        retrievedAt: expect.any(String),
        licenceUrl: expect.any(String),
      });
      for (const item of value.items!) expect(item).not.toHaveProperty('source');
      expect(JSON.stringify(result.structuredContent).split('"licenceUrl"')).toHaveLength(2);
      expect(text(result)).toContain(requests.at(-1)!.href);
    }
  });

  it('documents the page-size ceiling, limit-free cursors and sitting-date order', () => {
    const schema = z.toJSONSchema(ukparlSearchHansard.input, {
      io: 'input',
      target: 'draft-2020-12',
    });
    expect(schema.properties?.sortOrder).toMatchObject({
      enum: ['SittingDateAsc', 'SittingDateDesc'],
    });
    expect(ukparlSearchHansard.enrichment?.cap.description).toMatch(/ceiling/i);
    expect(ukparlSearchHansard.enrichment?.cap.description).not.toMatch(/effective/i);
    expect(ukparlSearchHansard.input.shape.cursor.description).not.toMatch(/effective limit/i);
    expect(ukparlSearchHansard.input.shape.limit.description).toMatch(/default 5, cap 100/);
    expect(ukparlSearchHansard.description).toMatch(/newest sitting first/);
  });

  it.each([
    [undefined, 5, undefined],
    [100, 100, undefined],
    [101, 100, 101],
    [500, 100, 500],
    [Number.MAX_SAFE_INTEGER, 100, Number.MAX_SAFE_INTEGER],
  ])(
    'serves limit %s as %s whole contributions, never requests above 100 and reports the 100 ceiling',
    async (limit, effective, requestedLimit) => {
      const rows = Array.from({ length: 150 }, (_, index) => contribution(index + 1));
      const requests = installHansard(windowed(rows));
      const result = await runToolContract(
        ukparlSearchHansard,
        limit === undefined ? {} : { limit },
      );
      const value = output(result);
      expect(requests[0]!.searchParams.get('queryParameters.take')).toBe(String(effective));
      expect(value.delivery).toBe('full');
      expect(value.items).toHaveLength(effective);
      expect(value.page).toMatchObject({ returned: effective, total: 150, hasMore: true });
      expect(result.structuredContent).toMatchObject({
        applied: { limit: effective },
        truncated: true,
        shown: effective,
        cap: 100,
      });
      if (requestedLimit === undefined) {
        expect(result.structuredContent).not.toHaveProperty('requestedLimit');
        expect(text(result)).not.toContain('is capped at');
      } else {
        expect(result.structuredContent).toMatchObject({ requestedLimit });
        expect(text(result)).toContain(`Requested limit ${requestedLimit} is capped at 100.`);
      }
    },
  );

  it('labels official permalink URLs as API JSON resolvers rather than browser destinations', async () => {
    installHansard(() => spoken([contribution()]));
    const value = output(await runToolContract(ukparlSearchHansard, {}));
    expect(value.items![0]!.contributionUrl).toBe(
      'https://hansard-api.parliament.uk/search/parlisearchredirect.json?externalId=external-1',
    );
    expect(value.items![0]!.debateUrl).toBe(
      'https://hansard-api.parliament.uk/search/parlisearchredirect.json?externalId=debate%2Fexternal',
    );
    expect(HansardItemSchema.shape.contributionUrl.description).toMatch(/resolver.*JSON/);
    expect(HansardItemSchema.shape.debateUrl.description).toMatch(/resolver.*JSON/);
  });

  it.each([
    {},
    { startDate: '1700-01-01', endDate: '1804-01-01' },
    { startDate: '2003-01-01', endDate: '2007-01-01' },
  ])(
    'keeps archive facts distinct from API minimum and sends dates unchanged: %j',
    async (dates) => {
      const requests = installHansard(() => spoken([contribution()]));
      const result = await runToolContract(ukparlSearchHansard, dates);
      output(result);
      expect(result.structuredContent).toMatchObject({
        coverage: {
          archiveStartDate: '1803-11-22',
          apiMinimumDate: null,
          completeness: 'not_guaranteed',
          verifiedSampleYears: [1803, 2003, 2005, 2007, 2020, 2026],
          knownGaps: ['2004–2006 website warning; some API records exist'],
        },
      });
      expect(requests[0]!.searchParams.get('queryParameters.startDate')).toBe(
        dates.startDate ?? null,
      );
      expect(requests[0]!.searchParams.get('queryParameters.endDate')).toBe(dates.endDate ?? null);
      expect(text(result)).toContain('some API records exist');
      expect(text(result)).toContain('API minimum date is unknown');
    },
  );

  it('omits blank form filters, clamps workload and preserves successful empty guidance', async () => {
    const requests = installHansard(() => spoken([]));
    const result = await runToolContract(ukparlSearchHansard, {
      query: ' ',
      house: '',
      memberId: '',
      startDate: '',
      endDate: '',
      debateSectionId: '',
      cursor: '',
      contentCursor: '',
      limit: 999,
    });
    expect(output(result)).toMatchObject({
      items: [],
      page: { returned: 0, total: 0, hasMore: false },
    });
    expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({
      'queryParameters.skip': '0',
      'queryParameters.take': '100',
      'queryParameters.outputType': 'List',
    });
    expect(result.structuredContent).toMatchObject({
      requestedLimit: 999,
      applied: { limit: 100 },
    });
    expect(text(result)).toContain('No matches. Repeat ukparl_search_hansard');
    expect(text(result)).toContain('empty result does not establish');
    const dated = await runToolContract(ukparlSearchHansard, { startDate: '1900-02-01' });
    output(dated);
    expect(text(dated)).toContain('wider date range');
  });

  it.each([{ startDate: '2024-02-30' }, { startDate: '2024-03-01', endDate: '2024-01-01' }])(
    'rejects impossible/reversed dates before I/O: %j',
    async (input) => {
      const requests = installHansard(() => spoken([]));
      error(await runToolContract(ukparlSearchHansard, input), 'invalid_date_range');
      expect(requests).toEqual([]);
    },
  );

  it('binds collection cursors to source, filters and sortOrder, resumes them under another limit, and permits past-end empty source pages', async () => {
    const requests = installHansard(windowed([contribution(), contribution(2), contribution(3)]));
    const first = output(await runToolContract(ukparlSearchHansard, { limit: 1 }));
    const cursor = first.page!.nextCursor!;
    const ascending = output(
      await runToolContract(ukparlSearchHansard, { limit: 1, sortOrder: 'SittingDateAsc' }),
    ).page!.nextCursor!;
    expect(requests).toHaveLength(2);
    for (const [change, minted] of [
      [{ query: 'other' }, cursor],
      [{ house: 'lords' }, cursor],
      [{ debateSectionId: '123' }, cursor],
      [{ sortOrder: 'SittingDateAsc' }, cursor],
      [{ sortOrder: 'SittingDateDesc' }, cursor],
      [{ sortOrder: 'SittingDateDesc' }, ascending],
      [{}, ascending],
    ] as const)
      error(
        await runToolContract(ukparlSearchHansard, { limit: 1, ...change, cursor: minted }),
        'invalid_cursor',
      );
    error(
      await runToolContract(ukparlSearchHansard, { cursor: 'broken!' }),
      'invalid_cursor',
      'Repeat the same tool with the same filters and no cursor or contentCursor to start a new page sequence.',
    );
    const foreign = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'bills',
        selector: 'spoken',
        filters: {},
        nativePageSize: 1,
      }),
      1,
    );
    error(
      await runToolContract(ukparlSearchHansard, { limit: 1, cursor: foreign }),
      'invalid_cursor',
    );
    expect(requests).toHaveLength(2);
    const resumed = output(await runToolContract(ukparlSearchHansard, { limit: 2, cursor }));
    expect(resumed.items!.map((row) => row.itemId)).toEqual(['2', '3']);
    expect(resumed.page).toEqual({ returned: 2, total: 3, hasMore: false });
    expect(requests.at(-1)!.searchParams.get('queryParameters.skip')).toBe('1');
    expect(requests.at(-1)!.searchParams.get('queryParameters.take')).toBe('2');
    const ascendingNext = output(
      await runToolContract(ukparlSearchHansard, {
        limit: 5,
        sortOrder: 'SittingDateAsc',
        cursor: ascending,
      }),
    );
    expect(ascendingNext.items!.map((row) => row.itemId)).toEqual(['2', '3']);
    expect(requests.at(-1)!.searchParams.get('queryParameters.orderBy')).toBe('SittingDateAsc');
    expect(requests.at(-1)!.searchParams.get('queryParameters.skip')).toBe('1');
    const end = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'hansard',
        selector: 'spoken',
        filters: {},
        nativePageSize: 1,
      }),
      99,
    );
    expect(
      output(await runToolContract(ukparlSearchHansard, { limit: 1, cursor: end })).page,
    ).toEqual({ returned: 0, total: 3, hasMore: false });
    expect(requests.at(-1)!.searchParams.get('queryParameters.skip')).toBe('99');
  });

  it('rejects an empty source page before its advertised total with actionable pagination guidance on both surfaces', async () => {
    const requests = installHansard(() => spoken([], 2));
    const result = await runToolContract(ukparlSearchHansard, { limit: 1 });
    expect(requests).toHaveLength(1);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.ValidationError, message: expect.any(String) },
    });
    expect(result.structuredContent).not.toHaveProperty('items');
    expect(result.structuredContent).not.toHaveProperty('page');
    const failure = result.structuredContent as { error: { message: string } };
    expect(failure.error.message).toMatch(/paginat|empty page/i);
    expect(failure.error.message).toMatch(/retry|repeat|restart/i);
    expect(text(result)).toContain(failure.error.message);
  });

  it('fails a valid cursor whose source page is empty before its reported total as a source inconsistency, never as cursor input', async () => {
    const requests = installHansard((url) =>
      spoken(Number(url.searchParams.get('queryParameters.skip')) === 0 ? [contribution()] : [], 3),
    );
    const cursor = output(await runToolContract(ukparlSearchHansard, { limit: 1 })).page!
      .nextCursor!;
    for (const limit of [1, 2]) {
      const result = await runToolContract(ukparlSearchHansard, { limit, cursor });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.ValidationError, data: { retryable: false } },
      });
      expect(result.structuredContent).not.toMatchObject({
        error: { data: { reason: 'invalid_cursor' } },
      });
      expect(text(result)).toContain('empty page before its reported pagination total');
    }
    expect(requests.map((url) => url.searchParams.get('queryParameters.skip'))).toEqual([
      '0',
      '1',
      '1',
    ]);
  });

  it('accepts an empty source page at the exact advertised end without a continuation', async () => {
    const requests = installHansard(() => spoken([], 2));
    const cursor = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'hansard',
        selector: 'spoken',
        filters: {},
        nativePageSize: 1,
      }),
      2,
    );
    const value = output(await runToolContract(ukparlSearchHansard, { limit: 1, cursor }));
    expect(value.items).toEqual([]);
    expect(value.page).toEqual({ returned: 0, total: 2, hasMore: false });
    expect(requests[0]!.searchParams.get('queryParameters.skip')).toBe('2');
  });

  it('pages limit-sized whole contributions past 24,000 reply bytes without losing IDs', async () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({
      ...contribution(i + 1),
      ContributionTextFull: `${i} ${'文é'.repeat(450 + (i % 3) * 30)}`,
    }));
    const requests = installHansard(windowed(rows));
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const result = await runToolContract(ukparlSearchHansard, {
        limit: 5,
        ...(cursor ? { cursor } : {}),
      });
      const value = output(result);
      expect(value.delivery).toBe('full');
      expect(value.page!.returned).toBe(value.items!.length);
      expect(requests.at(-1)!.searchParams.get('queryParameters.skip')).toBe(String(ids.length));
      sizes.push(value.items!.length);
      ids.push(...value.items!.map((row) => row.itemId));
      if (value.items!.length === 5)
        expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(24_000);
      cursor = value.page!.nextCursor;
    } while (cursor);
    expect(sizes).toEqual([5, 5, 3]);
    expect(ids).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
  });

  it('reconstructs very long escaped Unicode text, retains next contribution and rejects changed selection/revision', async () => {
    let full = '文🏛️\n"quoted"\\<p>&amp;</p>```'.repeat(900);
    installHansard((url) =>
      spoken(
        Number(url.searchParams.get('queryParameters.skip')) === 0
          ? [{ ...contribution(), ContributionTextFull: full }, contribution(2)]
          : [contribution(2)],
        2,
      ),
    );
    const input = { query: 'synthetic', limit: 2 };
    const first = output(await runToolContract(ukparlSearchHansard, input));
    expect(first.delivery).toBe('outline');
    expect(first.collectionPage).toMatchObject({ returned: 1, total: 2, hasMore: true });
    const restored = await reconstruct(input, first);
    expect(restored).toMatchObject({
      items: [{ itemId: '1', text: full, preview: 'Preview only…' }],
      page: { returned: 1, hasMore: true },
    });
    const next = output(
      await runToolContract(ukparlSearchHansard, {
        ...input,
        cursor: first.collectionPage!.nextCursor,
      }),
    );
    expect(next.items!.map((row) => row.itemId)).toEqual(['2']);
    const cursor = first.contentPage!.entries![0]!.contentCursor;
    error(
      await runToolContract(ukparlSearchHansard, {
        ...input,
        query: 'changed',
        contentCursor: cursor,
      }),
      'invalid_cursor',
    );
    error(
      await runToolContract(ukparlSearchHansard, {
        ...input,
        sortOrder: 'SittingDateAsc',
        contentCursor: cursor,
      }),
      'invalid_cursor',
    );
    const ascending = output(
      await runToolContract(ukparlSearchHansard, { ...input, sortOrder: 'SittingDateAsc' }),
    );
    expect(ascending.delivery).toBe('outline');
    error(
      await runToolContract(ukparlSearchHansard, {
        ...input,
        contentCursor: ascending.contentPage!.entries![0]!.contentCursor,
      }),
      'invalid_cursor',
    );
    full = 'Changed revision';
    error(
      await runToolContract(ukparlSearchHansard, { ...input, contentCursor: cursor }),
      'source_changed',
      'Repeat the same tool with its original filters and any collection cursor, but no contentCursor, then follow the new content cursors.',
    );
  });

  it('keeps outage and timeout distinct from empty success and provides narrower-window recovery', async () => {
    vi.useFakeTimers();
    initParliamentHttp({ exchange: async () => new Response('', { status: 503 }) });
    initHansardService();
    const outage = runToolContract(ukparlSearchHansard, {});
    await vi.runAllTimersAsync();
    const unavailable = await outage;
    error(unavailable, 'http_server_error');
    expect(unavailable.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.ServiceUnavailable },
    });
    expect(text(unavailable)).toContain('shorter date windows');
    expect(unavailable.structuredContent).not.toHaveProperty('items');
    disposeParliamentHttp();
    initParliamentHttp({
      exchange: async (_url, _ms, _ctx, signal) =>
        new Promise<Response>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    });
    initHansardService();
    const timeout = runToolContract(ukparlSearchHansard, {
      startDate: '1803-11-22',
      endDate: '2026-01-01',
    });
    await vi.runAllTimersAsync();
    const result = await timeout;
    error(result, 'call_deadline_exceeded');
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.Timeout },
    });
    expect(text(result)).toContain('shorter date windows');
    expect(result.structuredContent).not.toHaveProperty('items');
    expect(ukparlSearchHansard.errors?.map((entry) => entry.reason)).not.toContain(
      'attempt_timeout',
    );
    disposeParliamentHttp();
    const requests = installHansard(() => spoken([contribution()]));
    const recovered = output(
      await runToolContract(ukparlSearchHansard, {
        startDate: '2005-01-10',
        endDate: '2005-01-10',
      }),
    );
    expect(recovered.items!.map((row) => row.itemId)).toEqual(['1']);
    expect(requests[0]!.searchParams.get('queryParameters.startDate')).toBe('2005-01-10');
    expect(requests[0]!.searchParams.get('queryParameters.endDate')).toBe('2005-01-10');
  });

  it('rejects mixed-search wrappers and invalid scalar inputs without inventing empty results', async () => {
    const requests = installHansard(() => ({ Contributions: [], TotalContributions: 0 }));
    expect((await runToolContract(ukparlSearchHansard, {})).isError).toBe(true);
    for (const input of [
      { limit: 0 },
      { memberId: 'name' },
      { house: 'joint' },
      { debateSectionId: 'external-debate' },
    ])
      expect((await runToolContract(ukparlSearchHansard, input)).isError).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it('renders sparse procedural and historical records on both surfaces without fabricated full text', async () => {
    installHansard(() => ({
      Results: [
        {
          ItemId: '9007199254740993',
          ContributionExtId: '000123456789',
          MemberName: null,
          MemberId: null,
          Timecode: null,
          ContributionText: 'Procedural preview',
          ContributionTextFull: null,
        },
        { ItemId: 2, ContributionExtId: '2' },
      ],
      TotalResultCount: 2,
      SearchTerms: null,
    }));
    const result = await runToolContract(ukparlSearchHansard, {});
    const value = output(result);
    expect(value.items![0]).toMatchObject({
      itemId: '9007199254740993',
      contributionExtId: '000123456789',
      memberId: null,
      memberName: null,
      timecode: null,
      preview: 'Procedural preview',
      detailLevel: 'summary',
    });
    expect(value.items![0]).not.toHaveProperty('text');
    expect(value.items![1]!.memberName).toBeUndefined();
    expect(value.items![1]!.preview).toBeUndefined();
    expect(value).not.toHaveProperty('spokenResultCount');
    expect(value.searchTerms).toBeNull();
    expect(text(result)).toContain('labelled summaries');
  });

  it('reports declared queue and call-deadline recovery rather than an empty search', async () => {
    vi.useFakeTimers();
    initParliamentHttp({
      exchange: async (_url, _ms, _ctx, signal) =>
        new Promise<Response>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    });
    initHansardService();
    const pending = Array.from({ length: 34 }, () => runToolContract(ukparlSearchHansard, {}));
    await vi.advanceTimersByTimeAsync(0);
    error(await runToolContract(ukparlSearchHansard, {}), 'queue_full');
    await vi.advanceTimersByTimeAsync(45_000);
    const results = await Promise.all(pending);
    const deadline = results.find((result) => text(result).includes('call_deadline_exceeded'));
    expect(deadline).toBeDefined();
    error(deadline!, 'call_deadline_exceeded');
    expect(text(deadline!)).toContain('shorter date windows');
    expect(
      results.every(
        (result) => result.isError && !Object.hasOwn(result.structuredContent ?? {}, 'items'),
      ),
    ).toBe(true);
  });
});
