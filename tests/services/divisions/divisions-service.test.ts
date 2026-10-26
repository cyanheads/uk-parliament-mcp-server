/**
 * @fileoverview House-specific transport and roster semantics through real division services.
 * @module tests/services/divisions/divisions-service.test
 */
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DivisionsService } from '@/services/divisions/divisions-service.js';
import {
  disposeParliamentHttp,
  getParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import { commonsDivision, installDivisions, lordsDivision } from './divisions-fixtures.js';

afterEach(disposeParliamentHttp);

describe('DivisionsService', () => {
  it.each(['commons', 'lords'] as const)(
    'uses %s member wrappers without losing metadata',
    async (house) => {
      const requests = installDivisions(() =>
        house === 'commons'
          ? [
              {
                MemberId: 1,
                MemberVotedAye: false,
                MemberVotedNo: true,
                MemberWasTeller: true,
                PublishedDivision: commonsDivision(),
              },
            ]
          : [
              {
                memberId: 1,
                memberWasContent: false,
                memberWasTeller: true,
                publishedDivision: lordsDivision(),
              },
            ],
      );
      const http = getParliamentHttp();
      using call = http.beginCall(createMockContext());
      const result = await new DivisionsService(http).execute(
        { house, mode: 'search', memberId: '1', limit: 5 },
        call,
      );
      expect(requests[0]!.pathname).toBe(
        house === 'commons' ? '/data/divisions.json/membervoting' : '/data/Divisions/membervoting',
      );
      expect(result.payload.items![0]).toMatchObject({
        divisionId: '42',
        memberVote: {
          memberId: '1',
          lobby: house === 'commons' ? 'no' : 'not_content',
          wasTeller: true,
        },
      });
      expect(result.payload.page).toEqual({ returned: 1, hasMore: false });
    },
  );
  it('keeps no-member search summaries on the legacy route without a total', async () => {
    const requests = installDivisions(() => [commonsDivision()]);
    const http = getParliamentHttp();
    using call = http.beginCall(createMockContext());
    const result = await new DivisionsService(http).execute(
      { house: 'commons', mode: 'search', limit: 5 },
      call,
    );
    expect(requests[0]!.pathname).toBe('/data/divisions.json/search');
    expect(result.payload.items![0]).toMatchObject({ divisionId: '42', noCount: null });
    expect(result.payload.items![0]).not.toHaveProperty('memberVote');
    expect(result.payload.page).toEqual({ returned: 1, hasMore: false });
  });
  it.each(['commons', 'lords'] as const)(
    'keeps %s IDs scoped to the selected source',
    async (house) => {
      const requests = installDivisions(() =>
        house === 'commons' ? commonsDivision() : lordsDivision(),
      );
      const http = getParliamentHttp();
      using call = http.beginCall(createMockContext());
      const result = await new DivisionsService(http).execute(
        { house, mode: 'detail', divisionId: '42', limit: 20 },
        call,
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]!.href).toBe(
        house === 'commons'
          ? 'https://commonsvotes-api.parliament.uk/data/division/42.json'
          : 'https://lordsvotes-api.parliament.uk/data/Divisions/42',
      );
      expect(result.payload.record).toMatchObject({
        divisionId: '42',
        detailLevel: 'complete',
        sourceUrl: `https://votes.parliament.uk/Votes/${house === 'commons' ? 'Commons' : 'Lords'}/Division/42`,
      });
    },
  );

  it('counts Commons tellers once, preserves unknown parties and separates not_recorded', async () => {
    installDivisions(() => commonsDivision());
    const http = getParliamentHttp();
    using call = http.beginCall(createMockContext());
    const result = await new DivisionsService(http).execute(
      { house: 'commons', mode: 'party_totals', divisionId: '42', limit: 20 },
      call,
    );
    expect(result.payload.partyTotals).toEqual([
      { party: 'Synthetic Labour', lobby: 'aye', voterCount: 1, tellerCount: 2 },
      { party: null, lobby: 'aye', voterCount: 2, tellerCount: 0 },
      { party: 'Synthetic Labour Co-operative', lobby: 'no', voterCount: 1, tellerCount: 0 },
      { party: 'Synthetic Labour', lobby: 'not_recorded', voterCount: 1, tellerCount: 0 },
    ]);
    expect(result.payload.record).toMatchObject({
      ayeCount: 101,
      noCount: null,
      doubleMajorityAyeCount: 0,
    });
    expect(result.payload.record!.tellers!.map((voter) => voter.memberId)).toEqual(['2', '5']);
  });

  it('preserves Lords official totals separately from independently counted roster groups', async () => {
    installDivisions(() => lordsDivision());
    const http = getParliamentHttp();
    using call = http.beginCall(createMockContext());
    const result = await new DivisionsService(http).execute(
      { house: 'lords', mode: 'party_totals', divisionId: '42', limit: 20 },
      call,
    );
    expect(result.payload.partyTotals).toEqual([
      { party: 'Crossbench', lobby: 'content', voterCount: 1, tellerCount: 1 },
      { party: null, lobby: 'content', voterCount: 1, tellerCount: 0 },
      { party: undefined, lobby: 'not_content', voterCount: 1, tellerCount: 0 },
      { party: 'Crossbench Independent', lobby: 'not_content', voterCount: 1, tellerCount: 0 },
      { party: 'Crossbench', lobby: 'not_content', voterCount: 0, tellerCount: 1 },
    ]);
    expect(result.payload.record).toMatchObject({
      authoritativeContentCount: 90,
      authoritativeNotContentCount: 91,
      memberContentCount: 88,
      memberNotContentCount: 89,
      tellerContentCount: 90,
      tellerNotContentCount: 91,
    });
    expect(
      result.payload.record!.tellers!.map((voter) => [voter.memberId, voter.isTeller]),
    ).toEqual([
      ['12', true],
      ['16', true],
    ]);
  });
});
