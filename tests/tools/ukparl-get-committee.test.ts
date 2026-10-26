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
  evidence,
  installCommittees,
  membership,
  page,
  publication,
  reconstruct,
  withFullCommitteeQueue,
} from '../services/committees/committees-fixtures.js';
import { renderedPayload } from './rendered-payload.js';

type Result = Awaited<ReturnType<typeof runToolContract>>;
const text = (result: Result) =>
  result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

/** Decode the complete public JSON representation and compare every payload field. */
function assertRendered(value: unknown, rendered: string): void {
  expect(
    JSON.parse(JSON.stringify(ukparlGetCommittee.output.parse(renderedPayload(rendered)))),
  ).toStrictEqual(JSON.parse(JSON.stringify(value)));
}

/** Follow the public recursive retrieval contract and reconstruct using its descriptors. */
async function retrieve(input: Record<string, unknown>, first: Result): Promise<unknown> {
  let output = ukparlGetCommittee.output.parse(first.structuredContent);
  let currentResult = first;
  expect(renderedPayload(text(first))).toEqual(JSON.parse(JSON.stringify(first.structuredContent)));
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
    expect(renderedPayload(text(currentResult))).toEqual(
      JSON.parse(JSON.stringify(currentResult.structuredContent)),
    );
    expect(current.path).toBe(initial.path);
    assertRendered(output, text(currentResult));
    if (current.fragment !== undefined) {
      expect(current.offset).toBe(fragments.length);
      fragments += current.fragment;
    }
    for (const entry of current.entries ?? []) {
      const value =
        entry.jsonValue === undefined
          ? await retrieve(
              input,
              await runToolContract(ukparlGetCommittee, {
                ...input,
                contentCursor: entry.contentCursor,
              }),
            )
          : JSON.parse(entry.jsonValue);
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
  it('characterizes accepted neighboring selectors before diagnostic changes', async () => {
    const requests = installCommittees((url) =>
      url.pathname.endsWith('/31') ? { id: 31 } : page([]),
    );
    const detail = await runToolContract(ukparlGetCommittee, {
      mode: 'inquiry',
      businessId: '31',
      committeeId: '',
      limit: undefined,
      cursor: '',
    });
    const global = await runToolContract(ukparlGetCommittee, {
      mode: 'inquiries',
      query: 'ab',
      acceptingEvidence: false,
    });
    expect(detail.isError).not.toBe(true);
    expect(detail.structuredContent).toMatchObject({ found: true, filters: { businessId: '31' } });
    expect(global.isError).not.toBe(true);
    expect(global.structuredContent).toMatchObject({
      filters: { query: 'ab', acceptingEvidence: false },
    });
    expect(requests).toHaveLength(2);
  });
  it.each([
    [{ mode: 'detail' }, 'mode=detail requires committeeId'],
    [{ mode: 'members' }, 'mode=members requires committeeId'],
    [{ mode: 'inquiry', committeeId: '11' }, 'mode=inquiry requires businessId'],
    [{ mode: 'publications', businessId: '31' }, 'mode=publications requires committeeId'],
    [{ mode: 'publication', businessId: '31' }, 'mode=publication requires publicationId'],
    [{ mode: 'evidence', evidenceType: 'written' }, 'mode=evidence requires businessId'],
    [
      { mode: 'evidence', businessId: '31' },
      'mode=evidence requires evidenceType=written or evidenceType=oral',
    ],
    [{ mode: 'evidence_detail', evidenceType: 'oral' }, 'mode=evidence_detail requires evidenceId'],
    [
      { mode: 'evidence_detail', evidenceId: '91' },
      'mode=evidence_detail requires evidenceType=written or evidenceType=oral',
    ],
    [
      { mode: 'members', committeeId: '11', house: 'commons' },
      'house is unsupported for mode=members; omit house or select mode=search',
    ],
    [
      { mode: 'search', membership: 'current' },
      'membership is unsupported for mode=search; omit membership or select mode=members',
    ],
    [
      { mode: 'inquiries', query: 'x' },
      'query in mode=inquiries requires at least 2 characters; supply a longer query or omit query',
    ],
    [
      { mode: 'publications', committeeId: '11', query: 'x' },
      'query in mode=publications requires at least 2 characters; supply a longer query or omit query',
    ],
    [
      { mode: 'publication', publicationId: '51', limit: 1 },
      'limit is unsupported for singular mode=publication; omit limit',
    ],
    [
      { mode: 'evidence_detail', evidenceId: '91', evidenceType: 'oral', cursor: 'x' },
      'cursor is unsupported for singular mode=evidence_detail; omit cursor',
    ],
    [
      { mode: 'search', status: 'Open' },
      'status="Open" is incompatible with mode=search; use Current, Former or All',
    ],
    [
      { mode: 'inquiries', status: 'Current' },
      'status="Current" is incompatible with mode=inquiries; use Open or Closed',
    ],
    [
      { mode: 'inquiries', sortOrder: 'ResponseDateAscending' },
      'sortOrder="ResponseDateAscending" is incompatible with mode=inquiries; use DateOpenedNewest, DateOpenedOldest, PublicationDateAscending or PublicationDateDescending',
    ],
    [
      { mode: 'publications', committeeId: '11', sortOrder: 'DateOpenedNewest' },
      'sortOrder="DateOpenedNewest" is incompatible with mode=publications; use PublicationDateAscending, PublicationDateDescending, ResponseDateAscending or ResponseDateDescending',
    ],
  ] as const)(
    'names the committee diagnostic and concrete repair for %j',
    async (input, message) => {
      const requests = installCommittees(() => page([]));
      const result = await runToolContract(ukparlGetCommittee, input);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.InvalidParams,
          message: expect.stringContaining(message),
          data: {
            reason: 'invalid_mode_arguments',
            recovery: {
              hint: 'Repeat ukparl_get_committee using only the fields documented for the selected mode.',
            },
          },
        },
      });
      expect(text(result)).toContain(message);
      expect(text(result)).toContain('invalid_mode_arguments');
      expect(text(result)).toContain('fields documented for the selected mode');
      expect(requests).toHaveLength(0);
    },
  );
  it('reports all committee conflicts in deterministic order', async () => {
    const requests = installCommittees(() => page([]));
    const input = {
      mode: 'evidence_detail',
      committeeId: '11',
      businessId: '31',
      query: 'x',
      limit: 1,
      cursor: 'x',
    } as const;
    const expected =
      'mode=evidence_detail requires evidenceId; supply evidenceId from mode=evidence with the same evidenceType. mode=evidence_detail requires evidenceType=written or evidenceType=oral; select the evidence namespace. query is unsupported for mode=evidence_detail; omit query or select mode=search, inquiries or publications. committeeId is unsupported for mode=evidence_detail; omit committeeId or select mode=detail, members, inquiries or publications. businessId is unsupported for mode=evidence_detail; omit businessId or select mode=inquiry, publications or evidence. cursor is unsupported for singular mode=evidence_detail; omit cursor. limit is unsupported for singular mode=evidence_detail; omit limit.';
    const result = await runToolContract(ukparlGetCommittee, input);
    expect(result.structuredContent).toMatchObject({
      error: { message: expected, data: { reason: 'invalid_mode_arguments' } },
    });
    expect(text(result)).toContain(expected);
    expect(requests).toHaveLength(0);
  });
  it('passes exact business filters globally and preserves false as unrestricted source selection', async () => {
    const requests = installCommittees(() => page([{ id: 31, type: { id: 2, isInquiry: false } }]));
    const input = {
      mode: 'inquiries',
      status: 'Open',
      acceptingEvidence: false,
      openedFrom: '2026-01-01',
      openedTo: '2026-10-01',
      sortOrder: 'DateOpenedNewest',
    } as const;
    const result = await runToolContract(ukparlGetCommittee, input);
    expect(result.isError).not.toBe(true);
    expect([...requests[0]!.searchParams]).toEqual([
      ['Status', 'Open'],
      ['CurrentlyAcceptingEvidence', 'false'],
      ['DateFrom', '2026-01-01'],
      ['DateTo', '2026-10-01'],
      ['SortOrder', 'DateOpenedNewest'],
      ['ShowOnWebsiteOnly', 'true'],
      ['Skip', '0'],
      ['Take', '20'],
    ]);
    const output = ukparlGetCommittee.output.parse(result.structuredContent);
    expect(JSON.parse(JSON.stringify(output.filters))).toEqual({
      status: 'Open',
      acceptingEvidence: false,
      openedFrom: '2026-01-01',
      openedTo: '2026-10-01',
      sortOrder: 'DateOpenedNewest',
    });
    expect(reconstruct(output.items![0]!)).toEqual({ id: 31, type: { id: 2, isInquiry: false } });
    assertRendered(output, text(result));
  });
  it('serializes publication IDs repeatedly and retains ordered source results', async () => {
    const requests = installCommittees(() =>
      page([
        { id: 52, publicationStartDate: null },
        { id: 51, publicationStartDate: null },
      ]),
    );
    const input = {
      mode: 'publications',
      committeeId: '11',
      publicationTypeIds: ['001', '2'],
      publishedFrom: '2026-01-01',
      publishedTo: '2026-10-01',
      sortOrder: 'ResponseDateDescending',
    } as const;
    const result = await runToolContract(ukparlGetCommittee, input);
    expect(result.isError).not.toBe(true);
    expect([...requests[0]!.searchParams]).toEqual([
      ['CommitteeId', '11'],
      ['SortOrder', 'ResponseDateDescending'],
      ['PublicationTypeIds', '1'],
      ['PublicationTypeIds', '2'],
      ['StartDate', '2026-01-01'],
      ['EndDate', '2026-10-01'],
      ['ShowOnWebsiteOnly', 'true'],
      ['Skip', '0'],
      ['Take', '20'],
    ]);
    const output = ukparlGetCommittee.output.parse(result.structuredContent);
    expect(output.items!.map((item) => item.recordId)).toEqual(['52', '51']);
    expect(output.filters).toMatchObject({ publicationTypeIds: ['1', '2'] });
    assertRendered(output, text(result));
  });
  it.each(['Current', 'Former', 'All'])(
    'passes committee search status %s without inferring a complement',
    async (status) => {
      const requests = installCommittees(() => page([]));
      const result = await runToolContract(ukparlGetCommittee, { status });
      expect(result.isError).not.toBe(true);
      expect(requests[0]!.searchParams.get('CommitteeStatus')).toBe(status);
      const output = ukparlGetCommittee.output.parse(result.structuredContent);
      expect(output.filters).toMatchObject({ status });
      assertRendered(output, text(result));
    },
  );
  it.each([
    ['inquiries', 'DateOpenedNewest'],
    ['inquiries', 'DateOpenedOldest'],
    ['inquiries', 'PublicationDateAscending'],
    ['inquiries', 'PublicationDateDescending'],
    ['publications', 'PublicationDateAscending'],
    ['publications', 'PublicationDateDescending'],
    ['publications', 'ResponseDateAscending'],
    ['publications', 'ResponseDateDescending'],
  ] as const)('passes %s ordering %s unchanged, including source ties', async (mode, sortOrder) => {
    const raw = [{ id: 32 }, { id: 31 }, { id: 33 }];
    const requests = installCommittees(() => page(raw));
    const result = await runToolContract(ukparlGetCommittee, {
      mode,
      committeeId: '11',
      sortOrder,
    });
    expect(result.isError).not.toBe(true);
    expect(requests[0]!.searchParams.get('SortOrder')).toBe(sortOrder);
    const output = ukparlGetCommittee.output.parse(result.structuredContent);
    expect(output.items!.map(reconstruct)).toStrictEqual(raw);
    assertRendered(output, text(result));
  });
  it.each([true, false])(
    'preserves acceptingEvidence=%s and source Open/Closed states',
    async (acceptingEvidence) => {
      const requests = installCommittees(() => page([]));
      const result = await runToolContract(ukparlGetCommittee, {
        mode: 'inquiries',
        status: 'Closed',
        acceptingEvidence,
      });
      expect(result.isError).not.toBe(true);
      expect(requests[0]!.searchParams.get('CurrentlyAcceptingEvidence')).toBe(
        String(acceptingEvidence),
      );
      expect(requests[0]!.searchParams.get('Status')).toBe('Closed');
      assertRendered(ukparlGetCommittee.output.parse(result.structuredContent), text(result));
    },
  );
  it('omits blank new selectors and preserves existing source defaults', async () => {
    const requests = installCommittees(() => page([]));
    const result = await runToolContract(ukparlGetCommittee, {
      mode: 'publications',
      committeeId: '11',
      status: ' ',
      openedFrom: '',
      openedTo: '',
      sortOrder: '',
      publishedFrom: '',
      publishedTo: '',
      publicationTypeIds: [],
    });
    expect(result.isError).not.toBe(true);
    expect([...requests[0]!.searchParams]).toEqual([
      ['CommitteeId', '11'],
      ['ShowOnWebsiteOnly', 'true'],
      ['Skip', '0'],
      ['Take', '20'],
    ]);
    expect(
      JSON.parse(JSON.stringify(ukparlGetCommittee.output.parse(result.structuredContent).filters)),
    ).toEqual({ committeeId: '11' });
  });
  it.each([
    { mode: 'search', status: 'Open' },
    { mode: 'search', sortOrder: 'DateOpenedNewest' },
    { mode: 'inquiries', status: 'Current' },
    { mode: 'inquiries', sortOrder: 'ResponseDateAscending' },
    { mode: 'inquiries', publishedFrom: '2026-01-01' },
    { mode: 'inquiries', publicationTypeIds: ['1'] },
    { mode: 'publications', committeeId: '11', sortOrder: 'DateOpenedNewest' },
    { mode: 'publications', committeeId: '11', openedTo: '2026-01-01' },
    { mode: 'publications', committeeId: '11', acceptingEvidence: false },
    { mode: 'evidence', businessId: '31', evidenceType: 'written', status: 'Open' },
    {
      mode: 'evidence_detail',
      evidenceId: '91',
      evidenceType: 'oral',
      sortOrder: 'PublicationDateAscending',
    },
    { mode: 'detail', committeeId: '11', publishedTo: '2026-01-01' },
  ] as const)(
    'rejects new wrong-mode selections %j with declared recovery before I/O',
    async (input) => {
      const requests = installCommittees(() => page([]));
      const result = await runToolContract(ukparlGetCommittee, input);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.InvalidParams,
          data: {
            reason: 'invalid_mode_arguments',
            recovery: { hint: expect.stringContaining('fields documented') },
          },
        },
      });
      expect(text(result)).toContain('invalid_mode_arguments');
      expect(text(result)).toContain('fields documented');
      expect(requests).toHaveLength(0);
    },
  );
  it.each([
    { mode: 'inquiries', openedFrom: '2026-02-01', openedTo: '2026-01-01' },
    {
      mode: 'publications',
      committeeId: '11',
      publishedFrom: '2026-02-01',
      publishedTo: '2026-01-01',
    },
  ] as const)(
    'rejects reversed date ranges %j with declared recovery before I/O',
    async (input) => {
      const requests = installCommittees(() => page([]));
      const result = await runToolContract(ukparlGetCommittee, input);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.InvalidParams,
          data: {
            reason: 'invalid_date_range',
            recovery: { hint: expect.stringContaining('starting date') },
          },
        },
      });
      expect(text(result)).toContain('invalid_date_range');
      expect(text(result)).toContain('starting date');
      expect(requests).toHaveLength(0);
    },
  );
  it.each([
    { mode: 'inquiries', openedFrom: '2026-02-30' },
    { mode: 'inquiries', openedTo: '2026-1-01' },
    { mode: 'inquiries', acceptingEvidence: 'not-a-boolean' },
    { mode: 'publications', committeeId: '11', publishedFrom: '2025-02-29' },
    { mode: 'publications', committeeId: '11', publishedTo: '2026-04-31' },
    { mode: 'publications', committeeId: '11', publicationTypeIds: ['0'] },
    { mode: 'publications', committeeId: '11', publicationTypeIds: ['1', '2147483648'] },
    { mode: 'publications', committeeId: '11', publicationTypeIds: ['1&PublicationTypeIds=2'] },
    { mode: 'publications', committeeId: '11', publicationTypeIds: [1.1] },
  ])('rejects malformed source filter %j before I/O', async (input) => {
    const requests = installCommittees(() => page([]));
    const result = await runToolContract(
      ukparlGetCommittee,
      Object.fromEntries(Object.entries(input)),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams },
    });
    expect(requests).toHaveLength(0);
  });
  it.each([
    [{ mode: 'inquiries', acceptingEvidence: 'false' }, 'CurrentlyAcceptingEvidence', 'false'],
    [
      { mode: 'publications', committeeId: '11', publicationTypeIds: [1] },
      'PublicationTypeIds',
      '1',
    ],
  ] as const)('retains framework representation repair for %j', async (input, key, expected) => {
    expect(ukparlGetCommittee.input.safeParse(input).success).toBe(false);
    const requests = installCommittees(() => page([]));
    const result = await runToolContract(
      ukparlGetCommittee,
      Object.fromEntries(Object.entries(input)),
    );
    expect(result.isError).not.toBe(true);
    expect(requests[0]!.searchParams.get(key)).toBe(expected);
    assertRendered(ukparlGetCommittee.output.parse(result.structuredContent), text(result));
  });
  it.each([
    { mode: 'search', status: 'Former' },
    {
      mode: 'inquiries',
      acceptingEvidence: true,
      status: 'Open',
      openedFrom: '2026-01-01',
      openedTo: '2026-10-01',
      sortOrder: 'DateOpenedNewest',
    },
    {
      mode: 'publications',
      committeeId: '11',
      publicationTypeIds: ['1', '2'],
      publishedFrom: '2026-01-01',
      publishedTo: '2026-10-01',
      sortOrder: 'ResponseDateDescending',
    },
  ] as const)(
    'binds every new selection %j to collection continuation and retains source paging',
    async (input) => {
      const requests = installCommittees((url) =>
        page(
          Number(url.searchParams.get('Skip')) === 0 ? [{ id: 31 }] : [],
          Number(url.searchParams.get('Skip')) === 0 ? 2 : 1,
        ),
      );
      const first = await runToolContract(ukparlGetCommittee, { ...input, limit: 1 });
      expect(first.isError).not.toBe(true);
      const cursor = ukparlGetCommittee.output.parse(first.structuredContent).page!.nextCursor!;
      for (const [key, value] of Object.entries(input)) {
        if (key === 'mode' || key === 'committeeId') continue;
        const changed =
          key === 'sortOrder'
            ? 'PublicationDateAscending'
            : typeof value === 'boolean'
              ? !value
              : Array.isArray(value)
                ? ['3']
                : key === 'status'
                  ? value === 'Open'
                    ? 'Closed'
                    : 'Current'
                  : key.endsWith('From')
                    ? '2026-02-01'
                    : '2026-09-01';
        const invalid = await runToolContract(ukparlGetCommittee, {
          ...input,
          [key]: changed,
          limit: 1,
          cursor,
        });
        expect(invalid.structuredContent).toMatchObject({
          error: { data: { reason: 'invalid_cursor' } },
        });
        expect(text(invalid)).toContain('invalid_cursor');
      }
      expect(requests).toHaveLength(1);
      const past = await runToolContract(ukparlGetCommittee, { ...input, limit: 1, cursor });
      expect(past.structuredContent).toMatchObject({
        items: [],
        page: { returned: 0, total: 1, hasMore: false },
        sourcePage: { itemsState: 'present' },
      });
      expect(requests.at(-1)!.searchParams.get('Skip')).toBe('1');
      assertRendered(ukparlGetCommittee.output.parse(past.structuredContent), text(past));
    },
  );
  it.each([
    { mode: 'search', status: 'Former' },
    {
      mode: 'inquiries',
      acceptingEvidence: true,
      status: 'Open',
      openedFrom: '2026-01-01',
      openedTo: '2026-10-01',
      sortOrder: 'DateOpenedNewest',
    },
    {
      mode: 'publications',
      committeeId: '11',
      publicationTypeIds: ['1', '2'],
      publishedFrom: '2026-01-01',
      publishedTo: '2026-10-01',
      sortOrder: 'ResponseDateDescending',
    },
  ] as const)('binds every new selection %j to recursive content continuation', async (input) => {
    const field =
      input.mode === 'search' ? 'name' : input.mode === 'inquiries' ? 'title' : 'description';
    installCommittees(() => page([{ id: 31, [field]: '<p>Preserved Ω</p> '.repeat(2000) }]));
    const first = await runToolContract(ukparlGetCommittee, { ...input, limit: 1 });
    expect(first.isError).not.toBe(true);
    const output = ukparlGetCommittee.output.parse(first.structuredContent);
    expect(output.delivery).toBe('outline');
    const contentCursor = output.contentPage!.entries![0]!.contentCursor;
    for (const [key, value] of Object.entries(input)) {
      if (key === 'mode' || key === 'committeeId') continue;
      const changed =
        key === 'sortOrder'
          ? 'PublicationDateAscending'
          : typeof value === 'boolean'
            ? !value
            : Array.isArray(value)
              ? ['3']
              : key === 'status'
                ? value === 'Open'
                  ? 'Closed'
                  : 'Current'
                : key.endsWith('From')
                  ? '2026-02-01'
                  : '2026-09-01';
      const invalid = await runToolContract(ukparlGetCommittee, {
        ...input,
        [key]: changed,
        limit: 1,
        contentCursor,
      });
      expect(invalid.structuredContent).toMatchObject({
        error: {
          data: {
            reason: 'invalid_cursor',
            recovery: { hint: expect.stringContaining('same filters') },
          },
        },
      });
      expect(text(invalid)).toContain('invalid_cursor');
    }
  });
  it.each(['written', 'oral'] as const)(
    'preserves null %s evidence collections and rejects operational/schema failures',
    async (evidenceType) => {
      const requests = installCommittees((url) =>
        url.pathname.endsWith('/91')
          ? Response.json({ id: 'invalid' })
          : url.pathname.endsWith('/92')
            ? new Response('unavailable', { status: 403 })
            : url.searchParams.get('CommitteeBusinessId') === '32'
              ? new Response('missing endpoint', { status: 404 })
              : page(null),
      );
      const empty = await runToolContract(ukparlGetCommittee, {
        mode: 'evidence',
        evidenceType,
        businessId: '31',
      });
      expect(empty.isError).not.toBe(true);
      expect(empty.structuredContent).toMatchObject({
        items: [],
        sourcePage: { itemsState: 'null' },
        page: { total: 0, returned: 0 },
      });
      assertRendered(ukparlGetCommittee.output.parse(empty.structuredContent), text(empty));
      const schemaFailure = await runToolContract(ukparlGetCommittee, {
        mode: 'evidence_detail',
        evidenceType,
        evidenceId: '91',
      });
      expect(schemaFailure.isError).toBe(true);
      expect(schemaFailure.structuredContent).not.toHaveProperty('found');
      const forbidden = await runToolContract(ukparlGetCommittee, {
        mode: 'evidence_detail',
        evidenceType,
        evidenceId: '92',
      });
      expect(forbidden.structuredContent).toMatchObject({
        error: {
          data: {
            reason: 'http_forbidden',
            recovery: { hint: expect.stringContaining('ukparl_get_committee') },
          },
        },
      });
      expect(text(forbidden)).toContain('http_forbidden');
      const missingEndpoint = await runToolContract(ukparlGetCommittee, {
        mode: 'evidence',
        evidenceType,
        businessId: '32',
      });
      expect(missingEndpoint.isError).toBe(true);
      expect(missingEndpoint.structuredContent).not.toHaveProperty('found');
      expect(requests).toHaveLength(4);
    },
  );
  it.each(['written', 'oral'] as const)(
    'retrieves complete %s evidence list/detail through both surfaces',
    async (evidenceType) => {
      const raw = evidence(evidenceType);
      const route = evidenceType === 'written' ? 'WrittenEvidence' : 'OralEvidence';
      const requests = installCommittees((url) =>
        url.pathname.endsWith('/91') ? raw : page([raw]),
      );
      for (const input of [
        { mode: 'evidence', evidenceType, businessId: '31' },
        { mode: 'evidence_detail', evidenceType, evidenceId: '91' },
      ] as const) {
        const result = await runToolContract(ukparlGetCommittee, input);
        expect(result.isError).not.toBe(true);
        const output = ukparlGetCommittee.output.parse({
          ...((await retrieve(input, result)) as object),
          delivery: 'full',
        });
        const record = output.record ?? output.items![0]!;
        expect(record.recordType).toBe(`${evidenceType}_evidence`);
        expect(reconstruct(record)).toStrictEqual(raw);
      }
      expect(requests.every((url) => url.pathname.startsWith(`/api/${route}`))).toBe(true);
      expect([...requests[0]!.searchParams]).toEqual([
        ['CommitteeBusinessId', '31'],
        ['ShowOnWebsiteOnly', 'true'],
        ['Skip', '0'],
        ['Take', '20'],
      ]);
      expect([...requests.at(-1)!.searchParams]).toEqual([['showOnWebsiteOnly', 'true']]);
    },
  );
  it.each(['written', 'oral'] as const)(
    'preserves sparse/null %s evidence and namespace-specific misses',
    async (evidenceType) => {
      const raw = { id: 91, witnesses: null, document: null, committees: [] };
      const requests = installCommittees((url) =>
        url.pathname.endsWith('/999') ? new Response('missing', { status: 404 }) : raw,
      );
      const result = await runToolContract(ukparlGetCommittee, {
        mode: 'evidence_detail',
        evidenceType,
        evidenceId: '91',
      });
      expect(result.isError).not.toBe(true);
      const output = ukparlGetCommittee.output.parse(result.structuredContent);
      expect(reconstruct(output.record!)).toStrictEqual(raw);
      assertRendered(output, text(result));
      const missing = await runToolContract(ukparlGetCommittee, {
        mode: 'evidence_detail',
        evidenceType,
        evidenceId: '999',
      });
      expect(missing.isError).not.toBe(true);
      expect(missing.structuredContent).toMatchObject({ found: false });
      expect(text(missing)).toContain('evidence mode');
      expect(requests).toHaveLength(2);
    },
  );
  it('binds evidence collection/content cursors to type and IDs and reconstructs nested oversized content', async () => {
    const raw = {
      ...evidence('written'),
      anonymousWitnessText: 'Source HTML <p>Ω</p> '.repeat(4000),
    };
    const requests = installCommittees((url) =>
      page(Number(url.searchParams.get('Skip')) === 0 ? [raw] : [], 1),
    );
    const input = {
      mode: 'evidence',
      evidenceType: 'written',
      businessId: '31',
      limit: 1,
    } as const;
    const first = await runToolContract(ukparlGetCommittee, input);
    const output = ukparlGetCommittee.output.parse({
      ...((await retrieve(input, first)) as object),
      delivery: 'full',
    });
    expect(reconstruct(output.items![0]!)).toStrictEqual(raw);
    const contentCursor = ukparlGetCommittee.output.parse(first.structuredContent).contentPage!
      .entries![0]!.contentCursor;
    const before = requests.length;
    for (const change of [{ evidenceType: 'oral' }, { businessId: '32' }, { limit: 2 }]) {
      const result = await runToolContract(ukparlGetCommittee, {
        ...input,
        ...change,
        contentCursor,
      });
      expect(result.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_cursor' } },
      });
      expect(text(result)).toContain('invalid_cursor');
    }
    // Content continuations re-read the selected source before delivery validates their binding.
    expect(requests).toHaveLength(before + 3);
  });
  it.each(['written', 'oral'] as const)(
    'handles %s evidence cap, empty and past-end pages without losing source metadata',
    async (evidenceType) => {
      let empty = false;
      const requests = installCommittees((url) =>
        page(
          empty || Number(url.searchParams.get('Skip')) > 0 ? [] : [{ id: 91 }],
          empty ? 0 : Number(url.searchParams.get('Skip')) > 0 ? 1 : 2,
        ),
      );
      const input = { mode: 'evidence', evidenceType, businessId: '31', limit: 1 } as const;
      const first = await runToolContract(ukparlGetCommittee, input);
      const cursor = ukparlGetCommittee.output.parse(first.structuredContent).page!.nextCursor!;
      const past = await runToolContract(ukparlGetCommittee, { ...input, cursor });
      expect(past.structuredContent).toMatchObject({
        items: [],
        page: { returned: 0, total: 1, hasMore: false },
        sourcePage: { itemsState: 'present' },
      });
      assertRendered(ukparlGetCommittee.output.parse(past.structuredContent), text(past));
      const before = requests.length;
      const rebound = await runToolContract(ukparlGetCommittee, {
        ...input,
        evidenceType: evidenceType === 'oral' ? 'written' : 'oral',
        cursor,
      });
      expect(rebound.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_cursor' } },
      });
      expect(requests).toHaveLength(before);
      empty = true;
      const capped = await runToolContract(ukparlGetCommittee, { ...input, limit: 100 });
      expect(capped.structuredContent).toMatchObject({
        requestedLimit: 100,
        cap: 50,
        items: [],
        page: { total: 0, returned: 0 },
      });
      expect(text(capped)).toContain('capped at 50');
      expect(requests.at(-1)!.searchParams.get('Take')).toBe('50');
    },
  );
  it('characterizes sparse publication null and omitted document metadata on both surfaces', async () => {
    const raw = {
      id: 51,
      documents: [{ documentId: 61, files: [{ url: null }] }],
      businesses: null,
    };
    installCommittees(() => raw);
    const result = await runToolContract(ukparlGetCommittee, {
      mode: 'publication',
      publicationId: '51',
    });
    const output = ukparlGetCommittee.output.parse(result.structuredContent);
    expect(reconstruct(output.record!)).toStrictEqual(raw);
    assertRendered(output, text(result));
  });
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
    { mode: 'evidence', businessId: '31' },
    { mode: 'evidence', evidenceType: 'written' },
    { mode: 'evidence', evidenceType: 'written', businessId: '31', committeeId: '11' },
    { mode: 'evidence', evidenceType: 'oral', businessId: '31', evidenceId: '91' },
    { mode: 'evidence_detail', evidenceId: '91' },
    { mode: 'evidence_detail', evidenceType: 'written' },
    { mode: 'evidence_detail', evidenceType: 'oral', evidenceId: '91', businessId: '31' },
    { mode: 'evidence_detail', evidenceType: 'oral', evidenceId: '91', limit: 1 },
    { mode: 'search', evidenceType: 'written' },
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
