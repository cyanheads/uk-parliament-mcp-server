/**
 * @fileoverview Written-question search and detail without search-hit hydration.
 * @module services/questions/questions-service
 */
import { invalidParams } from '@cyanheads/mcp-ts-core/errors';
import { getMembers } from '../members/members-service.js';
import {
  getParliamentHttp,
  type ParliamentCall,
  type ParliamentHttpService,
} from '../parliament-http/parliament-http-service.js';
import type { House } from '../parliament-http/parliament-models.js';
import { QuestionItemSchema, QuestionSearchSchema } from './question-models.js';

/** Normalized search selection; omitted answered remains independent of questionStatus. */
export interface QuestionsSearch {
  answered?: boolean | undefined;
  answeredFrom?: string | undefined;
  answeredTo?: string | undefined;
  answeringBodyIds?: string[] | undefined;
  answeringMemberId?: string | undefined;
  house?: House | undefined;
  memberId?: string | undefined;
  query?: string | undefined;
  tabledFrom?: string | undefined;
  tabledTo?: string | undefined;
  uin?: string | undefined;
}
/** Source adapters reuse the caller-owned deadline, including reference validation. */
export class QuestionsService {
  private readonly http: ParliamentHttpService;
  constructor(http: ParliamentHttpService) {
    this.http = http;
  }

  /** Validate against the complete Members answering-body reference before searching. */
  async search(call: ParliamentCall, input: QuestionsSearch, offset: number, take: number) {
    if (input.answeringBodyIds?.length) {
      const reference = await getMembers().answeringBodies(call);
      const known = new Set(reference.data.map((body) => String(body.id)));
      if (input.answeringBodyIds.some((id) => !known.has(id)))
        throw invalidParams(
          'An answering-body ID is absent from the complete official reference.',
          { reason: 'unknown_reference_id' },
        );
    }
    return this.http.get(
      call,
      'questions',
      '/api/writtenquestions/questions',
      QuestionSearchSchema,
      {
        searchTerm: input.query,
        uIN: input.uin,
        askingMemberId: input.memberId === undefined ? undefined : Number(input.memberId),
        answeringMemberId:
          input.answeringMemberId === undefined ? undefined : Number(input.answeringMemberId),
        answeringBodies: input.answeringBodyIds?.map(Number),
        house:
          input.house === undefined ? undefined : input.house === 'commons' ? 'Commons' : 'Lords',
        answered: input.answered === undefined ? 'Any' : input.answered ? 'Answered' : 'Unanswered',
        tabledWhenFrom: input.tabledFrom,
        tabledWhenTo: input.tabledTo,
        answeredWhenFrom: input.answeredFrom,
        answeredWhenTo: input.answeredTo,
        sessionStatus: 'Any',
        questionStatus: 'AllQuestions',
        includeWithdrawn: true,
        expandMember: true,
        skip: offset,
        take,
      },
      [
        'searchTerm',
        'uIN',
        'askingMemberId',
        'answeringMemberId',
        'answeringBodies',
        'house',
        'answered',
        'tabledWhenFrom',
        'tabledWhenTo',
        'answeredWhenFrom',
        'answeredWhenTo',
        'sessionStatus',
        'questionStatus',
        'includeWithdrawn',
        'expandMember',
        'skip',
        'take',
      ],
    );
  }

  /** Entity 404 alone becomes a successful miss; all other failures remain explicit. */
  detail(call: ParliamentCall, questionId: string) {
    return this.http.find(
      call,
      'questions',
      `/api/writtenquestions/questions/${questionId}`,
      QuestionItemSchema,
      { expandMember: true, sessionStatus: 'Any' },
      ['expandMember', 'sessionStatus'],
    );
  }
}
let service: QuestionsService | undefined;
/** Initialize after Parliament transport and Members reference service. */
export function initQuestions(http: ParliamentHttpService = getParliamentHttp()): void {
  service = new QuestionsService(http);
}
/** Access initialized question adapters. */
export function getQuestions(): QuestionsService {
  if (!service) throw new Error('Questions service not initialized; call initQuestions in setup.');
  return service;
}
/** Drop the accessor; transport owns cancellation and teardown resources. */
export function disposeQuestions(): void {
  service = undefined;
}
