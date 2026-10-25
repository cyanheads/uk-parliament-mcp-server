/**
 * @fileoverview Synthetic Spoken API records and network-only test boundary.
 * @module tests/services/hansard/hansard-fixtures
 */
import { initHansardService } from '@/services/hansard/hansard-service.js';
import { initParliamentHttp } from '@/services/parliament-http/parliament-http-service.js';

/** Complete wire record with distinct preview, source HTML, and ordering metadata. */
export function contribution(id = 1) {
  return {
    ItemId: id,
    ContributionExtId: `external-${id}`,
    MemberName: 'Synthetic speaker',
    MemberId: 42,
    AttributedTo: '  Attribution  ',
    ContributionText: 'Preview only…',
    ContributionTextFull: ` <p>Complete ${id} &amp; source\n"文🏛️"</p> `,
    HRSTag: 'hs_Para',
    HansardSection: 'AE-AH',
    Timecode: '2005-01-10T12:34:56',
    DebateSection: 'Synthetic debate',
    DebateSectionId: 123,
    DebateSectionExtId: 'debate/external',
    SittingDate: '2005-01-10T00:00:00',
    Section: 'Commons Chamber',
    House: 'Commons',
    OrderInDebateSection: 3,
    DebateSectionOrder: 7,
    Rank: 2,
  };
}

/** Raw Spoken wrapper, distinct from the mixed full-search endpoint. */
export function spoken(Results: unknown[], TotalResultCount = Results.length) {
  return {
    Results,
    TotalResultCount,
    SearchTerms: ['synthetic'],
    SpokenResultCount: 0,
    WrittenResultCount: 2,
    CorrectionsResultCount: 3,
    DivisionsResultCount: 4,
  };
}

/** Install only a fake network exchange; normalization and delivery remain production code. */
export function installHansard(route: (url: URL) => unknown | Response) {
  const requests: URL[] = [];
  initParliamentHttp({
    exchange: async (url) => {
      requests.push(new URL(url));
      const value = route(url);
      return value instanceof Response ? value : Response.json(value);
    },
  });
  initHansardService();
  return requests;
}
