/**
 * @fileoverview Spoken Hansard contracts, byte-fit paging and lossless content retrieval.
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
import { renderedPayload } from './rendered-payload.js';

type Result = Awaited<ReturnType<typeof runToolContract>>;
type Output = ReturnType<typeof ukparlSearchHansard.output.parse>;
function text(result: Result) {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}
function output(result: Result): Output {
  expect(result.isError).not.toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24_000);
  const value = ukparlSearchHansard.output.parse(result.structuredContent);
  expect(renderedPayload(text(result))).toEqual(result.structuredContent);
  return value;
}
function error(result: Result, reason: string) {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    error: { data: { reason, recovery: { hint: expect.any(String) } } },
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
      const requests = installHansard(() => spoken([{ ...contribution(), MemberId }], 2));
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
        source: {
          url: requests[0]!.href,
          retrievedAt: expect.any(String),
          licenceUrl: expect.any(String),
        },
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
      'queryParameters.take': '20',
      'queryParameters.outputType': 'List',
    });
    expect(result.structuredContent).toMatchObject({ requestedLimit: 999, applied: { limit: 20 } });
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

  it('binds collection cursors to source, filters and effective limit, and permits past-end empty source pages', async () => {
    const requests = installHansard((url) =>
      spoken(Number(url.searchParams.get('queryParameters.skip')) === 0 ? [contribution()] : [], 2),
    );
    const first = output(await runToolContract(ukparlSearchHansard, { limit: 1 }));
    const cursor = first.page!.nextCursor!;
    for (const change of [
      { query: 'other' },
      { house: 'lords' },
      { limit: 2 },
      { debateSectionId: '123' },
    ])
      error(
        await runToolContract(ukparlSearchHansard, { limit: 1, ...change, cursor }),
        'invalid_cursor',
      );
    error(await runToolContract(ukparlSearchHansard, { cursor: 'broken!' }), 'invalid_cursor');
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
    expect(requests).toHaveLength(1);
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
    ).toEqual({ returned: 0, total: 2, hasMore: false });
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

  it('pages byte-fit whole contributions by actual emitted count without losing IDs', async () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({
      ...contribution(i + 1),
      ContributionTextFull: `${i} ${'文é'.repeat(250 + (i % 3) * 30)}`,
    }));
    const requests = installHansard((url) => {
      const skip = Number(url.searchParams.get('queryParameters.skip'));
      const take = Number(url.searchParams.get('queryParameters.take'));
      return spoken(rows.slice(skip, skip + take), rows.length);
    });
    const ids: string[] = [];
    let cursor: string | undefined;
    let calls = 0;
    do {
      const result = output(
        await runToolContract(ukparlSearchHansard, { limit: 20, ...(cursor ? { cursor } : {}) }),
      );
      expect(result.delivery).toBe('full');
      expect(result.items!.length).toBeGreaterThan(0);
      expect(result.page!.returned).toBe(result.items!.length);
      expect(requests.at(-1)!.searchParams.get('queryParameters.skip')).toBe(String(ids.length));
      ids.push(...result.items!.map((row) => row.itemId));
      cursor = result.page!.nextCursor;
      calls++;
      expect(calls).toBeLessThan(14);
    } while (cursor);
    expect(ids).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
    expect(calls).toBeGreaterThan(1);
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
    full = 'Changed revision';
    error(
      await runToolContract(ukparlSearchHansard, { ...input, contentCursor: cursor }),
      'source_changed',
    );
  });

  it('keeps outage and timeout distinct from empty success and provides narrower-window recovery', async () => {
    vi.useFakeTimers();
    initParliamentHttp({ exchange: async () => new Response('', { status: 503 }) });
    initHansardService();
    const outage = runToolContract(ukparlSearchHansard, {});
    await vi.runAllTimersAsync();
    const unavailable = await outage;
    expect(unavailable.isError).toBe(true);
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
    error(result, 'attempt_timeout');
    expect(text(result)).toContain('shorter date windows');
    expect(result.structuredContent).not.toHaveProperty('items');
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
