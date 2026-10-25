/**
 * @fileoverview Committee service behavior through the actual HTTP schema boundary.
 * @module tests/services/committees/committees-service.test
 */
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { disposeCommittees, getCommittees } from '@/services/committees/committees-service.js';
import {
  disposeParliamentHttp,
  getParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import {
  business,
  businessDetail,
  committee,
  committeeDetail,
  installCommittees,
  membership,
  page,
  publication,
  reconstruct,
} from './committees-fixtures.js';

afterEach(() => {
  disposeCommittees();
  disposeParliamentHttp();
});

describe('Committees source preservation', () => {
  it('reconstructs a deep committee detail including repeated IDs, nulls and missing fields', async () => {
    const raw = committeeDetail();
    const requests = installCommittees(() => raw);
    using call = getParliamentHttp().beginCall(createMockContext());
    const response = await getCommittees().detail(call, '11');
    expect(response?.data.recordId).toBe('11');
    expect(reconstruct(response!.data)).toStrictEqual(raw);
    expect(
      response!.data.entities.find(
        (node) => node.sourcePath === '/subCommittees/0/subCommittees/0',
      ),
    ).toMatchObject({ id: 13, subCommitteesPaths: null });
    expect(response!.data.entities.filter((node) => 'id' in node && node.id === 12)).toHaveLength(
      2,
    );
    expect([...requests[0]!.searchParams]).toEqual([['showOnWebsiteOnly', 'true']]);
    expect(response?.source.url).toBe(
      'https://committees-api.parliament.uk/api/Committees/11?showOnWebsiteOnly=true',
    );
  });

  it('reconstructs business detail including response recursion, submissions and evidence attendees', async () => {
    const raw = businessDetail();
    installCommittees(() => raw);
    using call = getParliamentHttp().beginCall(createMockContext());
    const response = await getCommittees().inquiry(call, '31');
    expect(response?.data.recordType).toBe('business');
    expect(reconstruct(response!.data)).toStrictEqual(raw);
    expect(
      response!.data.entities.find(
        (node) =>
          node.sourcePath ===
          '/latestReport/governmentResponses/publication/0/governmentResponses/publication/0',
      ),
    ).toMatchObject({ kind: 'PublicationSummary', id: 53, documentsPaths: null });
  });

  it('preserves publication metadata and follows no PDF, response, committee or business link', async () => {
    const raw = publication();
    const requests = installCommittees(() => raw);
    using call = getParliamentHttp().beginCall(createMockContext());
    const response = await getCommittees().publication(call, '51');
    expect(reconstruct(response!.data)).toStrictEqual(raw);
    expect(requests.map((url) => url.pathname)).toEqual(['/api/Publications/51']);
    expect(
      response!.data.entities.find((node) => node.sourcePath === '/documents/0/files/0'),
    ).toMatchObject({ url: null, fileSize: 241900, format: 'pdf' });
    expect(
      response!.data.entities
        .filter((node) => node.kind === 'CommitteeBusinessSummary')
        .map((node) => node.id),
    ).toEqual([31, 31]);
  });

  it.each(['all', 'current', 'former'] as const)(
    'preserves complete %s membership periods and the MNIS join namespace',
    async (selector) => {
      const raw = membership();
      const requests = installCommittees(() =>
        page([raw, { id: 72, personId: 900, memberInfo: null, roles: null }]),
      );
      using call = getParliamentHttp().beginCall(createMockContext());
      const response = await getCommittees().members(call, '11', selector, 2, 20);
      expect(reconstruct(response.data.items[0]!)).toStrictEqual(raw);
      expect(response.data.items[0]).toMatchObject({ recordId: '71', memberId: '99' });
      expect(response.data.items[1]).not.toHaveProperty('memberId');
      expect(reconstruct(response.data.items[1]!)).toStrictEqual({
        id: 72,
        personId: 900,
        memberInfo: null,
        roles: null,
      });
      expect([...requests[0]!.searchParams]).toEqual([
        [
          'MembershipStatus',
          selector === 'all' ? 'All' : selector === 'current' ? 'Current' : 'Former',
        ],
        ['ShowOnWebsiteOnly', 'true'],
        ['Skip', '2'],
        ['Take', '20'],
      ]);
    },
  );

  it('uses precise discovery/business/publication request allowlists without filtering non-inquiry records', async () => {
    const requests = installCommittees((url) =>
      page([
        url.pathname === '/api/Committees'
          ? committee()
          : url.pathname === '/api/CommitteeBusiness'
            ? business()
            : publication(),
      ]),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    const service = getCommittees();
    const summary = await service.search(call, { query: 'Synthetic', house: 'joint' }, 3, 10);
    expect(reconstruct(summary.data.items[0]!)).toStrictEqual(committee());
    const work = await service.inquiries(call, '11', 'scope', 4, 20);
    expect(reconstruct(work.data.items[0]!)).toStrictEqual(business());
    const pubs = await service.publications(call, '11', '31', 'report', 5, 20);
    expect(reconstruct(pubs.data.items[0]!)).toStrictEqual(publication());
    expect(requests.map((url) => [...url.searchParams])).toEqual([
      [
        ['SearchTerm', 'Synthetic'],
        ['House', 'Joint'],
        ['ShowOnWebsiteOnly', 'true'],
        ['Skip', '3'],
        ['Take', '10'],
      ],
      [
        ['CommitteeId', '11'],
        ['SearchTerm', 'scope'],
        ['ShowOnWebsiteOnly', 'true'],
        ['Skip', '4'],
        ['Take', '20'],
      ],
      [
        ['CommitteeId', '11'],
        ['CommitteeBusinessId', '31'],
        ['SearchTerm', 'report'],
        ['ShowOnWebsiteOnly', 'true'],
        ['Skip', '5'],
        ['Take', '20'],
      ],
    ]);
    expect(requests.every((url) => url.origin === 'https://committees-api.parliament.uk')).toBe(
      true,
    );
  });

  it.each(['detail', 'inquiry', 'publication'] as const)(
    'turns only a %s 404 into a miss',
    async (mode) => {
      installCommittees(() => new Response(null, { status: 404 }));
      using call = getParliamentHttp().beginCall(createMockContext());
      await expect(getCommittees()[mode](call, '999')).resolves.toBeUndefined();
    },
  );

  it('rejects invalid HTTP 200 source shape without retry or silent no-match', async () => {
    const requests = installCommittees(() => ({ id: 'not-a-number' }));
    using call = getParliamentHttp().beginCall(createMockContext());
    await expect(getCommittees().detail(call, '11')).rejects.toMatchObject({
      data: { retryable: false },
    });
    expect(requests).toHaveLength(1);
  });
});
