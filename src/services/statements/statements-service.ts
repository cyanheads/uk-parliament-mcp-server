/**
 * @fileoverview Written ministerial statement search and detail without search-hit hydration.
 * @module services/statements/statements-service
 */
import { assertKnownAnsweringBodies } from '../parliament-http/answering-body-filter.js';
import {
  getParliamentHttp,
  type ParliamentCall,
  type ParliamentHttpService,
} from '../parliament-http/parliament-http-service.js';
import type { House } from '../parliament-http/parliament-models.js';
import { StatementItemSchema, StatementSearchSchema } from './statement-models.js';

/** Normalized search selection; every field narrows the source search. */
export interface StatementsSearch {
  answeringBodyIds?: string[] | undefined;
  house?: House | undefined;
  madeFrom?: string | undefined;
  madeTo?: string | undefined;
  memberId?: string | undefined;
  query?: string | undefined;
  uin?: string | undefined;
}
/** Source adapters reuse the caller-owned deadline, including reference validation. */
export class StatementsService {
  private readonly http: ParliamentHttpService;
  constructor(http: ParliamentHttpService) {
    this.http = http;
  }

  /** Validate answering bodies against the complete reference before the statements request. */
  async search(call: ParliamentCall, input: StatementsSearch, offset: number, take: number) {
    if (input.answeringBodyIds?.length)
      await assertKnownAnsweringBodies(call, input.answeringBodyIds);
    return this.http.get(
      call,
      'questions',
      '/api/writtenstatements/statements',
      StatementSearchSchema,
      {
        searchTerm: input.query,
        uIN: input.uin,
        members: input.memberId === undefined ? undefined : [Number(input.memberId)],
        answeringBodies: input.answeringBodyIds?.map(Number),
        house:
          input.house === undefined ? undefined : input.house === 'commons' ? 'Commons' : 'Lords',
        madeWhenFrom: input.madeFrom,
        madeWhenTo: input.madeTo,
        sessionStatus: 'Any',
        expandMember: true,
        skip: offset,
        take,
      },
      [
        'searchTerm',
        'uIN',
        'members',
        'answeringBodies',
        'house',
        'madeWhenFrom',
        'madeWhenTo',
        'sessionStatus',
        'expandMember',
        'skip',
        'take',
      ],
    );
  }

  /** Entity 404 alone becomes a successful miss; all other failures remain explicit. */
  detail(call: ParliamentCall, statementId: string) {
    return this.http.find(
      call,
      'questions',
      `/api/writtenstatements/statements/${statementId}`,
      StatementItemSchema,
      { expandMember: true, sessionStatus: 'Any' },
      ['expandMember', 'sessionStatus'],
    );
  }
}
let service: StatementsService | undefined;
/** Initialize after Parliament transport and Members reference service. */
export function initStatements(http: ParliamentHttpService = getParliamentHttp()): void {
  service = new StatementsService(http);
}
/** Access initialized statement adapters. */
export function getStatements(): StatementsService {
  if (!service)
    throw new Error('Statements service not initialized; call initStatements in setup.');
  return service;
}
/** Drop the accessor; transport owns cancellation and teardown resources. */
export function disposeStatements(): void {
  service = undefined;
}
