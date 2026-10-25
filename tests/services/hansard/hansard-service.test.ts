/**
 * @fileoverview Spoken source mapping and lossless normalization through the real transport.
 * @module tests/services/hansard/hansard-service.test
 */
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { HansardService } from '@/services/hansard/hansard-service.js';
import {
  disposeParliamentHttp,
  getParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import { contribution, installHansard, spoken } from './hansard-fixtures.js';

afterEach(disposeParliamentHttp);
describe('HansardService', () => {
  it('preserves complete text, metadata, int64 IDs, procedural nulls and historical external IDs', async () => {
    installHansard(() =>
      spoken([
        {
          ...contribution(),
          ItemId: '9007199254740993',
          ContributionExtId: '12345678901234567890',
          MemberName: null,
          MemberId: null,
          AttributedTo: null,
        },
        { ItemId: 2, ContributionExtId: '2', ContributionText: 'Only preview' },
      ]),
    );
    const http = getParliamentHttp();
    using call = http.beginCall(createMockContext());
    const result = await new HansardService(http).search({ limit: 5 }, call);
    expect(result.payload.items[0]).toMatchObject({
      itemId: '9007199254740993',
      contributionExtId: '12345678901234567890',
      memberId: null,
      memberName: null,
      attributedTo: null,
      text: contribution().ContributionTextFull,
      preview: 'Preview only…',
      detailLevel: 'complete',
      hrsTag: 'hs_Para',
      hansardSection: 'AE-AH',
      timecode: '2005-01-10T12:34:56',
      debateSection: 'Synthetic debate',
      debateSectionId: '123',
      debateSectionExtId: 'debate/external',
      sittingDate: '2005-01-10T00:00:00',
      section: 'Commons Chamber',
      house: 'Commons',
      orderInDebateSection: 3,
      debateSectionOrder: 7,
      rank: 2,
    });
    const sparse = result.payload.items[1]!;
    expect(sparse).toMatchObject({
      itemId: '2',
      preview: 'Only preview',
      detailLevel: 'summary',
      notice: expect.stringContaining('did not supply full'),
    });
    expect(sparse).not.toHaveProperty('text');
    expect(sparse.memberId).toBeUndefined();
    expect(sparse.debateUrl).toBeUndefined();
    expect(result.payload).toMatchObject({
      spokenResultCount: 0,
      writtenResultCount: 2,
      correctionsResultCount: 3,
      divisionsResultCount: 4,
    });
  });

  it.each([null, '', undefined])(
    'does not promote preview to full text when full is %j',
    async (full) => {
      installHansard(() => spoken([{ ...contribution(), ContributionTextFull: full }]));
      const http = getParliamentHttp();
      using call = http.beginCall(createMockContext());
      const result = await new HansardService(http).search({ limit: 5 }, call);
      expect(result.payload.items[0]).toMatchObject({
        detailLevel: 'summary',
        preview: 'Preview only…',
      });
      expect(result.payload.items[0]).not.toHaveProperty('text');
    },
  );
});
