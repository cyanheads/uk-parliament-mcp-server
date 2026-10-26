/**
 * @fileoverview Spoken Hansard query mapping, lossless normalization and source pagination.
 * @module services/hansard/hansard-service
 */
import type { z } from '@cyanheads/mcp-ts-core';
import { validationError } from '@cyanheads/mcp-ts-core/errors';
import {
  invalidCursor,
  pageFor,
  readCollectionCursor,
} from '../parliament-http/parliament-cursors.js';
import {
  getParliamentHttp,
  type ParliamentCall,
  type ParliamentHttpService,
} from '../parliament-http/parliament-http-service.js';
import type { House, Source } from '../parliament-http/parliament-models.js';
import {
  HansardItemSchema,
  type RawHansardItemSchema,
  RawHansardSearchSchema,
} from './hansard-schemas.js';

/** Normalized search filters; date bounds are never inferred. */
export interface HansardSearchInput {
  cursor?: string | undefined;
  debateSectionId?: string | undefined;
  endDate?: string | undefined;
  house?: House | undefined;
  limit: number;
  memberId?: string | undefined;
  query?: string | undefined;
  startDate?: string | undefined;
}
function normalize(raw: z.infer<typeof RawHansardItemSchema>, source: Source) {
  const {
    ItemId,
    ContributionExtId,
    ContributionTextFull,
    ContributionText,
    MemberId,
    DebateSectionId,
    ...rest
  } = raw;
  const full = Boolean(ContributionTextFull);
  return HansardItemSchema.parse({
    itemId: String(ItemId),
    contributionExtId: ContributionExtId,
    ...(MemberId !== undefined
      ? MemberId === null
        ? { memberId: null }
        : Number(MemberId) <= 0
          ? { memberId: null, sourceMemberId: String(MemberId) }
          : { memberId: String(MemberId) }
      : {}),
    ...(DebateSectionId !== undefined
      ? { debateSectionId: DebateSectionId === null ? null : String(DebateSectionId) }
      : {}),
    ...(full
      ? { text: ContributionTextFull }
      : {
          notice:
            'The Spoken API did not supply full contribution text. This summary preserves only the source preview; follow the official contribution link to inspect the published record.',
        }),
    ...(ContributionText !== undefined ? { preview: ContributionText } : {}),
    memberName: rest.MemberName,
    attributedTo: rest.AttributedTo,
    hrsTag: rest.HRSTag,
    hansardSection: rest.HansardSection,
    timecode: rest.Timecode,
    debateSection: rest.DebateSection,
    debateSectionExtId: rest.DebateSectionExtId,
    sittingDate: rest.SittingDate,
    section: rest.Section,
    house: rest.House,
    orderInDebateSection: rest.OrderInDebateSection,
    debateSectionOrder: rest.DebateSectionOrder,
    rank: rest.Rank,
    textFormat: 'source_html_or_text',
    detailLevel: full ? 'complete' : 'summary',
    contributionUrl: `https://hansard-api.parliament.uk/search/parlisearchredirect.json?externalId=${encodeURIComponent(ContributionExtId)}`,
    ...(rest.DebateSectionExtId
      ? {
          debateUrl: `https://hansard-api.parliament.uk/search/parlisearchredirect.json?externalId=${encodeURIComponent(rest.DebateSectionExtId)}`,
        }
      : {}),
    source,
  });
}
/** Stateless source adapter; all calls share the transport's deadlines and origin backpressure. */
export class HansardService {
  private readonly http: ParliamentHttpService;
  constructor(http: ParliamentHttpService) {
    this.http = http;
  }

  /** Search Spoken contributions without claiming this is a complete debate transcript. */
  async search(input: HansardSearchInput, call: ParliamentCall) {
    const { cursor: cursorText, limit, ...filters } = input;
    const cursor = readCollectionCursor(cursorText, {
      source: 'hansard',
      selector: 'spoken',
      filters,
      nativePageSize: limit,
    });
    if (cursor.nativePage !== undefined || cursor.intraPageOffset !== undefined)
      return invalidCursor();
    const query = {
      'queryParameters.searchTerm': input.query,
      'queryParameters.memberId': input.memberId === undefined ? undefined : Number(input.memberId),
      'queryParameters.house':
        input.house === undefined ? undefined : input.house === 'commons' ? 'Commons' : 'Lords',
      'queryParameters.startDate': input.startDate,
      'queryParameters.endDate': input.endDate,
      'queryParameters.debateSectionId':
        input.debateSectionId === undefined ? undefined : Number(input.debateSectionId),
      'queryParameters.skip': cursor.offset,
      'queryParameters.take': limit,
      'queryParameters.outputType': 'List',
    };
    const result = await this.http.get(
      call,
      'hansard',
      '/search/contributions/Spoken.json',
      RawHansardSearchSchema,
      query,
      Object.keys(query),
    );
    if (result.data.Results.length === 0 && cursor.offset < result.data.TotalResultCount)
      throw validationError(
        'Hansard returned an empty page before its reported pagination total. Repeat ukparl_search_hansard with the same filters and no cursor or contentCursor to restart pagination; if the inconsistency persists, retry later.',
        { retryable: false },
      );
    const items = result.data.Results.map((raw) => normalize(raw, result.source));
    const repage = (count: number) => ({
      ...(input.query ? { query: input.query } : {}),
      source: result.source,
      items: items.slice(0, count),
      page: pageFor(cursor, count, result.data.TotalResultCount),
      ...(result.data.SearchTerms !== undefined ? { searchTerms: result.data.SearchTerms } : {}),
      ...(result.data.SpokenResultCount !== undefined
        ? { spokenResultCount: result.data.SpokenResultCount }
        : {}),
      ...(result.data.WrittenResultCount !== undefined
        ? { writtenResultCount: result.data.WrittenResultCount }
        : {}),
      ...(result.data.CorrectionsResultCount !== undefined
        ? { correctionsResultCount: result.data.CorrectionsResultCount }
        : {}),
      ...(result.data.DivisionsResultCount !== undefined
        ? { divisionsResultCount: result.data.DivisionsResultCount }
        : {}),
    });
    return { payload: repage(items.length), count: items.length, repage };
  }
}
let service: HansardService | undefined;
/** Initialize after the shared transport; there is no owned timer or teardown requirement. */
export function initHansardService(http: ParliamentHttpService = getParliamentHttp()): void {
  service = new HansardService(http);
}
/** Access the initialized Spoken adapter. */
export function getHansardService(): HansardService {
  if (!service)
    throw new Error('Hansard service not initialized; call initHansardService in setup.');
  return service;
}
