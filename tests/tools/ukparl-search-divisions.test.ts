/**
 * @fileoverview Division contracts, lossless pagination and recovery on both MCP surfaces.
 * @module tests/tools/ukparl-search-divisions.test
 */
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

type Result = Awaited<ReturnType<typeof runToolContract>>;
type Output = ReturnType<typeof ukparlSearchDivisions.output.parse>;
function text(result: Result) {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}
function output(result: Result): Output {
  expect(result.isError).not.toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24_000);
  const value = ukparlSearchDivisions.output.parse(result.structuredContent);
  const scalars = [...text(result).matchAll(/(`{3,})json\n([^\n]*)\n\1/g)].map((match) =>
    JSON.parse(match[2]!),
  );
  function visit(node: unknown): void {
    if (node !== null && typeof node === 'object')
      for (const child of Object.values(node)) visit(child);
    else if (node !== undefined) expect(scalars).toContainEqual(node);
  }
  visit(result.structuredContent);
  return value;
}
function error(result: Result, reason: string) {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    error: { data: { reason, recovery: { hint: expect.any(String) } } },
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
  it.each(['commons', 'lords'] as const)(
    'uses the exact %s search query and limit+1 without invented totals',
    async (house) => {
      const requests = installDivisions(() =>
        house === 'commons'
          ? [commonsDivision(42), commonsDivision(43), commonsDivision(44)]
          : [lordsDivision(42), lordsDivision(43), lordsDivision(44)],
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
        house === 'commons' ? '/data/divisions.json/search' : '/data/Divisions/search',
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
      expect(result.page).toMatchObject({ returned: 2, hasMore: true });
      expect(result.page).not.toHaveProperty('total');
      expect(result).not.toHaveProperty('totalCount');
      for (const record of result.items!) {
        expect(record.detailLevel).toBe('summary');
        expect(record).not.toHaveProperty('tellers');
        expect(record).not.toHaveProperty('rosterSelectors');
      }
    },
  );

  it.each(['commons', 'lords'] as const)(
    'clamps %s search workload and handles empty/past-end arrays',
    async (house) => {
      const requests = installDivisions(() => []);
      const cappedResult = await runToolContract(ukparlSearchDivisions, { house, limit: 999 });
      const capped = output(cappedResult);
      expect(capped).toMatchObject({ items: [], page: { returned: 0, hasMore: false } });
      expect(cappedResult.structuredContent).toMatchObject({
        requestedLimit: 999,
        applied: { limit: 10 },
      });
      expect(text(await runToolContract(ukparlSearchDivisions, { house }))).toContain(
        'No matching rows',
      );
      expect(
        requests[0]!.searchParams.get(house === 'commons' ? 'queryParameters.take' : 'take'),
      ).toBe('11');
      const selection = { house, mode: 'search', limit: 5 };
      const cursor = advanceCollectionCursor(
        readCollectionCursor(undefined, {
          source: `${house}_votes`,
          selector: 'search',
          filters: selection,
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
      });
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

  it('rejects reversed dates, malformed and changed-filter collection cursors before exchange', async () => {
    const requests = installDivisions(() => [commonsDivision(), commonsDivision(43)]);
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
      { house: 'commons', limit: 2, cursor },
    ])
      error(await runToolContract(ukparlSearchDivisions, input), 'invalid_cursor');
    expect(requests).toHaveLength(1);
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
    'pages varied full %s rosters by emitted whole IDs without teller loss',
    async (house) => {
      const names = Array.from(
        { length: 39 },
        (_, i) => `${i} Éire 文 🏛️ \n"quoted"\\\`\`\` ${'é文'.repeat(80 + (i % 5) * 20)}`,
      );
      installDivisions(() =>
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
                { MemberId: 40, Name: 'Unique teller' },
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
                { memberId: 40, name: 'Unique teller' },
              ],
              notContents: [],
              notContentTellers: [],
            },
      );
      const ids: string[] = [];
      const tellers: string[] = [];
      let cursor: string | undefined;
      let calls = 0;
      do {
        const value = output(
          await runToolContract(ukparlSearchDivisions, {
            house,
            mode: 'voters',
            divisionId: '42',
            limit: 50,
            ...(cursor ? { cursor } : {}),
          }),
        );
        expect(value.delivery).toBe('full');
        expect(value.page!.total).toBe(40);
        expect(value.page!.returned).toBe(value.voters!.length);
        ids.push(...value.voters!.map((row) => row.memberId));
        tellers.push(...value.voters!.filter((row) => row.isTeller).map((row) => row.memberId));
        cursor = value.page!.nextCursor;
        calls++;
        expect(calls).toBeLessThan(41);
      } while (cursor);
      expect(ids).toEqual(Array.from({ length: 40 }, (_, i) => String(i + 1)));
      expect(tellers).toEqual(['3', '40']);
      expect(calls).toBeGreaterThan(1);
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
    );
  });

  it.each(['commons', 'lords'] as const)(
    'pages %s search summaries by the actual byte-fit prefix and preserves every ID',
    async (house) => {
      const rows = Array.from({ length: 12 }, (_, i) =>
        house === 'commons'
          ? { ...commonsDivision(100 + i), Title: `${i} ${'文é'.repeat(200 + (i % 3) * 30)}` }
          : { ...lordsDivision(100 + i), title: `${i} ${'文é'.repeat(200 + (i % 3) * 30)}` },
      );
      const requests = installDivisions((url) => {
        const skip = Number(
          url.searchParams.get(house === 'commons' ? 'queryParameters.skip' : 'skip'),
        );
        const take = Number(
          url.searchParams.get(house === 'commons' ? 'queryParameters.take' : 'take'),
        );
        return rows.slice(skip, skip + take);
      });
      const ids: string[] = [];
      let cursor: string | undefined;
      let calls = 0;
      do {
        const result = await runToolContract(ukparlSearchDivisions, {
          house,
          limit: 10,
          ...(cursor ? { cursor } : {}),
        });
        const value = output(result);
        expect(value.delivery).toBe('full');
        expect(value.items!.length).toBeGreaterThan(0);
        expect(value.page!.returned).toBe(value.items!.length);
        expect(value.page).not.toHaveProperty('total');
        expect(result.structuredContent).not.toHaveProperty('totalCount');
        expect(
          requests.at(-1)!.searchParams.get(house === 'commons' ? 'queryParameters.skip' : 'skip'),
        ).toBe(String(ids.length));
        expect(result.structuredContent).toMatchObject({
          applied: { returned: value.items!.length },
        });
        ids.push(...value.items!.map((row) => row.divisionId));
        cursor = value.page!.nextCursor;
        calls++;
        expect(calls).toBeLessThan(13);
      } while (cursor);
      expect(ids).toEqual([
        '100',
        '101',
        '102',
        '103',
        '104',
        '105',
        '106',
        '107',
        '108',
        '109',
        '110',
        '111',
      ]);
      expect(calls).toBeGreaterThan(2);
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
    const end = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'commons_votes',
        selector: 'voters',
        filters: input,
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
        filters: input,
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
});
