/**
 * @fileoverview Division contracts, lossless pagination and recovery on both MCP surfaces.
 * @module tests/tools/ukparl-search-divisions.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ukparlSearchDivisions } from '@/mcp-server/tools/definitions/ukparl-search-divisions.tool.js';
import {
  advanceCollectionCursor,
  readCollectionCursor,
} from '@/services/parliament-http/parliament-cursors.js';
import {
  disposeParliamentHttp,
  initParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import {
  commonsDivision,
  installDivisions,
  lordsDivision,
} from '../services/divisions/divisions-fixtures.js';
import { renderedPayload, text } from './rendered-payload.js';

type Result = Awaited<ReturnType<typeof runToolContract>>;
type Output = ReturnType<typeof ukparlSearchDivisions.output.parse>;
/** Full pages hold whole records of at most 24,000 JSON bytes each; content pages fit 24,000 bytes. */
function output(result: Result): Output {
  expect(result.isError).not.toBe(true);
  const value = ukparlSearchDivisions.output.parse(result.structuredContent);
  if (value.delivery === 'full') {
    const structured = result.structuredContent as { items?: unknown[]; voters?: unknown[] };
    for (const row of [...(structured.items ?? []), ...(structured.voters ?? [])])
      expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThanOrEqual(24_000);
  } else expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24_000);
  expect(renderedPayload(text(result))).toEqual(result.structuredContent);
  return value;
}
/** Commons search routes serve at most 25 rows whatever take asks for; Lords honors take. */
function upstreamSlice<T>(house: 'commons' | 'lords', rows: T[], url: URL): T[] {
  const prefix = house === 'commons' ? 'queryParameters.' : '';
  const skip = Number(url.searchParams.get(`${prefix}skip`));
  const take = Number(url.searchParams.get(`${prefix}take`));
  return rows.slice(skip, skip + (house === 'commons' ? Math.min(take, 25) : take));
}
function searchParam(house: 'commons' | 'lords', url: URL, name: 'skip' | 'take') {
  return url.searchParams.get(house === 'commons' ? `queryParameters.${name}` : name);
}
/** `hint`, when given, is the tool's own declared recovery, which no throw-site hint may replace. */
function error(result: Result, reason: string, hint?: string) {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    error: { data: { reason, recovery: { hint: hint ?? expect.any(String) } } },
  });
  expect(text(result)).toContain(reason);
  const structured = result.structuredContent as {
    error: { data: { recovery: { hint: string } } };
  };
  expect(text(result)).toContain(structured.error.data.recovery.hint);
}

/** Reconstruct only from public content pages; do not use production delivery helpers. */
async function reconstruct(
  input: { house: unknown; [key: string]: unknown },
  first?: Output,
): Promise<unknown> {
  let value = first ?? output(await runToolContract(ukparlSearchDivisions, input));
  if (value.delivery === 'full') return value;
  let page = value.contentPage!;
  if (page.fragment !== undefined) {
    let encoded = page.fragment;
    while (page.hasMore) {
      value = output(
        await runToolContract(ukparlSearchDivisions, { ...input, contentCursor: page.nextCursor }),
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
      await runToolContract(ukparlSearchDivisions, { ...input, contentCursor: page.nextCursor }),
    );
    page = value.contentPage!;
  }
  return restored;
}

afterEach(disposeParliamentHttp);
describe('ukparl_search_divisions', () => {
  it.each([
    { MemberId: 1, MemberVotedAye: true, MemberVotedNo: true, MemberWasTeller: false },
    { MemberId: 1, MemberVotedAye: false, MemberVotedNo: false, MemberWasTeller: false },
    { MemberId: 1, MemberVotedAye: true, MemberWasTeller: false },
    { MemberId: 2, MemberVotedAye: true, MemberVotedNo: false, MemberWasTeller: false },
  ])('never invents a Commons vote from malformed member flags %j', async (wrapper) => {
    installDivisions(() => [{ ...wrapper, PublishedDivision: commonsDivision() }]);
    const result = await runToolContract(ukparlSearchDivisions, {
      house: 'commons',
      memberId: '1',
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.ValidationError },
    });
    expect(result.structuredContent).not.toHaveProperty('items');
  });
  it.each([
    { memberId: 1, memberWasContent: null, memberWasTeller: true },
    { memberId: 1, memberWasContent: true },
    { memberId: 2, memberWasContent: false, memberWasTeller: false },
  ])('rejects malformed Lords member wrappers %j', async (wrapper) => {
    installDivisions(() => [{ ...wrapper, publishedDivision: lordsDivision() }]);
    const result = await runToolContract(ukparlSearchDivisions, { house: 'lords', memberId: '1' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.ValidationError },
    });
    expect(result.structuredContent).not.toHaveProperty('items');
  });
  it.each(['commons', 'lords'] as const)(
    'keeps empty %s member-voting pages honest at the cap and past the end',
    async (house) => {
      const requests = installDivisions(() => []);
      const selection = { house, mode: 'search', memberId: '1' };
      const first = output(
        await runToolContract(ukparlSearchDivisions, { house, memberId: '1', limit: 999 }),
      );
      expect(first.page).toEqual({ returned: 0, hasMore: false });
      expect(first.items).toEqual([]);
      const cursor = advanceCollectionCursor(
        readCollectionCursor(undefined, {
          source: `${house}_votes`,
          selector: 'search',
          filters: selection,
          nativePageSize: 10,
        }),
        99,
      );
      const past = output(
        await runToolContract(ukparlSearchDivisions, { house, memberId: '1', limit: 999, cursor }),
      );
      expect(past.page).toEqual({ returned: 0, hasMore: false });
      expect(
        requests.at(-1)!.searchParams.get(house === 'commons' ? 'queryParameters.skip' : 'skip'),
      ).toBe('99');
      expect(requests).toHaveLength(2);
    },
  );
  it('reconstructs a member-voting search summary and nested memberVote without losing source metadata', async () => {
    const title = '<p>文 and source HTML</p>'.repeat(1600);
    installDivisions(() => [
      {
        MemberId: 1,
        MemberVotedAye: false,
        MemberVotedNo: true,
        MemberWasTeller: true,
        PublishedDivision: { ...commonsDivision(), Title: title },
      },
    ]);
    const input = { house: 'commons', memberId: '1' };
    const first = output(await runToolContract(ukparlSearchDivisions, input));
    expect(first.delivery).toBe('outline');
    const restored = (await reconstruct(input, first)) as Output;
    expect(restored).toMatchObject({
      source: { api: 'commons_votes', url: expect.stringContaining('/membervoting?') },
      items: [
        { title, noCount: null, memberVote: { memberId: '1', lobby: 'no', wasTeller: true } },
      ],
    });
    expect(restored.items![0]).not.toHaveProperty('source');
  });
  it.each(['commons', 'lords'] as const)(
    'retains %s member votes across limit-sized pages, a changed limit and cursor bindings',
    async (house) => {
      const rows = Array.from({ length: 5 }, (_, index) =>
        house === 'commons'
          ? {
              MemberId: 1,
              MemberVotedAye: true,
              MemberVotedNo: false,
              MemberWasTeller: false,
              PublishedDivision: { ...commonsDivision(42 + index), Title: '文'.repeat(1200) },
            }
          : {
              memberId: 1,
              memberWasContent: true,
              memberWasTeller: false,
              publishedDivision: { ...lordsDivision(42 + index), title: '文'.repeat(1200) },
            },
      );
      const requests = installDivisions((url) => upstreamSlice(house, rows, url));
      const ids: string[] = [];
      let cursor: string | undefined;
      // Page one asks for 2; the cursor then resumes at offset 2 under limit 3.
      for (const [limit, expected] of [
        [2, ['42', '43']],
        [3, ['44', '45', '46']],
      ] as const) {
        const result = await runToolContract(ukparlSearchDivisions, {
          house,
          memberId: '1',
          limit,
          ...(cursor ? { cursor } : {}),
        });
        const value = output(result);
        expect(requests.at(-1)!.origin).toBe(
          house === 'commons'
            ? 'https://commonsvotes-api.parliament.uk'
            : 'https://lordsvotes-api.parliament.uk',
        );
        expect(searchParam(house, requests.at(-1)!, 'skip')).toBe(String(ids.length));
        expect(searchParam(house, requests.at(-1)!, 'take')).toBe(String(limit + 1));
        expect(value.items!.map((row) => row.divisionId)).toEqual(expected);
        expect(value.page).toMatchObject({ returned: expected.length });
        expect(value.page).not.toHaveProperty('total');
        for (const row of value.items!) {
          ids.push(row.divisionId);
          expect(row.memberVote).toEqual({
            memberId: '1',
            lobby: house === 'commons' ? 'aye' : 'content',
            wasTeller: false,
          });
        }
        cursor = value.page!.nextCursor;
        if (cursor) {
          // The cap is the House search ceiling, not the effective limit of this page.
          expect(result.structuredContent).toMatchObject({
            applied: { limit },
            truncation: { shown: expected.length, cap: house === 'commons' ? 24 : 10 },
          });
          error(
            await runToolContract(ukparlSearchDivisions, { house, memberId: '2', limit, cursor }),
            'invalid_cursor',
          );
        } else expect(result.structuredContent).not.toHaveProperty('truncation');
      }
      expect(cursor).toBeUndefined();
      expect(ids).toEqual(['42', '43', '44', '45', '46']);
      expect(requests).toHaveLength(2);
    },
  );
  it.each(['commons', 'lords'] as const)(
    'uses the exact %s search query and limit+1 without invented totals',
    async (house) => {
      const requests = installDivisions(() =>
        house === 'commons'
          ? [42, 43, 44].map((id) => ({
              MemberId: 1,
              MemberVotedAye: id !== 43,
              MemberVotedNo: id === 43,
              MemberWasTeller: id === 42,
              PublishedDivision: commonsDivision(id),
            }))
          : [42, 43, 44].map((id) => ({
              memberId: 1,
              memberWasContent: id !== 43,
              memberWasTeller: id === 42,
              publishedDivision: lordsDivision(id),
            })),
      );
      const result = output(
        await runToolContract(ukparlSearchDivisions, {
          house,
          query: ' Synthetic ',
          memberId: '001',
          startDate: '2024-01-01',
          endDate: '2024-03-01',
          limit: 2,
        }),
      );
      expect(requests).toHaveLength(1);
      const url = requests[0]!;
      expect(url.hostname).toBe(
        house === 'commons' ? 'commonsvotes-api.parliament.uk' : 'lordsvotes-api.parliament.uk',
      );
      expect(url.pathname).toBe(
        house === 'commons' ? '/data/divisions.json/membervoting' : '/data/Divisions/membervoting',
      );
      expect(Object.fromEntries(url.searchParams)).toEqual(
        house === 'commons'
          ? {
              'queryParameters.searchTerm': 'Synthetic',
              'queryParameters.memberId': '1',
              'queryParameters.includeWhenMemberWasTeller': 'true',
              'queryParameters.startDate': '2024-01-01',
              'queryParameters.endDate': '2024-03-01',
              'queryParameters.skip': '0',
              'queryParameters.take': '3',
            }
          : {
              SearchTerm: 'Synthetic',
              MemberId: '1',
              IncludeWhenMemberWasTeller: 'true',
              StartDate: '2024-01-01',
              EndDate: '2024-03-01',
              skip: '0',
              take: '3',
            },
      );
      expect(result.items!.map((row) => row.divisionId)).toEqual(['42', '43']);
      expect(result.items!.map((row) => row.memberVote)).toEqual([
        { memberId: '1', lobby: house === 'commons' ? 'aye' : 'content', wasTeller: true },
        { memberId: '1', lobby: house === 'commons' ? 'no' : 'not_content', wasTeller: false },
      ]);
      expect(result.page).toMatchObject({ returned: 2, hasMore: true });
      expect(result.page).not.toHaveProperty('total');
      expect(result).not.toHaveProperty('totalCount');
      expect(result.source).toMatchObject({ api: `${house}_votes`, url: url.href });
      for (const record of result.items!) {
        expect(record.detailLevel).toBe('summary');
        for (const field of [
          'tellers',
          'rosterSelectors',
          'source',
          'rosterAvailableVia',
          'headlineCountTreatment',
          'headlineCountExplanationUrl',
        ])
          expect(record).not.toHaveProperty(field);
      }
    },
  );

  it.each(['commons', 'lords'] as const)(
    'clamps %s search workload and handles empty/past-end arrays',
    async (house) => {
      const requests = installDivisions(() => []);
      const cap = house === 'commons' ? 24 : 10;
      const cappedResult = await runToolContract(ukparlSearchDivisions, { house, limit: 999 });
      const capped = output(cappedResult);
      expect(capped).toMatchObject({ items: [], page: { returned: 0, hasMore: false } });
      expect(cappedResult.structuredContent).toMatchObject({
        requestedLimit: 999,
        applied: { limit: cap },
      });
      expect(text(cappedResult)).toContain(`Requested limit 999 is capped at ${cap}.`);
      const atCap = await runToolContract(ukparlSearchDivisions, { house, limit: cap });
      expect(atCap.structuredContent).not.toHaveProperty('requestedLimit');
      expect(text(atCap)).not.toContain('is capped at');
      const defaulted = await runToolContract(ukparlSearchDivisions, { house });
      expect(text(defaulted)).toContain('No matching rows');
      expect(defaulted.structuredContent).toMatchObject({ applied: { limit: 5 } });
      expect(requests.map((url) => searchParam(house, url, 'take'))).toEqual([
        String(cap + 1),
        String(cap + 1),
        '6',
      ]);
      const cursor = advanceCollectionCursor(
        readCollectionCursor(undefined, {
          source: `${house}_votes`,
          selector: 'search',
          filters: { house, mode: 'search' },
          nativePageSize: 5,
        }),
        99,
      );
      const past = output(await runToolContract(ukparlSearchDivisions, { house, cursor }));
      expect(past.page).toEqual({ returned: 0, hasMore: false });
      expect(
        requests.at(-1)!.searchParams.get(house === 'commons' ? 'queryParameters.skip' : 'skip'),
      ).toBe('99');
    },
  );

  it.each(['commons', 'lords'] as const)(
    'returns %s complete metadata, named tellers and exact roster filtering',
    async (house) => {
      installDivisions(() => (house === 'commons' ? commonsDivision() : lordsDivision()));
      const detail = output(
        await runToolContract(ukparlSearchDivisions, { house, mode: 'detail', divisionId: '42' }),
      );
      expect(detail).toMatchObject({
        house,
        found: true,
        record: { divisionId: '42', detailLevel: 'complete' },
        source: {
          api: `${house}_votes`,
          url:
            house === 'commons'
              ? 'https://commonsvotes-api.parliament.uk/data/division/42.json'
              : 'https://lordsvotes-api.parliament.uk/data/Divisions/42',
        },
      });
      expect(detail.record).not.toHaveProperty('source');
      expect(detail.record!.tellers!.map((row) => [row.memberId, row.isTeller])).toEqual(
        house === 'commons'
          ? [
              ['2', true],
              ['5', true],
            ]
          : [
              ['12', true],
              ['16', true],
            ],
      );
      const voters = output(
        await runToolContract(ukparlSearchDivisions, {
          house,
          mode: 'voters',
          divisionId: '42',
          party: house === 'commons' ? 'synthetic labour' : 'crossbench',
          lobby: house === 'commons' ? 'aye' : 'content',
        }),
      );
      expect(voters.voters!.map((row) => row.memberId)).toEqual(
        house === 'commons' ? ['1', '2', '5'] : ['11', '12'],
      );
      expect(voters.page).toEqual({
        returned: house === 'commons' ? 3 : 2,
        total: house === 'commons' ? 3 : 2,
        hasMore: false,
      });
      if (house === 'lords') {
        expect(voters.voters![0]).not.toHaveProperty('constituency');
        expect(voters.voters![0]!.partyIsMainParty).toBe(false);
      }
      const totals = output(
        await runToolContract(ukparlSearchDivisions, {
          house,
          mode: 'party_totals',
          divisionId: '42',
        }),
      );
      expect(totals.partyTotals).toContainEqual(
        house === 'commons'
          ? { party: 'Synthetic Labour', lobby: 'aye', voterCount: 1, tellerCount: 2 }
          : { party: 'Crossbench', lobby: 'content', voterCount: 1, tellerCount: 1 },
      );
    },
  );

  it.each(['commons', 'lords'] as const)(
    'keeps %s headline-count semantics and the roster route on complete detail',
    async (house) => {
      installDivisions(() => (house === 'commons' ? commonsDivision() : lordsDivision()));
      const result = await runToolContract(ukparlSearchDivisions, {
        house,
        mode: 'detail',
        divisionId: '42',
      });
      expect(output(result).record).toMatchObject({
        rosterAvailableVia: 'ukparl_search_divisions',
        headlineCountTreatment:
          house === 'commons'
            ? expect.stringContaining('Official Commons AyeCount and NoCount exclude tellers')
            : expect.stringContaining('Official Lords totals include teller votes'),
        headlineCountExplanationUrl: 'https://www.parliament.uk/site-information/glossary/tellers/',
      });
      expect(text(result)).toContain(
        'https://www.parliament.uk/site-information/glossary/tellers/',
      );
    },
  );

  it('keeps sparse identity/counts unknown and not_recorded distinct from abstention', async () => {
    installDivisions(() => commonsDivision());
    const all = output(
      await runToolContract(ukparlSearchDivisions, {
        house: 'commons',
        mode: 'voters',
        divisionId: '42',
      }),
    );
    expect(all.voters!.map((row) => row.memberId)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(all.voters![2]).toMatchObject({ party: null, name: null, constituency: null });
    expect(all.voters![3]!.party).toBeUndefined();
    expect(all.voters![3]!.constituency).toBeUndefined();
    expect(all.record!.noCount).toBeNull();
    expect(all.record!.doubleMajorityNoCount).toBeUndefined();
    const selected = output(
      await runToolContract(ukparlSearchDivisions, {
        house: 'commons',
        mode: 'voters',
        divisionId: '42',
        lobby: 'not_recorded',
      }),
    );
    expect(selected.voters).toEqual([
      {
        memberId: '7',
        name: 'No recorded vote',
        party: 'Synthetic Labour',
        lobby: 'not_recorded',
        isTeller: false,
      },
    ]);
  });

  it.each(['commons', 'lords'] as const)(
    'distinguishes omitted %s rosters from known empty rosters',
    async (house) => {
      let sparse = true;
      installDivisions(() =>
        house === 'commons'
          ? {
              DivisionId: 42,
              Ayes: sparse ? null : [],
              AyeTellers: [],
              Noes: [],
              NoTellers: [],
              NoVoteRecorded: [],
            }
          : {
              divisionId: 42,
              contents: sparse ? null : [],
              contentTellers: [],
              notContents: [],
              notContentTellers: [],
            },
      );
      const input = { house, mode: 'voters', divisionId: '42' };
      const unavailable = output(await runToolContract(ukparlSearchDivisions, input));
      expect(unavailable.voters).toBeUndefined();
      expect(unavailable.page).toBeUndefined();
      expect(unavailable.guidance).toContain('omitted');
      expect(unavailable.record!.rosterSelectors![0]).toMatchObject({
        membersKnown: false,
        count: null,
      });
      sparse = false;
      const empty = output(await runToolContract(ukparlSearchDivisions, input));
      expect(empty).toMatchObject({ voters: [], page: { returned: 0, total: 0, hasMore: false } });
      expect(empty.record!.rosterSelectors![0]).toMatchObject({ membersKnown: true, count: 0 });
    },
  );

  it.each([
    { house: 'commons', mode: 'detail' },
    { house: 'commons', divisionId: '42' },
    { house: 'lords', mode: 'voters', divisionId: '42', lobby: 'aye' },
    { house: 'commons', mode: 'voters', divisionId: '42', lobby: 'content' },
    { house: 'commons', mode: 'detail', divisionId: '42', query: 'x' },
    { house: 'commons', mode: 'detail', divisionId: '42', limit: 1 },
    { house: 'lords', mode: 'party_totals', divisionId: '42', cursor: 'x' },
    { house: 'commons', party: 'x' },
  ])('rejects invalid combinations before exchange: %j', async (input) => {
    const requests = installDivisions(() => []);
    error(await runToolContract(ukparlSearchDivisions, input), 'invalid_mode');
    expect(requests).toEqual([]);
  });

  it.each([
    [{ mode: 'detail' }, 'mode=detail requires divisionId; select an ID from search results.'],
    [
      { divisionId: '42' },
      'mode=search does not accept divisionId; omit it or select detail, voters or party_totals.',
    ],
    [
      {
        mode: 'detail',
        divisionId: '42',
        query: 'x',
        memberId: '3',
        startDate: '2026-01-01',
        endDate: '2026-01-02',
      },
      'mode=detail does not accept query, memberId, startDate, endDate; remove these fields or use mode=search.',
    ],
    [
      { party: 'x', lobby: 'aye' },
      'mode=search does not accept party, lobby; remove these fields or use mode=voters.',
    ],
    [
      { mode: 'detail', divisionId: '42', cursor: 'x', limit: 1 },
      'mode=detail does not accept cursor, limit; omit collection pagination.',
    ],
    [
      { mode: 'voters', divisionId: '42', lobby: 'content' },
      'lobby=content is incompatible with house=commons; use aye, no or not_recorded.',
    ],
    [
      { house: 'lords', mode: 'voters', divisionId: '42', lobby: 'aye' },
      'lobby=aye is incompatible with house=lords; use content or not_content.',
    ],
    [
      { mode: 'detail', query: 'x', party: 'y', limit: 1 },
      'mode=detail requires divisionId; select an ID from search results. mode=detail does not accept query; remove these fields or use mode=search. mode=detail does not accept party; remove these fields or use mode=voters. mode=detail does not accept limit; omit collection pagination.',
    ],
  ])('names division conflicts on both surfaces: %j', async (fields, message) => {
    const requests = installDivisions(() => []);
    const result = await runToolContract(ukparlSearchDivisions, { house: 'commons', ...fields });
    error(result, 'invalid_mode');
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams, message },
    });
    expect(text(result)).toContain(message);
    expect(requests).toEqual([]);
  });

  it('rejects reversed dates, malformed and changed-filter cursors before exchange, and resumes under a changed limit', async () => {
    const rows = [42, 43, 44].map((id) => commonsDivision(id));
    const requests = installDivisions((url) => upstreamSlice('commons', rows, url));
    error(
      await runToolContract(ukparlSearchDivisions, {
        house: 'commons',
        startDate: '2024-03-02',
        endDate: '2024-03-01',
      }),
      'invalid_date_range',
    );
    expect(requests).toEqual([]);
    const first = output(
      await runToolContract(ukparlSearchDivisions, { house: 'commons', limit: 1 }),
    );
    const cursor = first.page!.nextCursor!;
    for (const input of [
      { house: 'commons', cursor: 'bad!' },
      { house: 'commons', limit: 1, query: 'different', cursor },
      { house: 'lords', limit: 1, cursor },
    ])
      error(
        await runToolContract(ukparlSearchDivisions, input),
        'invalid_cursor',
        'Repeat the same tool and filters without cursor or contentCursor to start again.',
      );
    expect(requests).toHaveLength(1);
    const resumed = output(
      await runToolContract(ukparlSearchDivisions, { house: 'commons', limit: 2, cursor }),
    );
    expect(resumed.items!.map((row) => row.divisionId)).toEqual(['43', '44']);
    expect(resumed.page).toEqual({ returned: 2, hasMore: false });
    expect(searchParam('commons', requests.at(-1)!, 'skip')).toBe('1');
    expect(searchParam('commons', requests.at(-1)!, 'take')).toBe('3');
    expect(requests).toHaveLength(2);
  });

  it.each(['commons', 'lords'] as const)(
    'returns a recoverable %s 404 miss and does not swallow invalid JSON shapes',
    async (house) => {
      let missing = true;
      const requests = installDivisions(() =>
        missing ? new Response('', { status: 404 }) : { wrong: 'shape' },
      );
      const input = { house, mode: 'detail', divisionId: '42' };
      const miss = output(await runToolContract(ukparlSearchDivisions, input));
      expect(miss).toMatchObject({ found: false });
      expect(miss.record).toBeUndefined();
      expect(miss.guidance).toContain('same House');
      missing = false;
      const malformed = await runToolContract(ukparlSearchDivisions, input);
      expect(malformed.isError).toBe(true);
      expect(malformed.structuredContent).not.toHaveProperty('found');
      expect(requests).toHaveLength(2);
    },
  );

  it.each(['commons', 'lords'] as const)(
    'pages varied full %s rosters in limit-sized whole rows without teller loss',
    async (house) => {
      const names = Array.from(
        { length: 59 },
        (_, i) => `${i} Éire 文 🏛️ \n"quoted"\\\`\`\` ${'é文'.repeat(80 + (i % 5) * 20)}`,
      );
      const requests = installDivisions(() =>
        house === 'commons'
          ? {
              DivisionId: 42,
              Ayes: names.map((Name, i) => ({
                MemberId: i + 1,
                Name,
                ...(i % 3 ? { Party: 'P', MemberFrom: `Seat ${i}` } : {}),
              })),
              AyeTellers: [
                { MemberId: 3, Name: names[2], Party: 'P' },
                { MemberId: 60, Name: 'Unique teller' },
              ],
              Noes: [],
              NoTellers: [],
              NoVoteRecorded: [],
            }
          : {
              divisionId: 42,
              contents: names.map((name, i) => ({
                memberId: i + 1,
                name,
                ...(i % 3 ? { party: 'P', partyIsMainParty: false } : {}),
              })),
              contentTellers: [
                { memberId: 3, name: names[2], party: 'P' },
                { memberId: 60, name: 'Unique teller' },
              ],
              notContents: [],
              notContentTellers: [],
            },
      );
      const ids: string[] = [];
      const tellers: string[] = [];
      let cursor: string | undefined;
      // 999 clamps to the voters cap of 50; the cursor then resumes under limit 4 and the default 20.
      for (const [limit, returned] of [
        [999, 50],
        [4, 4],
        [undefined, 6],
      ] as const) {
        const result = await runToolContract(ukparlSearchDivisions, {
          house,
          mode: 'voters',
          divisionId: '42',
          ...(limit ? { limit } : {}),
          ...(cursor ? { cursor } : {}),
        });
        const value = output(result);
        expect(value.delivery).toBe('full');
        expect(value.page).toMatchObject({ returned, total: 60, hasMore: returned !== 6 });
        expect(value.voters).toHaveLength(returned);
        expect(result.structuredContent).toMatchObject({
          applied: { limit: limit === 999 ? 50 : (limit ?? 20), returned },
          ...(limit === 999 ? { requestedLimit: 999 } : {}),
          ...(returned !== 6 ? { truncation: { shown: returned, cap: 50 } } : {}),
        });
        if (returned === 6) expect(result.structuredContent).not.toHaveProperty('truncation');
        ids.push(...value.voters!.map((row) => row.memberId));
        tellers.push(...value.voters!.filter((row) => row.isTeller).map((row) => row.memberId));
        cursor = value.page!.nextCursor;
      }
      expect(cursor).toBeUndefined();
      expect(ids).toEqual(Array.from({ length: 60 }, (_, i) => String(i + 1)));
      expect(tellers).toEqual(['3', '60']);
      expect(requests).toHaveLength(3);
    },
  );

  it('reconstructs indivisible escaped detail metadata and detects changed revisions', async () => {
    let title = '文🏛️\n"quoted"\\<p>source</p>```'.repeat(1600);
    installDivisions(() => ({ ...commonsDivision(), Title: title }));
    const input = { house: 'commons', mode: 'detail', divisionId: '42' };
    const first = output(await runToolContract(ukparlSearchDivisions, input));
    expect(first.delivery).toBe('outline');
    const restored = await reconstruct(input, first);
    expect(restored).toMatchObject({
      found: true,
      house: 'commons',
      record: {
        title,
        ayeCount: 101,
        noCount: null,
        tellers: [
          { memberId: '2', name: 'Teller α', isTeller: true },
          { memberId: '5', name: 'Teller β', isTeller: true },
        ],
      },
    });
    const cursor = first.contentPage!.entries![0]!.contentCursor;
    error(
      await runToolContract(ukparlSearchDivisions, {
        ...input,
        divisionId: '43',
        contentCursor: cursor,
      }),
      'invalid_cursor',
    );
    title = 'Changed';
    error(
      await runToolContract(ukparlSearchDivisions, { ...input, contentCursor: cursor }),
      'source_changed',
      'Repeat the original selection and any collection cursor, but no contentCursor, and follow the newly returned content cursors.',
    );
  });

  it.each([
    ['commons', [24, 6]],
    ['lords', [10, 10, 10]],
  ] as const)(
    'pages %s search summaries in whole records up to the House cap and preserves every ID',
    async (house, pages) => {
      const cap = pages[0];
      const rows = Array.from({ length: 30 }, (_, i) =>
        house === 'commons'
          ? { ...commonsDivision(100 + i), Title: `${i} ${'文é'.repeat(200 + (i % 3) * 30)}` }
          : { ...lordsDivision(100 + i), title: `${i} ${'文é'.repeat(200 + (i % 3) * 30)}` },
      );
      const requests = installDivisions((url) => upstreamSlice(house, rows, url));
      const ids: string[] = [];
      let cursor: string | undefined;
      for (const [index, returned] of pages.entries()) {
        const result = await runToolContract(ukparlSearchDivisions, {
          house,
          limit: 999,
          ...(cursor ? { cursor } : {}),
        });
        const value = output(result);
        const last = index === pages.length - 1;
        expect(value.delivery).toBe('full');
        expect(value.items).toHaveLength(returned);
        expect(value.page).toMatchObject({ returned, hasMore: !last });
        expect(value.page).not.toHaveProperty('total');
        expect(result.structuredContent).not.toHaveProperty('totalCount');
        expect(searchParam(house, requests.at(-1)!, 'skip')).toBe(String(ids.length));
        expect(searchParam(house, requests.at(-1)!, 'take')).toBe(String(cap + 1));
        expect(result.structuredContent).toMatchObject({
          requestedLimit: 999,
          applied: { limit: cap, returned },
          ...(last ? {} : { truncation: { shown: returned, cap } }),
        });
        if (last) expect(result.structuredContent).not.toHaveProperty('truncation');
        // Provenance rides once on the payload; per-item repeats stay on detail.
        expect(value.source).toMatchObject({ api: `${house}_votes`, url: requests.at(-1)!.href });
        for (const row of value.items!)
          for (const field of [
            'source',
            'rosterAvailableVia',
            'headlineCountTreatment',
            'headlineCountExplanationUrl',
          ])
            expect(row).not.toHaveProperty(field);
        ids.push(...value.items!.map((row) => row.divisionId));
        cursor = value.page!.nextCursor;
      }
      expect(cursor).toBeUndefined();
      expect(ids).toEqual(Array.from({ length: 30 }, (_, i) => String(100 + i)));
    },
  );

  it.each(['commons', 'lords'] as const)(
    'does not claim a complete %s roster when the teller array was omitted',
    async (house) => {
      installDivisions(() =>
        house === 'commons'
          ? { DivisionId: 42, Ayes: [{ MemberId: 1 }], Noes: [], NoTellers: [], NoVoteRecorded: [] }
          : { divisionId: 42, contents: [{ memberId: 1 }], notContents: [], notContentTellers: [] },
      );
      const unavailable = output(
        await runToolContract(ukparlSearchDivisions, { house, mode: 'voters', divisionId: '42' }),
      );
      expect(unavailable.voters).toBeUndefined();
      expect(unavailable.record!.rosterSelectors![0]).toMatchObject({
        membersKnown: true,
        tellersKnown: false,
      });
      expect(unavailable.record!.rosterSelectors![0]!.count).toBeUndefined();
      const available = output(
        await runToolContract(ukparlSearchDivisions, {
          house,
          mode: 'voters',
          divisionId: '42',
          lobby: house === 'commons' ? 'no' : 'not_content',
        }),
      );
      expect(available).toMatchObject({
        voters: [],
        page: { returned: 0, hasMore: false, total: 0 },
      });
    },
  );

  it('validates local voter offsets and cursor party/lobby bindings', async () => {
    const requests = installDivisions(() => commonsDivision());
    const input = { house: 'commons', mode: 'voters', divisionId: '42', limit: 1 };
    const first = output(await runToolContract(ukparlSearchDivisions, input));
    const cursor = first.page!.nextCursor!;
    for (const change of [{ party: 'Synthetic Labour' }, { lobby: 'aye' }, { divisionId: '43' }])
      error(
        await runToolContract(ukparlSearchDivisions, { ...input, ...change, cursor }),
        'invalid_cursor',
      );
    expect(requests).toHaveLength(1);
    const { limit: _limit, ...filters } = input;
    const end = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'commons_votes',
        selector: 'voters',
        filters,
        nativePageSize: 1,
      }),
      7,
    );
    const empty = output(await runToolContract(ukparlSearchDivisions, { ...input, cursor: end }));
    expect(empty.page).toEqual({ returned: 0, total: 7, hasMore: false });
    const past = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'commons_votes',
        selector: 'voters',
        filters,
        nativePageSize: 1,
      }),
      8,
    );
    error(
      await runToolContract(ukparlSearchDivisions, { ...input, cursor: past }),
      'invalid_cursor',
    );
  });

  it('renders declared queue-full recovery and releases every held call', async () => {
    const released = Promise.withResolvers<void>();
    const active = Promise.withResolvers<void>();
    let started = 0;
    initParliamentHttp({
      exchange: async () => {
        started++;
        if (started === 2) active.resolve();
        await released.promise;
        return Response.json([]);
      },
    });
    const pending = [
      runToolContract(ukparlSearchDivisions, { house: 'commons' }),
      runToolContract(ukparlSearchDivisions, { house: 'commons' }),
    ];
    await active.promise;
    pending.push(
      ...Array.from({ length: 32 }, () =>
        runToolContract(ukparlSearchDivisions, { house: 'commons' }),
      ),
    );
    try {
      error(await runToolContract(ukparlSearchDivisions, { house: 'commons' }), 'queue_full');
      expect(started).toBe(2);
    } finally {
      released.resolve();
      const settled = await Promise.all(pending);
      for (const result of settled) expect(result.isError).not.toBe(true);
    }
  });

  it('renders an upstream 5xx and declares the call deadline with same-tool recovery', async () => {
    installDivisions(() => new Response('', { status: 501 }));
    const result = await runToolContract(ukparlSearchDivisions, { house: 'commons' });
    error(result, 'http_server_error');
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: { recovery: { hint: expect.stringContaining('ukparl_search_divisions') } },
      },
    });
    expect(ukparlSearchDivisions.errors).toContainEqual(
      expect.objectContaining({
        reason: 'call_deadline_exceeded',
        code: JsonRpcErrorCode.Timeout,
        thrownBy: 'service',
        recovery: expect.stringContaining('ukparl_search_divisions'),
      }),
    );
  });
});
