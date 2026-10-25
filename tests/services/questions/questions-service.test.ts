/**
 * @fileoverview Written-question adapter tests at the Parliament exchange boundary.
 * @module tests/services/questions/questions-service.test
 */
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { disposeMembers } from '@/services/members/members-service.js';
import {
  disposeParliamentHttp,
  getParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import { disposeQuestions, getQuestions } from '@/services/questions/questions-service.js';
import { installQuestions, item, page } from './questions-fixtures.js';

afterEach(() => {
  disposeQuestions();
  disposeMembers();
  disposeParliamentHttp();
});
describe('QuestionsService', () => {
  it.each([
    [undefined, 'Any'],
    [true, 'Answered'],
    [false, 'Unanswered'],
  ] as const)(
    'maps answered=%s independently from all-status scope',
    async (answered, expected) => {
      const { requests } = installQuestions(() => page([]));
      using call = getParliamentHttp().beginCall(createMockContext());
      await getQuestions().search(
        call,
        {
          answered,
          house: 'lords',
          memberId: '77',
          query: 'evidence',
          tabledFrom: '2026-02-01',
          tabledTo: '2026-02-28',
          answeredFrom: '2026-02-02',
          answeredTo: '2026-03-01',
        },
        5,
        10,
      );
      expect(requests[0]!.origin).toBe('https://questions-statements-api.parliament.uk');
      expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({
        searchTerm: 'evidence',
        askingMemberId: '77',
        house: 'Lords',
        answered: expected,
        tabledWhenFrom: '2026-02-01',
        tabledWhenTo: '2026-02-28',
        answeredWhenFrom: '2026-02-02',
        answeredWhenTo: '2026-03-01',
        sessionStatus: 'Any',
        questionStatus: 'AllQuestions',
        includeWithdrawn: 'true',
        expandMember: 'true',
        skip: '5',
        take: '10',
      });
    },
  );
  it('reads the complete answering-body directory before passing repeated IDs upstream within the same call', async () => {
    const { requests, signals } = installQuestions((url) =>
      url.hostname.startsWith('members-')
        ? Array.from({ length: 35 }, (_, index) => ({
            id: index + 1,
            name: `Synthetic ${index}`,
            department: null,
          }))
        : page([]),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    await getQuestions().search(call, { answeringBodyIds: ['13', '35'] }, 0, 10);
    expect(requests.map((url) => url.pathname)).toEqual([
      '/api/Reference/AnsweringBodies',
      '/api/writtenquestions/questions',
    ]);
    expect(requests[1]!.searchParams.getAll('answeringBodies')).toEqual(['13', '35']);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });
  it('rejects unknown answering bodies after the full authoritative read without searching', async () => {
    const { requests } = installQuestions(() => [{ id: 13, name: 'Synthetic', department: null }]);
    using call = getParliamentHttp().beginCall(createMockContext());
    await expect(
      getQuestions().search(call, { answeringBodyIds: ['99'] }, 0, 10),
    ).rejects.toMatchObject({ data: { reason: 'unknown_reference_id' } });
    expect(requests).toHaveLength(1);
  });
  it('keeps detail identifiers distinct from numeric UINs and requests expanded members', async () => {
    const { requests } = installQuestions(() => item());
    using call = getParliamentHttp().beginCall(createMockContext());
    const result = await getQuestions().detail(call, '701');
    expect(result!.data.value.uin).toBe('42');
    expect(requests[0]!.pathname).toBe('/api/writtenquestions/questions/701');
    expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({
      expandMember: 'true',
      sessionStatus: 'Any',
    });
  });
});
