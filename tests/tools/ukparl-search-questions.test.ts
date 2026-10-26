/**
 * @fileoverview Written-question contracts on both MCP consumption surfaces.
 * @module tests/tools/ukparl-search-questions.test
 */
import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ukparlSearchQuestions } from '@/mcp-server/tools/definitions/ukparl-search-questions.tool.js';
import { disposeMembers } from '@/services/members/members-service.js';
import {
  advanceCollectionCursor,
  readCollectionCursor,
} from '@/services/parliament-http/parliament-cursors.js';
import {
  disposeParliamentHttp,
  getParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import { disposeQuestions, getQuestions } from '@/services/questions/questions-service.js';
import {
  installQuestions,
  item,
  page,
  question,
} from '../services/questions/questions-fixtures.js';
import { renderedPayload } from './rendered-payload.js';

function text(result: Awaited<ReturnType<typeof runToolContract>>) {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}
async function run(input: Record<string, unknown> = {}) {
  return runToolContract(ukparlSearchQuestions, input);
}
afterEach(() => {
  disposeQuestions();
  disposeMembers();
  disposeParliamentHttp();
  vi.useRealTimers();
});

describe('ukparl_search_questions', () => {
  it.each([' hl01234 ', '036068', 'not-a-question-uin'])(
    'preserves exact UIN lookup characters and distinct answering-member selection: %s',
    async (uin) => {
      const { requests } = installQuestions(() => page([{ ...question(), uin: 'HL01234' }], 4));
      const result = await run({
        uin,
        answeringMemberId: '078',
        memberId: '77',
        house: 'commons',
        tabledFrom: '2026-02-01',
        tabledTo: '2026-02-01',
        limit: 1,
      });
      expect(result.isError).not.toBe(true);
      const normalized = uin === ' hl01234 ' ? 'HL01234' : uin;
      expect(requests[0]!.searchParams.get('uIN')).toBe(normalized);
      expect(requests[0]!.searchParams.get('answeringMemberId')).toBe('78');
      expect(requests[0]!.searchParams.get('askingMemberId')).toBe('77');
      expect(requests[0]!.searchParams.get('house')).toBe('Commons');
      expect(result.structuredContent).toMatchObject({
        filters: { uin: normalized, answeringMemberId: '78', memberId: '77' },
        items: [{ questionId: '701', uin: 'HL01234' }],
        page: { total: 4, returned: 1, hasMore: true },
      });
      expect(renderedPayload(text(result))).toMatchObject({
        filters: { uin: normalized, answeringMemberId: '78' },
      });
      expect(text(result)).toContain(JSON.stringify(normalized));
    },
  );
  it('binds both new question filters through whole-record continuations without inferring House', async () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({
      ...question(701 + index),
      uin: 'HL1234',
    }));
    const { requests } = installQuestions((url) =>
      page(
        rows.slice(
          Number(url.searchParams.get('skip')),
          Number(url.searchParams.get('skip')) + Number(url.searchParams.get('take')),
        ),
        4,
      ),
    );
    const selection = { uin: 'hl1234', answeringMemberId: '78', limit: 1 };
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await run({ ...selection, ...(cursor ? { cursor } : {}) });
      expect(result.isError).not.toBe(true);
      const output = ukparlSearchQuestions.output.parse(result.structuredContent);
      expect(output.filters).toEqual({ uin: 'HL1234', answeringMemberId: '78' });
      expect(requests.at(-1)!.searchParams.has('house')).toBe(false);
      expect(requests.at(-1)!.origin).toBe('https://questions-statements-api.parliament.uk');
      ids.push(...output.items!.map((row) => row.questionId));
      cursor = output.page!.nextCursor;
      if (cursor) {
        for (const change of [{ uin: 'HL01234' }, { answeringMemberId: '79' }]) {
          const before = requests.length;
          const rebound = await run({ ...selection, ...change, cursor });
          expect(rebound.structuredContent).toMatchObject({
            error: { data: { reason: 'invalid_cursor' } },
          });
          expect(text(rebound)).toContain('no cursor or contentCursor');
          expect(requests).toHaveLength(before);
        }
      }
    } while (cursor);
    expect(ids).toEqual(['701', '702', '703', '704']);
  });
  it.each(['uin', 'answeringMemberId'])(
    'rejects search-only %s in detail and omits blank form values',
    async (field) => {
      const { requests } = installQuestions(() => item());
      const invalid = await run({ mode: 'detail', questionId: '701', [field]: '42' });
      expect(invalid.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_mode_arguments' } },
      });
      expect(text(invalid)).toContain('ukparl_lookup_reference');
      expect(requests).toEqual([]);
      const valid = await run({ mode: 'detail', questionId: '701', [field]: '   ' });
      expect(valid.isError).not.toBe(true);
      expect(requests).toHaveLength(1);
    },
  );
  it('keeps a no-match UIN successful at the cap and past the reported end', async () => {
    const { requests } = installQuestions(() => page([]));
    const selection = { uin: '036068', answeringMemberId: '78', house: 'lords' as const };
    const first = await run({ ...selection, limit: 999 });
    expect(first.structuredContent).toMatchObject({
      filters: selection,
      items: [],
      page: { total: 0, returned: 0, hasMore: false },
      cap: 20,
    });
    expect(text(first)).toContain('No questions matched');
    const cursor = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'questions',
        selector: 'search',
        filters: selection,
        nativePageSize: 20,
      }),
      99,
    );
    const past = await run({ ...selection, limit: 999, cursor });
    expect(past.isError).not.toBe(true);
    expect(past.structuredContent).toMatchObject({
      items: [],
      page: { total: 0, returned: 0, hasMore: false },
    });
    expect(requests.at(-1)!.searchParams.get('skip')).toBe('99');
    expect(requests.at(-1)!.searchParams.get('uIN')).toBe('036068');
  });
  it.each([{ uin: { value: '36068' } }, { answeringMemberId: '2147483648' }])(
    'rejects invalid new search input %j before I/O',
    async (input) => {
      const { requests } = installQuestions(() => page([]));
      const result = await run(input);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams },
      });
      expect(requests).toEqual([]);
    },
  );
  it('binds UIN and answering member to oversized search content continuations', async () => {
    installQuestions(() => page([question(701, '<p>Source HTML 文</p>'.repeat(2000))]));
    const selection = { uin: 'HL01234', answeringMemberId: '78' };
    const first = await run(selection);
    expect(first.isError).not.toBe(true);
    const root = ukparlSearchQuestions.output.parse(first.structuredContent);
    expect(root.delivery).toBe('outline');
    const contentCursor = root.contentPage!.entries![0]!.contentCursor;
    for (const change of [{ uin: 'HL1234' }, { answeringMemberId: '79' }]) {
      const rebound = await run({ ...selection, ...change, contentCursor });
      expect(rebound.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_cursor' } },
      });
      expect(text(rebound)).toContain('no cursor or contentCursor');
    }
    const valid = await run({ ...selection, contentCursor });
    expect(valid.isError).not.toBe(true);
    expect(text(valid)).toContain('ukparl_search_questions');
  });
  it.each(['tabledFrom', 'tabledTo', 'answeredFrom', 'answeredTo'])(
    'advertises the YYYY-MM-DD pattern for %s',
    (field) => {
      const schema = z.toJSONSchema(ukparlSearchQuestions.input, {
        io: 'input',
        target: 'draft-2020-12',
      });
      expect(schema.properties?.[field]).toMatchObject({
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      });
    },
  );

  it.each(['tabledFrom', 'tabledTo', 'answeredFrom', 'answeredTo'])(
    'rejects syntactically invalid %s in input validation before I/O',
    async (field) => {
      const { requests } = installQuestions(() => page([]));
      const result = await run({ [field]: '2026-1-01' });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams, data: { issues: expect.any(Array) } },
      });
      expect(text(result)).toContain(field);
      expect(requests).toEqual([]);
    },
  );
  it('rejects a natural-language date in input validation on both surfaces before I/O', async () => {
    const { requests } = installQuestions(() => page([]));
    const result = await run({ tabledTo: 'yesterday' });
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams, data: { issues: expect.any(Array) } },
    });
    expect(text(result)).toContain('tabledTo');
    expect(requests).toEqual([]);
  });
  it('returns explicit summary previews without detail hydration and echoes normalized filters', async () => {
    const preview = {
      ...question(),
      questionText: 'Question preview...',
      answerText: 'Answer preview...',
    };
    const { requests } = installQuestions(() => page([preview]));
    const result = await run({ query: ' Synthetic ', house: 'House of Commons', answered: false });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      filters: { query: 'Synthetic', house: 'commons', answered: false },
      items: [
        {
          questionId: '701',
          uin: '42',
          questionText: 'Question preview...',
          answerText: 'Answer preview...',
          detailLevel: 'summary',
        },
      ],
      applied: {
        sessionStatus: 'Any',
        questionStatus: 'AllQuestions',
        includeWithdrawn: true,
        expandMember: true,
        answerState: 'Unanswered',
      },
    });
    expect(requests).toHaveLength(1);
    for (const value of [
      'summary',
      'mode=detail',
      'questionId=701',
      'previews',
      'AllQuestions',
      'Unanswered',
      'Question preview...',
      'Answer preview...',
    ])
      expect(text(result)).toContain(value);
  });
  it('defaults detail without injecting a search limit and preserves every complete source field', async () => {
    const value = question();
    const { requests } = installQuestions(() => item(value));
    expect(
      ukparlSearchQuestions.input.parse({ mode: 'detail', questionId: '701' }).limit,
    ).toBeUndefined();
    const result = await run({ mode: 'detail', questionId: '000701' });
    expect(result.isError).not.toBe(true);
    const output = ukparlSearchQuestions.output.parse(result.structuredContent);
    expect(output).toMatchObject({
      found: true,
      record: { ...value, questionId: '701', detailLevel: 'complete' },
    });
    expect(renderedPayload(text(result))).toMatchObject({ record: value });
    for (const url of [
      'https://example.org/one.pdf',
      'https://example.org/two.csv',
      'https://example.org/member.png',
    ])
      expect(text(result)).toContain(url);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.pathname).toBe('/api/writtenquestions/questions/701');
  });
  it('preserves omitted and null fields without false answer states or attachment counts', async () => {
    installQuestions(() =>
      item({ id: 701, uin: null, answerText: null, askingMember: null, groupedQuestions: null }),
    );
    const result = await run({ mode: 'detail', questionId: '701' });
    const output = ukparlSearchQuestions.output.parse(result.structuredContent);
    expect(output.record).toMatchObject({
      answerText: null,
      askingMember: null,
      groupedQuestions: null,
    });
    for (const key of ['attachmentCount', 'isWithdrawn', 'dateAnswered', 'answerIsHolding'])
      expect(output.record).not.toHaveProperty(key);
    expect(renderedPayload(text(result))).toMatchObject({ record: { answerText: null } });
    expect(renderedPayload(text(result)).record).not.toHaveProperty('attachmentCount');
  });
  it.each([
    { mode: 'detail' },
    { questionId: '701' },
    { mode: 'detail', questionId: '701', query: 'wrong' },
    { mode: 'detail', questionId: '701', limit: 10 },
    { mode: 'detail', questionId: '701', cursor: 'bad' },
  ])('rejects incompatible mode arguments %j before I/O', async (input) => {
    const { requests } = installQuestions(() => item());
    const result = await run(input);
    expect(result.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_mode_arguments' } },
    });
    expect(text(result)).toContain('ukparl_lookup_reference');
    expect(text(result)).toContain('identifiers');
    expect(requests).toEqual([]);
  });
  it.each([
    [
      { mode: 'detail' },
      'mode=detail requires questionId; use an ID returned by mode=search, not a UIN.',
    ],
    [{ questionId: '701' }, 'mode=search does not accept questionId; omit it or use mode=detail.'],
    [
      {
        mode: 'detail',
        questionId: '701',
        answered: false,
        uin: 'HL1',
        answeringMemberId: '2',
        cursor: 'x',
        limit: 1,
      },
      'mode=detail does not accept uin, answeringMemberId, answered, cursor, limit; remove these fields or use mode=search.',
    ],
    [
      { mode: 'detail', query: 'x' },
      'mode=detail requires questionId; use an ID returned by mode=search, not a UIN. mode=detail does not accept query; remove these fields or use mode=search.',
    ],
  ])('names question conflicts on both surfaces: %j', async (input, message) => {
    const { requests } = installQuestions(() => item());
    const result = await run(input);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        message,
        data: { reason: 'invalid_mode_arguments' },
      },
    });
    expect(text(result)).toContain(message);
    expect(text(result)).toContain('topic=identifiers');
    expect(requests).toEqual([]);
  });

  it.each([{ tabledFrom: '2026-02-30' }, { answeredFrom: '2026-03-01', answeredTo: '2026-02-01' }])(
    'rejects invalid dates %j before I/O',
    async (input) => {
      const { requests } = installQuestions(() => page([]));
      const result = await run(input);
      expect(result.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_date_range' } },
      });
      expect(text(result)).toContain('coverage');
      expect(text(result)).toContain('ordered calendar dates');
      expect(requests).toEqual([]);
    },
  );
  it('normalizes blank form fields and safely caps the largest accepted integer', async () => {
    const { requests } = installQuestions(() => page([]));
    const result = await run({
      query: '',
      questionId: '',
      memberId: '',
      house: '',
      tabledFrom: '',
      tabledTo: '',
      answeredFrom: '',
      answeredTo: '',
      cursor: '',
      contentCursor: '',
      limit: Number.MAX_SAFE_INTEGER,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      items: [],
      requestedLimit: Number.MAX_SAFE_INTEGER,
      cap: 20,
      page: { returned: 0, total: 0, hasMore: false },
    });
    expect(requests[0]!.searchParams.get('take')).toBe('20');
    expect(text(result)).toContain('capped at 20');
    expect(text(result)).toContain('ukparl_search_questions');
  });
  it('validates complete references and normalizes duplicate answering-body IDs to repeated upstream keys', async () => {
    const { requests } = installQuestions((url) =>
      url.hostname.startsWith('members-')
        ? Array.from({ length: 35 }, (_, index) => ({ id: index + 1, name: `Synthetic ${index}` }))
        : page([]),
    );
    const result = await run({ answeringBodyIds: ['035', '13', '35'] });
    expect(result.isError).not.toBe(true);
    expect(requests[1]!.searchParams.getAll('answeringBodies')).toEqual(['13', '35']);
    expect(result.structuredContent).toMatchObject({ filters: { answeringBodyIds: ['13', '35'] } });
    const unknown = await run({ answeringBodyIds: ['99'] });
    expect(unknown.structuredContent).toMatchObject({
      error: { data: { reason: 'unknown_reference_id' } },
    });
    expect(text(unknown)).toContain('ukparl_lookup_reference');
    expect(text(unknown)).toContain('ID from its results');
  });
  it('returns entity 404 as a miss with numeric UIN recovery, without inventing a record', async () => {
    const { requests } = installQuestions(() => new Response(null, { status: 404 }));
    const result = await run({ mode: 'detail', questionId: '42' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ found: false, questionId: '42' });
    expect(result.structuredContent).not.toHaveProperty('record');
    expect(text(result)).toContain('UIN alone is not a questionId');
    expect(requests[0]!.pathname).toBe('/api/writtenquestions/questions/42');
  });
  it('keeps empty and past-end searches successful and supplies answering-body recovery', async () => {
    const { requests } = installQuestions(() => page([], 3));
    const cursor = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'questions',
        selector: 'search',
        filters: {},
        nativePageSize: 10,
      }),
      99,
    );
    const result = await run({ cursor });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      items: [],
      page: { total: 3, returned: 0, hasMore: false },
    });
    expect(requests[0]!.searchParams.get('skip')).toBe('99');
    expect(text(result)).toContain('ukparl_search_questions');
    expect(text(result)).toContain('topic=answering_bodies');
  });
  it('pages complete whole question records in order under the real framework byte budget', async () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      ...question(701 + index, '文🏛️'.repeat(250)),
      attachments: [],
    }));
    const { requests } = installQuestions((url) =>
      page(
        rows.slice(
          Number(url.searchParams.get('skip')),
          Number(url.searchParams.get('skip')) + Number(url.searchParams.get('take')),
        ),
        rows.length,
      ),
    );
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await run({ limit: 7, ...(cursor ? { cursor } : {}) });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
      const output = ukparlSearchQuestions.output.parse(result.structuredContent);
      expect(output.delivery).toBe('full');
      expect(requests.at(-1)!.searchParams.get('skip')).toBe(String(ids.length));
      for (const row of output.items!) {
        ids.push(row.questionId);
        expect(text(result)).toContain(JSON.stringify(row.answerText));
      }
      cursor = output.page!.nextCursor;
    } while (cursor);
    expect(ids).toEqual(['701', '702', '703', '704', '705', '706', '707']);
    expect(requests.length).toBeGreaterThan(1);
  });
  it('rejects malformed, filter-bound and source-bound collection cursors before I/O', async () => {
    const { requests } = installQuestions(() => page([question()], 2));
    const first = await run({ limit: 1 });
    const cursor = ukparlSearchQuestions.output.parse(first.structuredContent).page!.nextCursor!;
    const foreign = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'members',
        selector: 'search',
        filters: {},
        nativePageSize: 1,
      }),
      1,
    );
    for (const input of [
      { cursor: 'bad!' },
      { cursor, query: 'changed', limit: 1 },
      { cursor: foreign, limit: 1 },
    ]) {
      const result = await run(input);
      expect(result.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_cursor' } },
      });
      expect(text(result)).toContain('no cursor or contentCursor');
    }
    expect(requests).toHaveLength(1);
  });
  it('reconstructs the complete oversized escaped Unicode answer through actual content cursors', async () => {
    const answer = '<p>文🏛️ "quote" \\ slash\n\t &amp; ``` </p>'.repeat(550);
    installQuestions(() => item(question(701, answer)));
    const initial = await run({ mode: 'detail', questionId: '701' });
    expect(initial.isError).not.toBe(true);
    const root = ukparlSearchQuestions.output.parse(initial.structuredContent);
    expect(root.delivery).toBe('outline');
    async function retrieve(cursor: string): Promise<unknown> {
      let next: string | undefined = cursor;
      const fragments: string[] = [];
      const children: [string, unknown][] = [];
      let kind = '';
      do {
        const result = await run({ mode: 'detail', questionId: '701', contentCursor: next });
        expect(result.isError).not.toBe(true);
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
        const output = ukparlSearchQuestions.output.parse(result.structuredContent);
        const content = output.contentPage!;
        kind = content.kind;
        expect(text(result)).toContain('ukparl_search_questions');
        if (content.fragment !== undefined) {
          fragments.push(content.fragment);
          expect(text(result)).toContain(JSON.stringify(content.fragment));
        }
        for (const entry of content.entries ?? [])
          children.push([entry.path.split('/').at(-1)!, await retrieve(entry.contentCursor)]);
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
      reconstructed[entry.path.slice(1)] = await retrieve(entry.contentCursor);
    expect(reconstructed).toMatchObject({
      record: { ...question(701, answer), questionId: '701', detailLevel: 'complete' },
    });
  });
  it('rejects rebound content cursors and changed source revisions with both recovery surfaces', async () => {
    let answer = 'Synthetic 文'.repeat(4000);
    installQuestions(() => item(question(701, answer)));
    const first = await run({ mode: 'detail', questionId: '701' });
    const cursor = ukparlSearchQuestions.output.parse(first.structuredContent).contentPage!
      .entries![0]!.contentCursor;
    const rebound = await run({ mode: 'detail', questionId: '702', contentCursor: cursor });
    expect(rebound.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(rebound)).toContain('no cursor or contentCursor');
    answer = 'Changed answer';
    const changed = await run({ mode: 'detail', questionId: '701', contentCursor: cursor });
    expect(changed.structuredContent).toMatchObject({
      error: { data: { reason: 'source_changed' } },
    });
    expect(text(changed)).toContain('original filters');
  });
  it.each([
    [400, 'http_invalid_params', JsonRpcErrorCode.InvalidParams],
    [401, 'http_unauthorized', JsonRpcErrorCode.Unauthorized],
    [403, 'http_forbidden', JsonRpcErrorCode.Forbidden],
    [409, 'http_conflict', JsonRpcErrorCode.Conflict],
    [429, 'http_rate_limited', JsonRpcErrorCode.RateLimited],
    [302, 'http_invalid_request', JsonRpcErrorCode.InvalidRequest],
  ] as const)(
    'preserves HTTP %s and actionable recovery on both surfaces',
    async (status, reason, code) => {
      vi.useFakeTimers();
      installQuestions(() => new Response(null, { status, headers: { 'Retry-After': '0' } }));
      const pending = run();
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.structuredContent).toMatchObject({
        error: { code, data: { reason, recovery: { hint: expect.any(String) } } },
      });
      expect(text(result)).toContain('ukparl_search_questions');
    },
  );
  it('reports queue_full at the real saturated network boundary with same-tool recovery', async () => {
    let started = 0;
    let notifyStarted: (() => void) | undefined;
    const twoStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    installQuestions(
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
      getQuestions()
        .search(call, {}, 0, 10)
        .catch((error: unknown) => error),
    );
    await twoStarted;
    const result = await run();
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.RateLimited, data: { reason: 'queue_full' } },
    });
    expect(text(result)).toContain('ukparl_search_questions');
    expect(text(result)).toContain('same selection');
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
      'missing selected wrapper',
      () => Response.json({ totalResults: 0 }),
      JsonRpcErrorCode.ValidationError,
    ],
  ] as const)('keeps %s explicit instead of reporting no match', async (_name, response, code) => {
    const { requests } = installQuestions(response);
    const result = await run();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code } });
    expect(requests).toHaveLength(1);
    expect(text(result)).not.toContain('No questions matched');
  });
});
