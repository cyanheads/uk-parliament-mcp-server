/**
 * @fileoverview Public static reference contracts and recovery on both MCP surfaces.
 * @module tests/tools/ukparl-lookup-reference.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ukparlLookupReference } from '@/mcp-server/tools/definitions/ukparl-lookup-reference.tool.js';
import { disposeBillsService, initBillsService } from '@/services/bills/bills-service.js';
import { disposeMembers, initMembers } from '@/services/members/members-service.js';
import {
  CollectionCursorSchema,
  decodeCursor,
  digest,
  encodeCursor,
} from '@/services/parliament-http/parliament-cursors.js';
import {
  disposeParliamentHttp,
  initParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import { LICENCE_NOTICE, LICENCE_URL } from '@/services/parliament-http/parliament-models.js';

function installReference(route: (url: URL) => unknown | Response) {
  const requests: URL[] = [];
  initParliamentHttp({
    exchange: async (url) => {
      requests.push(new URL(url));
      const result = route(url);
      return result instanceof Response ? result : Response.json(result);
    },
  });
  initBillsService();
  initMembers();
  return requests;
}

afterEach(() => {
  disposeBillsService();
  disposeMembers();
  disposeParliamentHttp();
  vi.useRealTimers();
});

function text(result: Awaited<ReturnType<typeof runToolContract>>): string {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

describe('ukparl_lookup_reference static guides', () => {
  it('preserves identifier namespaces and exact selection names on both surfaces', async () => {
    const result = await runToolContract(ukparlLookupReference, { topic: 'identifiers' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      topic: 'identifiers',
      delivery: 'full',
      identifiers: {
        namespaces: expect.arrayContaining([
          expect.objectContaining({ namespace: 'billStageId' }),
          expect.objectContaining({ namespace: 'divisionId' }),
        ]),
      },
    });
    for (const term of [
      'billStageId',
      'stageId and billTypeId',
      'DebateSectionExtId',
      'inquiries',
      'publication',
      'sessionDiscovery',
      'Open Parliament Licence',
    ])
      expect(text(result)).toContain(term);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
  });

  it('keeps coverage uncertainty, null API minimum and official sources on both surfaces', async () => {
    const result = await runToolContract(ukparlLookupReference, {
      topic: 'coverage',
      house: '',
      nameContains: '',
      cursor: '',
      contentCursor: '',
      limit: 1000,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      delivery: 'full',
      coverage: {
        apiMinimumDate: null,
        completeness: 'not_guaranteed',
        archiveStartDate: '1803-11-22',
        verifiedSampleYears: [1803, 2003, 2005, 2007, 2020, 2026],
      },
      applied: { limit: 20 },
      requestedLimit: 1000,
    });
    for (const term of [
      'null',
      'not_guaranteed',
      '1803-11-22',
      '2004–2006',
      'https://api.parliament.uk/historic-hansard/',
      '1000',
      '20',
    ])
      expect(text(result)).toContain(term);
  });

  it.each([{ house: 'commons' }, { nameContains: 'bill' }, { cursor: 'a' }])(
    'renders static-mode recovery for %j',
    async (fields) => {
      const result = await runToolContract(ukparlLookupReference, {
        topic: 'identifiers',
        ...fields,
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.InvalidParams,
          data: {
            reason: 'invalid_mode_arguments',
            recovery: {
              hint: 'Call ukparl_lookup_reference with topic=identifiers, then repeat this tool with the fields required by its selected mode.',
            },
          },
        },
      });
      expect(text(result)).toContain('topic=identifiers');
      expect(text(result)).toContain('invalid_mode_arguments');
    },
  );

  it('renders malformed content-cursor recovery on both surfaces', async () => {
    const result = await runToolContract(ukparlLookupReference, {
      topic: 'coverage',
      contentCursor: 'invalid!',
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'invalid_cursor' } },
    });
    expect(text(result)).toContain('same filters and no cursor or contentCursor');
  });

  it('renders source-change recovery on both surfaces for a stale content revision', async () => {
    const contentCursor = encodeCursor({
      v: 1,
      binding: digest({
        tool: 'ukparl_lookup_reference',
        selection: { topic: 'coverage', limit: 10 },
      }),
      revision: 'stale-source-revision',
      path: '',
      arm: 'entries',
      offset: 0,
    });
    const result = await runToolContract(ukparlLookupReference, {
      topic: 'coverage',
      contentCursor,
    });
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.Conflict,
        data: {
          reason: 'source_changed',
          recovery: {
            hint: 'Repeat the same tool with its original filters and no contentCursor, then follow the new content cursors.',
          },
        },
      },
    });
    expect(text(result)).toContain('original filters and no contentCursor');
    expect(text(result)).toContain('source_changed');
  });

  it('rejects invalid topics and absurd limits before the handler', async () => {
    expect(ukparlLookupReference.input.safeParse({ topic: 'unknown' }).success).toBe(false);
    for (const input of [
      { topic: 'coverage', limit: 0 },
      { topic: 'coverage', limit: -1 },
      { topic: 'coverage', limit: 1.5 },
    ] as const) {
      const result = await runToolContract(ukparlLookupReference, input);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams },
      });
      expect(result.isError).toBe(true);
    }
  });

  it('clamps a valid positive read limit above 1000 in the handler on both surfaces', async () => {
    const result = await runToolContract(ukparlLookupReference, { topic: 'coverage', limit: 1001 });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      delivery: 'full',
      applied: { limit: 20 },
      requestedLimit: 1001,
    });
    expect(text(result)).toContain('1001');
    expect(text(result)).toContain('20 reference rows');
  });
});

describe('ukparl_lookup_reference live directories', () => {
  it('canonicalizes numeric reference IDs while preserving repeated source rows', async () => {
    installReference(() => [
      { id: 7, name: 'Synthetic repeat' },
      { id: 7, name: 'Synthetic repeat' },
      { id: 8, name: 'Synthetic distinct' },
    ]);
    const result = await runToolContract(ukparlLookupReference, { topic: 'departments' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      items: [
        { id: '7', name: 'Synthetic repeat' },
        { id: '7', name: 'Synthetic repeat' },
        { id: '8', name: 'Synthetic distinct' },
      ],
      page: { returned: 3, total: 3, hasMore: false },
    });
    expect(text(result)).toContain('/items/0/id\n```json\n"7"');
    expect(text(result)).toContain('/items/1/id\n```json\n"7"');
    expect(text(result)).toContain('/items/2/id\n```json\n"8"');
  });

  it.each(['bill_stages', 'bill_types'] as const)(
    'fully reads %s before AND filtering, retaining every request source',
    async (topic) => {
      const requests = installReference((url) => {
        expect(url.pathname).toBe(topic === 'bill_stages' ? '/api/v1/Stages' : '/api/v1/BillTypes');
        expect(url.searchParams.get('Take')).toBe('100');
        return url.searchParams.get('Skip') === '0'
          ? {
              items: [
                { id: 1, name: 'Synthetic Blue', house: 'Commons' },
                { id: 2, name: 'Other Green', house: 'Lords' },
              ],
              totalResults: 4,
              itemsPerPage: 2,
            }
          : {
              items: [
                {
                  id: 3,
                  name: 'GREEN synthetic',
                  description: null,
                  house: 'Unassigned',
                  category: 'Public',
                },
                { id: 4, name: 'Synthetic Green final', house: null },
              ],
              totalResults: 4,
              itemsPerPage: 2,
            };
      });
      const result = await runToolContract(ukparlLookupReference, {
        topic,
        nameContains: '  GREEN   SYNTHETIC ',
        limit: 1,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        delivery: 'full',
        topic,
        nameContains: 'green synthetic',
        items: [
          {
            id: '3',
            name: 'GREEN synthetic',
            house: 'unassigned',
            description: null,
            category: 'Public',
          },
        ],
        page: { returned: 1, total: 2, hasMore: true },
        totalCount: 2,
        truncated: true,
        shown: 1,
      });
      const first = ukparlLookupReference.output.parse(result.structuredContent);
      expect(requests.map((url) => url.searchParams.get('Skip'))).toEqual(['0', '2']);
      expect(first.sources).toEqual(
        requests.map((url) => ({
          api: 'bills',
          url: url.href,
          retrievedAt: expect.any(String),
          licenceUrl: LICENCE_URL,
        })),
      );
      for (const source of first.sources!) expect(text(result)).toContain(source.url);
      for (const term of ['green synthetic', 'unassigned', 'Public', 'null', LICENCE_NOTICE])
        expect(text(result)).toContain(term);
      const next = await runToolContract(ukparlLookupReference, {
        topic,
        nameContains: 'synthetic GREEN',
        limit: 1,
        cursor: first.page!.nextCursor,
      });
      expect(next.structuredContent).toMatchObject({
        items: [{ id: '4', house: null }],
        page: { returned: 1, total: 2, hasMore: false },
      });
      expect(text(next)).toContain('Synthetic Green final');
    },
  );

  it.each(['commons', 'lords'] as const)(
    'reads %s active party values despite the upstream zero total',
    async (house) => {
      const requests = installReference(() => ({
        items: [
          {
            value: {
              id: 7,
              name: 'Synthetic Green',
              abbreviation: 'SG',
              isLordsSpiritualParty: false,
              governmentType: null,
            },
            links: [{ rel: 'self', href: '/api/Parties/7', method: 'GET' }],
          },
          { value: { id: 8, name: null, backgroundColour: '#abcdef' }, links: null },
        ],
        totalResults: 0,
      }));
      const result = await runToolContract(ukparlLookupReference, { topic: 'parties', house });
      expect(result.isError).not.toBe(true);
      expect(requests[0]!.pathname).toBe(`/api/Parties/GetActive/${house === 'commons' ? 1 : 2}`);
      expect(result.structuredContent).toMatchObject({
        items: [
          {
            id: '7',
            house,
            abbreviation: 'SG',
            isLordsSpiritualParty: false,
            governmentType: null,
            links: [{ href: '/api/Parties/7' }],
          },
          { id: '8', house, name: null, backgroundColour: '#abcdef', links: null },
        ],
        page: { returned: 2, total: 2, hasMore: false },
      });
      for (const term of [
        house,
        'SG',
        '#abcdef',
        'false',
        'null',
        '/api/Parties/7',
        'not an exhaustive historical party directory',
      ])
        expect(text(result)).toContain(term);
    },
  );

  it('keeps departments distinct from answering bodies and preserves absent/null associations', async () => {
    const requests = installReference((url) =>
      url.pathname.endsWith('/Departments')
        ? [
            {
              id: 10,
              name: 'Synthetic Department',
              url: 'https://www.gov.uk/synthetic',
              imageUrl: null,
            },
          ]
        : [
            {
              id: 20,
              name: 'Synthetic body',
              shortName: 'SB',
              target: null,
              department: {
                id: 10,
                name: 'Synthetic Department',
                url: 'https://www.gov.uk/synthetic',
                imageUrl: null,
              },
            },
            { id: 21, name: 'Independent body', department: null },
            { id: 22, name: 'Sparse body' },
          ],
    );
    const departments = await runToolContract(ukparlLookupReference, { topic: 'departments' });
    expect(departments.structuredContent).toMatchObject({
      items: [{ id: '10', url: 'https://www.gov.uk/synthetic', imageUrl: null }],
    });
    expect(text(departments)).toContain('https://www.gov.uk/synthetic');
    const bodies = await runToolContract(ukparlLookupReference, { topic: 'answering_bodies' });
    expect(bodies.isError).not.toBe(true);
    expect(bodies.structuredContent).toMatchObject({
      items: [
        {
          id: '20',
          departmentId: '10',
          department: { id: 10, imageUrl: null },
          shortName: 'SB',
          target: null,
        },
        { id: '21', department: null },
        { id: '22' },
      ],
    });
    expect(
      ukparlLookupReference.output.parse(bodies.structuredContent).items![2],
    ).not.toHaveProperty('department');
    expect(
      ukparlLookupReference.output.parse(bodies.structuredContent).items![1],
    ).not.toHaveProperty('departmentId');
    expect(requests.map((url) => url.pathname)).toEqual([
      '/api/Reference/Departments',
      '/api/Reference/AnsweringBodies',
    ]);
    for (const term of [
      'departmentId',
      'Synthetic Department',
      'Independent body',
      'Sparse body',
      'null',
      'SB',
    ])
      expect(text(bodies)).toContain(term);
  });

  it.each([
    { topic: 'parties' },
    { topic: 'bill_stages', house: 'commons' },
    { topic: 'bill_types', house: 'lords' },
    { topic: 'departments', house: 'commons' },
    { topic: 'answering_bodies', house: 'lords' },
  ] as const)('rejects topic-incompatible %j before I/O', async (input) => {
    const requests = installReference(() => []);
    const result = await runToolContract(ukparlLookupReference, input);
    expect(result.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_mode_arguments' } },
    });
    expect(text(result)).toContain('topic=identifiers');
    expect(requests).toHaveLength(0);
  });

  it('returns empty and past-end collections without manufacturing a next page', async () => {
    installReference(() => [
      { id: 1, name: 'Synthetic One' },
      { id: 2, name: 'Synthetic Two' },
    ]);
    const empty = await runToolContract(ukparlLookupReference, {
      topic: 'departments',
      nameContains: 'absent',
    });
    expect(empty.structuredContent).toMatchObject({
      items: [],
      page: { returned: 0, total: 0, hasMore: false },
      totalCount: 0,
    });
    expect(text(empty)).toContain('same topic and no nameContains filter');
    const first = await runToolContract(ukparlLookupReference, { topic: 'departments', limit: 1 });
    const cursor = decodeCursor(
      ukparlLookupReference.output.parse(first.structuredContent).page!.nextCursor!,
      CollectionCursorSchema,
    );
    const past = await runToolContract(ukparlLookupReference, {
      topic: 'departments',
      limit: 1,
      cursor: encodeCursor({ ...cursor, offset: 100 }),
    });
    expect(past.structuredContent).toMatchObject({
      items: [],
      page: { returned: 0, total: 2, hasMore: false },
    });
    expect(text(past)).toContain('/items\n[]');
  });

  it('binds collection cursors to topic, House, filter and effective limit before I/O', async () => {
    const requests = installReference(() => ({
      items: [
        { value: { id: 1, name: 'Synthetic One' } },
        { value: { id: 2, name: 'Synthetic Two' } },
      ],
      totalResults: 0,
    }));
    const first = await runToolContract(ukparlLookupReference, {
      topic: 'parties',
      house: 'commons',
      nameContains: 'synthetic',
      limit: 1,
    });
    const cursor = ukparlLookupReference.output.parse(first.structuredContent).page!.nextCursor!;
    for (const input of [
      { topic: 'parties', house: 'lords', nameContains: 'synthetic', limit: 1 },
      { topic: 'departments', nameContains: 'synthetic', limit: 1 },
      { topic: 'parties', house: 'commons', nameContains: 'other', limit: 1 },
      { topic: 'parties', house: 'commons', nameContains: 'synthetic', limit: 2 },
    ] as const) {
      const result = await runToolContract(ukparlLookupReference, { ...input, cursor });
      expect(result.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_cursor' } },
      });
      expect(text(result)).toContain('same filters and no cursor or contentCursor');
    }
    expect(requests).toHaveLength(1);
  });

  it.each([
    [
      400,
      'http_invalid_params',
      JsonRpcErrorCode.InvalidParams,
      'Repeat ukparl_lookup_reference with a valid topic and its supported filters.',
    ],
    [
      401,
      'http_unauthorized',
      JsonRpcErrorCode.Unauthorized,
      'Retry ukparl_lookup_reference later; these public reference routes require no credentials.',
    ],
    [
      403,
      'http_forbidden',
      JsonRpcErrorCode.Forbidden,
      'Retry ukparl_lookup_reference later when the public source permits access.',
    ],
    [
      409,
      'http_conflict',
      JsonRpcErrorCode.Conflict,
      'Repeat ukparl_lookup_reference with the same topic after a short wait.',
    ],
    [
      429,
      'http_rate_limited',
      JsonRpcErrorCode.RateLimited,
      'Wait before repeating ukparl_lookup_reference and reduce concurrent calls.',
    ],
    [
      302,
      'http_invalid_request',
      JsonRpcErrorCode.InvalidRequest,
      'Repeat ukparl_lookup_reference later with the same supported topic and filters.',
    ],
  ] as const)(
    'renders HTTP %s with declared recovery on both surfaces',
    async (status, reason, code, hint) => {
      vi.useFakeTimers();
      installReference(() => new Response(null, { status, headers: { 'Retry-After': '0' } }));
      const pending = runToolContract(ukparlLookupReference, { topic: 'departments' });
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code, data: { reason, recovery: { hint } } },
      });
      expect(text(result)).toContain(reason);
      expect(text(result)).toContain(hint);
    },
  );

  it('clamps safe overcap reads and advances byte-limited pages by actual whole rows', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      name: `Synthetic ${index}`,
      url: `https://www.gov.uk/${index}`,
      imageUrl: '文'.repeat(1000),
    }));
    installReference(() => rows);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await runToolContract(ukparlLookupReference, {
        topic: 'departments',
        limit: Number.MAX_SAFE_INTEGER,
        ...(cursor ? { cursor } : {}),
      });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24_000);
      const output = ukparlLookupReference.output.parse(result.structuredContent);
      expect(output.delivery).toBe('full');
      expect(output.items!.length).toBeGreaterThan(0);
      expect(output.items!.length).toBeLessThan(20);
      expect(result.structuredContent).toMatchObject({
        applied: { limit: 20 },
        requestedLimit: Number.MAX_SAFE_INTEGER,
        totalCount: 25,
      });
      for (const item of output.items!) {
        ids.push(item.id);
        expect(text(result)).toContain(JSON.stringify(item.name));
      }
      cursor = output.page!.nextCursor;
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 25 }, (_, index) => String(index + 1)));
  });

  it('reconstructs oversized reference records and filters through real bounded MCP content pages', async () => {
    const name = '🦊漢字\n"quoted"\\source```'.repeat(700);
    const nameContains = '🦊漢字'.repeat(4000);
    let recordName = `${nameContains} ${name}`;
    installReference(() => [
      { id: 7, name: recordName, url: 'https://www.gov.uk/synthetic', imageUrl: null },
    ]);
    const input = { topic: 'departments', nameContains } as const;
    let calls = 0;
    const run = async (contentCursor?: string) => {
      calls++;
      expect(calls).toBeLessThan(250);
      const result = await runToolContract(ukparlLookupReference, {
        ...input,
        ...(contentCursor ? { contentCursor } : {}),
      });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24_000);
      const output = ukparlLookupReference.output.parse(result.structuredContent);
      const encoded = [...text(result).matchAll(/(`{3,})json\n([^\n]*)\n\1/g)].map((match) =>
        JSON.parse(match[2]!),
      );
      const check = (node: unknown): void => {
        if (node !== null && typeof node === 'object')
          for (const value of Object.values(node)) check(value);
        else expect(encoded).toContainEqual(node);
      };
      check(result.structuredContent);
      return output;
    };
    const first = await run();
    expect(first.delivery).toBe('outline');
    const childCursor = first.contentPage!.entries![0]!.contentCursor;
    const rebound = await runToolContract(ukparlLookupReference, {
      ...input,
      nameContains: 'changed',
      contentCursor: childCursor,
    });
    expect(rebound.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(rebound)).toContain('same filters and no cursor or contentCursor');
    const reconstruct = async (output: Awaited<ReturnType<typeof run>>): Promise<unknown> => {
      let page = output.contentPage!;
      if (page.fragment !== undefined) {
        let value = page.fragment;
        while (page.hasMore) {
          page = (await run(page.nextCursor!)).contentPage!;
          expect(page.offset).toBe(value.length);
          value += page.fragment!;
        }
        expect(value.length).toBe(page.totalCodeUnits);
        return JSON.parse(value);
      }
      const value: Record<string, unknown> | unknown[] =
        page.kind === 'array' ? [] : Object.create(null);
      for (;;) {
        for (const entry of page.entries!) {
          const key = entry.path
            .slice(entry.path.lastIndexOf('/') + 1)
            .replaceAll('~1', '/')
            .replaceAll('~0', '~');
          Object.defineProperty(value, key, {
            value: await reconstruct(await run(entry.contentCursor)),
            enumerable: true,
          });
        }
        if (!page.hasMore) return value;
        page = (await run(page.nextCursor!)).contentPage!;
      }
    };
    expect(await reconstruct(first)).toMatchObject({
      topic: 'departments',
      nameContains,
      items: [{ id: '7', name: recordName, imageUrl: null }],
      sources: [
        {
          api: 'members',
          url: 'https://members-api.parliament.uk/api/Reference/Departments',
          licenceUrl: LICENCE_URL,
        },
      ],
      page: { returned: 1, total: 1, hasMore: false },
    });
    expect(calls).toBeGreaterThan(5);
    recordName += 'Changed source';
    const changed = await runToolContract(ukparlLookupReference, {
      ...input,
      contentCursor: childCursor,
    });
    expect(changed.structuredContent).toMatchObject({
      error: { data: { reason: 'source_changed' } },
    });
    expect(text(changed)).toContain('original filters and no contentCursor');
  });
});
