/**
 * @fileoverview Written-statement contracts on both MCP consumption surfaces.
 * @module tests/tools/ukparl-search-statements.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ukparlSearchStatements } from '@/mcp-server/tools/definitions/ukparl-search-statements.tool.js';
import { disposeMembers } from '@/services/members/members-service.js';
import {
  advanceCollectionCursor,
  readCollectionCursor,
} from '@/services/parliament-http/parliament-cursors.js';
import {
  disposeParliamentHttp,
  getParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import { disposeStatements, getStatements } from '@/services/statements/statements-service.js';
import {
  answeringBodies,
  commonsStatement,
  installStatements,
  item,
  page,
  statement,
} from '../services/statements/statements-fixtures.js';
import { renderedPayload, text } from './rendered-payload.js';

async function run(input: Record<string, unknown> = {}) {
  return runToolContract(ukparlSearchStatements, input);
}
function output(result: Awaited<ReturnType<typeof runToolContract>>) {
  expect(result.isError).not.toBe(true);
  return ukparlSearchStatements.output.parse(result.structuredContent);
}
function expectFailure(
  result: Awaited<ReturnType<typeof runToolContract>>,
  reason: string,
  ...terms: string[]
) {
  expect(result.structuredContent).toMatchObject({ error: { data: { reason } } });
  for (const term of ['ukparl_search_statements', ...terms]) expect(text(result)).toContain(term);
}
/** Rows sliced by the request's own skip/take, as the source pages them. */
function paged(rows: unknown[]) {
  return (url: URL) => {
    const skip = Number(url.searchParams.get('skip'));
    return page(rows.slice(skip, skip + Number(url.searchParams.get('take'))), rows.length);
  };
}
afterEach(() => {
  disposeStatements();
  disposeMembers();
  disposeParliamentHttp();
  vi.useRealTimers();
});

describe('ukparl_search_statements', () => {
  it('maps every search input to the tabled upstream query and echoes the normalized selection', async () => {
    const { requests } = installStatements((url) =>
      url.hostname.startsWith('members-') ? answeringBodies() : page([statement()], 1),
    );
    const result = await run({
      query: ' tariff ',
      uin: ' hlws419 ',
      memberId: '04959',
      answeringBodyIds: ['035', '13', '35'],
      house: 'House of Lords',
      madeFrom: '2026-10-01',
      madeTo: '2026-10-31',
      limit: 5,
    });
    const value = output(result);
    expect(requests.map((url) => url.pathname)).toEqual([
      '/api/Reference/AnsweringBodies',
      '/api/writtenstatements/statements',
    ]);
    expect([...requests[1]!.searchParams]).toEqual([
      ['searchTerm', 'tariff'],
      ['uIN', 'HLWS419'],
      ['members', '4959'],
      ['answeringBodies', '13'],
      ['answeringBodies', '35'],
      ['house', 'Lords'],
      ['madeWhenFrom', '2026-10-01'],
      ['madeWhenTo', '2026-10-31'],
      ['sessionStatus', 'Any'],
      ['expandMember', 'true'],
      ['skip', '0'],
      ['take', '5'],
    ]);
    const filters = {
      query: 'tariff',
      uin: 'HLWS419',
      memberId: '4959',
      answeringBodyIds: ['13', '35'],
      house: 'lords',
      madeFrom: '2026-10-01',
      madeTo: '2026-10-31',
    };
    expect(value.filters).toEqual(filters);
    expect(result.structuredContent).toMatchObject({
      applied: {
        mode: 'search',
        source: 'questions',
        limit: 5,
        sessionStatus: 'Any',
        expandMember: true,
        dateSemantics: 'inclusive calendar dates; no implicit date window',
      },
    });
    const rendered = renderedPayload(text(result));
    expect(rendered.filters).toEqual(filters);
    expect(rendered.applied).toMatchObject({ sessionStatus: 'Any', expandMember: true });
  });

  it('returns flat summary records with CorrectedAnswer IDs labelled as question IDs on both surfaces', async () => {
    installStatements(() =>
      page([statement(1952546, 'Plain preview that ends...'), commonsStatement()], 2),
    );
    const result = await run();
    const value = output(result);
    expect(value.items).toEqual([
      {
        statementId: '1952546',
        uin: 'HLWS419',
        house: 'Lords',
        dateMade: '2026-10-23T00:00:00',
        title: 'Synthetic Taskforce: Government Response',
        text: 'Plain preview that ends...',
        detailLevel: 'summary',
        memberId: '4959',
        memberName: 'Synthetic Minister',
        memberRole: 'Parliamentary Under-Secretary of State (Synthetic)',
        answeringBodyId: '220',
        answeringBodyName: 'Department for Synthetic Affairs ',
        attachments: [
          {
            url: 'https://example.org/terms of reference.pdf',
            title: 'Terms of Reference',
            fileType: 'pdf',
            fileSizeBytes: 114424,
          },
        ],
        linkedStatements: [
          { linkType: 'JointStatement', statementId: '1952855', linkDate: '2026-10-26T00:00:00' },
          { linkType: 'CorrectedAnswer', questionId: '1912154', linkDate: '2026-06-03T00:00:00' },
        ],
      },
      expect.objectContaining({
        statementId: '1952855',
        uin: 'HCWS416',
        house: 'Commons',
        noticeNumber: 3,
        linkedStatements: null,
        attachments: [],
        detailLevel: 'summary',
      }),
    ]);
    for (const row of value.items!)
      for (const key of [
        'id',
        'member',
        'source',
        'links',
        'hasAttachments',
        'hasLinkedStatements',
      ])
        expect(row).not.toHaveProperty(key);
    expect(value.source).toMatchObject({ api: 'questions' });
    expect(renderedPayload(text(result)).items).toEqual(
      (result.structuredContent as { items: unknown }).items,
    );
    for (const term of ['plain-text preview', 'mode=detail with statementId', 'questionId'])
      expect(text(result)).toContain(term);
  });

  it('returns the complete detail record on both surfaces without injecting a search limit', async () => {
    const html = '<p>Complete statement HTML 文🏛️ "quoted" &amp; detail.</p>'.repeat(40);
    const { requests } = installStatements(() => item(statement(1952546, html)));
    expect(
      ukparlSearchStatements.input.parse({ mode: 'detail', statementId: '1' }).limit,
    ).toBeUndefined();
    const result = await run({ mode: 'detail', statementId: '001952546' });
    const value = output(result);
    expect(value).toMatchObject({
      delivery: 'full',
      found: true,
      statementId: '1952546',
      record: { statementId: '1952546', text: html, detailLevel: 'complete' },
      source: { api: 'questions' },
    });
    expect(value.record).not.toHaveProperty('member');
    expect(renderedPayload(text(result)).record).toEqual(
      (result.structuredContent as { record: unknown }).record,
    );
    expect(text(result)).toContain('Complete source statement HTML');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.pathname).toBe('/api/writtenstatements/statements/1952546');
  });

  it('returns a missing statementId as found=false with guidance to search first', async () => {
    const { requests } = installStatements(
      () => new Response('The resource 999999999 was not found', { status: 404 }),
    );
    const result = await run({ mode: 'detail', statementId: '999999999' });
    const value = output(result);
    expect(value).toMatchObject({ found: false, statementId: '999999999' });
    expect(value).not.toHaveProperty('record');
    expect(value.guidance).toContain('Repeat ukparl_search_statements in search mode');
    expect(text(result)).toContain('a UIN alone is not a statementId');
    expect(requests).toHaveLength(1);
  });

  it.each([{ madeFrom: '2026-10-31', madeTo: '2026-10-01' }, { madeFrom: '2026-02-30' }])(
    'rejects invalid or reversed dates %j as invalid_date_range before I/O',
    async (input) => {
      const { requests } = installStatements(() => page([]));
      const result = await run(input);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams },
      });
      expectFailure(result, 'invalid_date_range', 'topic=coverage', 'ordered calendar dates');
      expect(requests).toEqual([]);
    },
  );

  it('rejects an answering-body ID absent from the reference before the statements request', async () => {
    const { requests } = installStatements((url) =>
      url.hostname.startsWith('members-') ? answeringBodies(35) : page([]),
    );
    const result = await run({ answeringBodyIds: ['13', '999'] });
    expectFailure(result, 'unknown_reference_id', 'topic=answering_bodies');
    expect(requests.map((url) => url.pathname)).toEqual(['/api/Reference/AnsweringBodies']);
  });

  it.each([
    [
      { mode: 'detail' },
      'mode=detail requires statementId; use an ID returned by mode=search, not a UIN.',
    ],
    [
      { statementId: '1952546' },
      'mode=search does not accept statementId; omit it or use mode=detail.',
    ],
    [
      {
        mode: 'detail',
        statementId: '1952546',
        uin: 'HLWS419',
        madeFrom: '2026-10-01',
        answeringBodyIds: ['13'],
        cursor: 'x',
        limit: 1,
      },
      'mode=detail does not accept uin, answeringBodyIds, madeFrom, cursor, limit; remove these fields or use mode=search.',
    ],
    [
      { mode: 'detail', query: 'x' },
      'mode=detail requires statementId; use an ID returned by mode=search, not a UIN. mode=detail does not accept query; remove these fields or use mode=search.',
    ],
  ])('names mode conflicts on both surfaces before I/O: %j', async (input, message) => {
    const { requests } = installStatements(() => item());
    const result = await run(input);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams, message },
    });
    expectFailure(result, 'invalid_mode_arguments', message, 'topic=identifiers');
    expect(requests).toEqual([]);
  });

  it.each([
    { answeringBodyIds: Array.from({ length: 21 }, (_, index) => String(index + 1)) },
    { memberId: '2147483648' },
    { statementId: 'HLWS419', mode: 'detail' },
    { madeTo: '23/10/2026' },
  ])('rejects malformed input %j in validation before I/O', async (input) => {
    const { requests } = installStatements(() => page([]));
    const result = await run(input);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams },
    });
    expect(requests).toEqual([]);
  });

  it('defaults to ten records and clamps an over-cap limit to 100 with a notice', async () => {
    const { requests } = installStatements(() => page([]));
    const defaulted = await run();
    expect(output(defaulted)).toMatchObject({ items: [] });
    expect(requests.at(-1)!.searchParams.get('take')).toBe('10');
    expect(defaulted.structuredContent).toMatchObject({ applied: { limit: 10 }, cap: 100 });
    expect(defaulted.structuredContent).not.toHaveProperty('requestedLimit');
    for (const limit of [150, Number.MAX_SAFE_INTEGER]) {
      const capped = await run({ limit });
      expect(capped.structuredContent).toMatchObject({
        applied: { limit: 100 },
        requestedLimit: limit,
        cap: 100,
      });
      expect(requests.at(-1)!.searchParams.get('take')).toBe('100');
      expect(text(capped)).toContain(`Requested limit ${limit} is capped at 100.`);
    }
  });

  it('returns a full 100-record page whole at the cap', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      ...commonsStatement(1950000 + index),
      text: `${'Synthetic preview 文 '.repeat(12)}...`,
    }));
    installStatements(paged(rows));
    const result = await run({ limit: 100 });
    const value = output(result);
    expect(value.delivery).toBe('full');
    expect(value.items).toHaveLength(100);
    expect(value.page).toMatchObject({ returned: 100, total: 120, hasMore: true });
    expect(result.structuredContent).toMatchObject({ shown: 100, truncated: true, total: 120 });
    expect(renderedPayload(text(result)).items).toHaveLength(100);
  });

  it('walks first, second and last pages by whole records, then succeeds empty past the end', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => commonsStatement(1950000 + index));
    const { requests } = installStatements(paged(rows));
    const selection = { uin: 'hcws416', limit: 10 };
    const ids: string[] = [];
    const skips: string[] = [];
    let cursor: string | undefined;
    do {
      const value = output(await run({ ...selection, ...(cursor ? { cursor } : {}) }));
      skips.push(requests.at(-1)!.searchParams.get('skip')!);
      ids.push(...value.items!.map((row) => row.statementId));
      cursor = value.page!.nextCursor;
      if (!cursor) expect(value.page).toEqual({ returned: 5, total: 25, hasMore: false });
    } while (cursor);
    expect(skips).toEqual(['0', '10', '20']);
    expect(ids).toEqual(rows.map((row) => String(row.id)));
    const past = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'statements',
        selector: 'search',
        filters: { uin: 'HCWS416' },
        nativePageSize: 10,
      }),
      99,
    );
    const end = await run({ uin: 'HCWS416', limit: 10, cursor: past });
    expect(output(end)).toMatchObject({
      items: [],
      page: { returned: 0, total: 25, hasMore: false },
    });
    expect(requests.at(-1)!.searchParams.get('skip')).toBe('99');
    expect(text(end)).toContain('No statements matched');
  });

  it('binds collection cursors to the statement selection and rejects foreign cursors before I/O', async () => {
    const { requests } = installStatements(() => page([statement()], 2));
    const first = output(await run({ query: 'tariff', limit: 1 }));
    const cursor = first.page!.nextCursor!;
    const questions = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'questions',
        selector: 'search',
        filters: { query: 'tariff' },
        nativePageSize: 1,
      }),
      1,
    );
    for (const input of [
      { cursor: 'bad!' },
      { query: 'badger', limit: 1, cursor },
      { query: 'tariff', house: 'commons', limit: 1, cursor },
      { query: 'tariff', limit: 1, cursor: questions },
    ]) {
      // The shared cursor reader throws without a hint; this tool's declared recovery fills it.
      const hint =
        'Repeat ukparl_search_statements with the same filters and no cursor or contentCursor to start a new page sequence.';
      const result = await run(input);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.InvalidParams,
          data: { reason: 'invalid_cursor', recovery: { hint } },
        },
      });
      expect(text(result)).toContain(hint);
    }
    expect(requests).toHaveLength(1);
  });

  it('keeps an empty search successful with broadening guidance', async () => {
    installStatements(() => page([]));
    const result = await run({ query: 'zxqvbnmplk', madeFrom: '2026-10-01' });
    expect(output(result)).toMatchObject({
      items: [],
      page: { returned: 0, total: 0, hasMore: false },
      guidance: expect.stringContaining('wider date range'),
    });
    expect(text(result)).toContain('No statements matched; broaden the search');
    expect(text(result)).toContain('topic=answering_bodies');
  });

  it('normalizes blank form fields to omitted values', async () => {
    const { requests } = installStatements(() => page([]));
    const result = await run({
      query: '',
      uin: ' ',
      statementId: '',
      memberId: '',
      house: '',
      madeFrom: '',
      madeTo: '',
      cursor: '',
      contentCursor: '',
    });
    expect(output(result).filters).toEqual({});
    expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({
      sessionStatus: 'Any',
      expandMember: 'true',
      skip: '0',
      take: '10',
    });
  });

  it('reconstructs an oversized statement through its content cursors', async () => {
    const html = '<p>文🏛️ "quote" \\ slash\n\t &amp; ``` </p>'.repeat(700);
    installStatements(() => item(statement(1952546, html)));
    const input = { mode: 'detail', statementId: '1952546' };
    const root = output(await run(input));
    expect(root.delivery).toBe('outline');
    expect(root.identity).toEqual({ statementId: '1952546' });
    async function retrieve(contentCursor: string): Promise<unknown> {
      let next: string | undefined = contentCursor;
      const fragments: string[] = [];
      const children: [string, unknown][] = [];
      let kind = '';
      do {
        const result = await run({ ...input, contentCursor: next });
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
        const content = output(result).contentPage!;
        kind = content.kind;
        if (content.fragment !== undefined) fragments.push(content.fragment);
        for (const entry of content.entries ?? [])
          children.push([
            entry.path.split('/').at(-1)!,
            entry.jsonValue === undefined
              ? await retrieve(entry.contentCursor)
              : JSON.parse(entry.jsonValue),
          ]);
        next = content.nextCursor;
      } while (next);
      return fragments.length
        ? JSON.parse(fragments.join(''))
        : kind === 'array'
          ? children.map(([, value]) => value)
          : Object.fromEntries(children);
    }
    const reconstructed: Record<string, unknown> = {};
    for (const entry of root.contentPage!.entries!)
      reconstructed[entry.path.slice(1)] =
        entry.jsonValue === undefined
          ? await retrieve(entry.contentCursor)
          : JSON.parse(entry.jsonValue);
    expect(reconstructed).toMatchObject({
      found: true,
      record: { statementId: '1952546', text: html, detailLevel: 'complete' },
    });
  });

  it('rejects a changed source revision during content retrieval', async () => {
    let html = 'Synthetic 文'.repeat(4000);
    installStatements(() => item(statement(1952546, html)));
    const first = output(await run({ mode: 'detail', statementId: '1952546' }));
    const contentCursor = first.contentPage!.entries![0]!.contentCursor;
    html = 'Changed statement';
    const changed = await run({ mode: 'detail', statementId: '1952546', contentCursor });
    const hint =
      'Repeat ukparl_search_statements with its original filters and any collection cursor, but no contentCursor, then follow the new content cursors.';
    expect(changed.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.Conflict,
        data: { reason: 'source_changed', recovery: { hint } },
      },
    });
    expect(text(changed)).toContain(hint);
  });

  it.each([
    [400, 'http_invalid_params', JsonRpcErrorCode.InvalidParams],
    [401, 'http_unauthorized', JsonRpcErrorCode.Unauthorized],
    [403, 'http_forbidden', JsonRpcErrorCode.Forbidden],
    [409, 'http_conflict', JsonRpcErrorCode.Conflict],
    [429, 'http_rate_limited', JsonRpcErrorCode.RateLimited],
    [302, 'http_invalid_request', JsonRpcErrorCode.InvalidRequest],
    [500, 'http_server_error', JsonRpcErrorCode.ServiceUnavailable],
  ] as const)(
    'maps HTTP %s to %s with same-tool recovery on both surfaces',
    async (status, reason, code) => {
      vi.useFakeTimers();
      installStatements(() => new Response(null, { status, headers: { 'Retry-After': '0' } }));
      const pending = run();
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.structuredContent).toMatchObject({
        error: { code, data: { reason, recovery: { hint: expect.any(String) } } },
      });
      expectFailure(result, reason);
    },
  );

  it('reports a stalled source as call_deadline_exceeded with a narrowing hint', async () => {
    vi.useFakeTimers();
    installStatements(
      (_url, signal) =>
        new Promise<Response>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    );
    const pending = run({ query: 'government' });
    await vi.advanceTimersByTimeAsync(45_000);
    const result = await pending;
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.Timeout },
    });
    expectFailure(result, 'call_deadline_exceeded', 'madeFrom/madeTo');
  });

  it('reports a stalled detail lookup as call_deadline_exceeded, never as found=false', async () => {
    vi.useFakeTimers();
    installStatements(
      (_url, signal) =>
        new Promise<Response>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    );
    const pending = run({ mode: 'detail', statementId: '1952546' });
    await vi.advanceTimersByTimeAsync(45_000);
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.Timeout },
    });
    expect(result.structuredContent).not.toHaveProperty('found');
    expect(text(result)).not.toContain('No statement matched');
    expectFailure(result, 'call_deadline_exceeded');
  });

  it('reports queue_full at the saturated network boundary with same-tool recovery', async () => {
    let started = 0;
    let notifyStarted: (() => void) | undefined;
    const twoStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    installStatements(
      (_url, signal) =>
        new Promise<Response>((_resolve, reject) => {
          started++;
          if (started === 2) notifyStarted!();
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const controllers = Array.from({ length: 34 }, () => new AbortController());
    const calls = controllers.map((controller) =>
      getParliamentHttp().beginCall(createMockContext({ signal: controller.signal })),
    );
    const pending = calls.map((call) =>
      getStatements()
        .search(call, {}, 0, 10)
        .catch((error: unknown) => error),
    );
    await twoStarted;
    const result = await run();
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.RateLimited },
    });
    expectFailure(result, 'queue_full', 'same selection');
    for (const controller of controllers) controller.abort();
    await Promise.all(pending);
    for (const call of calls) call[Symbol.dispose]();
    expect(started).toBe(2);
  });

  it.each([
    [
      'malformed JSON',
      () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      JsonRpcErrorCode.SerializationError,
    ],
    [
      'missing results wrapper',
      () => Response.json({ totalResults: 0 }),
      JsonRpcErrorCode.ValidationError,
    ],
    [
      'page larger than requested',
      () => page(Array.from({ length: 11 }, (_, index) => statement(1950000 + index))),
      JsonRpcErrorCode.ValidationError,
    ],
    ['empty page inside the reported total', () => page([], 5), JsonRpcErrorCode.ValidationError],
  ] as const)('keeps %s explicit instead of reporting no match', async (_name, response, code) => {
    installStatements(response);
    const result = await run();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code } });
    expect(text(result)).not.toContain('No statements matched');
  });

  it('declares every shared failure with a recovery naming this tool and no per-attempt timeout', () => {
    const errors = ukparlSearchStatements.errors ?? [];
    expect(errors.map((entry) => entry.reason).sort()).toEqual([
      'call_deadline_exceeded',
      'http_conflict',
      'http_forbidden',
      'http_invalid_params',
      'http_invalid_request',
      'http_rate_limited',
      'http_server_error',
      'http_unauthorized',
      'invalid_cursor',
      'invalid_date_range',
      'invalid_mode_arguments',
      'queue_full',
      'source_changed',
      'unknown_reference_id',
    ]);
    for (const entry of errors) expect(entry.recovery).toContain('ukparl_search_statements');
    expect(errors.find((entry) => entry.reason === 'call_deadline_exceeded')).toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      thrownBy: 'service',
    });
    expect(errors.find((entry) => entry.reason === 'http_server_error')).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      thrownBy: 'service',
    });
  });
});
