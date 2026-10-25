/**
 * @fileoverview Bills source selection, paging and normalization through real HTTP validation.
 * @module tests/services/bills/bills-service.test
 */
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { disposeBillsService, getBillsService } from '@/services/bills/bills-service.js';
import {
  CollectionCursorSchema,
  decodeCursor,
  encodeCursor,
} from '@/services/parliament-http/parliament-cursors.js';
import {
  disposeParliamentHttp,
  getParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import {
  amendment,
  amendmentDetail,
  bill,
  installBills,
  motion,
  page,
  publication,
  stage,
} from './bills-fixtures.js';

afterEach(() => {
  disposeBillsService();
  disposeParliamentHttp();
});

describe('BillsService authoritative queries', () => {
  it('reads every reference page then uses only exact verified query keys and repeated arrays', async () => {
    const requests = installBills((url) => {
      if (url.pathname === '/api/v1/Stages')
        return url.searchParams.get('Skip') === '0'
          ? page([{ id: 7, name: 'First' }], 2)
          : page([{ id: 8, name: 'Second' }], 2);
      if (url.pathname === '/api/v1/BillTypes') return page([{ id: 9 }, { id: 10 }]);
      if (url.pathname === '/api/v1/Bills') return page([bill()]);
      throw new Error(`Unexpected route ${url}`);
    });
    using call = getParliamentHttp().beginCall(createMockContext());
    const result = await getBillsService().search(
      {
        query: 'Synthetic & Bill',
        house: 'lords',
        sessionId: '35',
        memberId: '77',
        stageIds: ['7', '8'],
        billTypeIds: ['9', '10'],
        limit: 2,
      },
      call,
    );
    expect(requests.map((url) => url.pathname)).toEqual([
      '/api/v1/Stages',
      '/api/v1/Stages',
      '/api/v1/BillTypes',
      '/api/v1/Bills',
    ]);
    expect([...requests[1]!.searchParams]).toEqual([
      ['Skip', '1'],
      ['Take', '100'],
    ]);
    expect([...requests[3]!.searchParams]).toEqual([
      ['SearchTerm', 'Synthetic & Bill'],
      ['CurrentHouse', 'Lords'],
      ['Session', '35'],
      ['MemberId', '77'],
      ['BillStage', '7'],
      ['BillStage', '8'],
      ['BillType', '9'],
      ['BillType', '10'],
      ['Skip', '0'],
      ['Take', '2'],
    ]);
    expect(requests.every((url) => url.origin === 'https://bills-api.parliament.uk')).toBe(true);
    expect(result.payload.items[0]).toMatchObject({
      billId: '11',
      includedSessionIds: ['34', '35'],
      currentStage: {
        id: '101',
        stageId: '7',
        house: 'unassigned',
        stageSittings: [{ id: '201' }, { id: '202' }],
      },
      detailLevel: 'summary',
    });
  });

  it('rejects a reference ID only after reading the complete authoritative set', async () => {
    const requests = installBills((url) =>
      url.searchParams.get('Skip') === '0' ? page([{ id: 7 }], 2) : page([{ id: 8 }], 2),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    await expect(
      getBillsService().search({ stageIds: ['99'], limit: 10 }, call),
    ).rejects.toMatchObject({ data: { reason: 'unknown_reference_id' } });
    expect(requests.map((url) => url.pathname)).toEqual(['/api/v1/Stages', '/api/v1/Stages']);
  });

  it('does not turn an incomplete reference page into an unknown-ID verdict', async () => {
    installBills(() => page([], 4));
    using call = getParliamentHttp().beginCall(createMockContext());
    await expect(getBillsService().references('bill_types', call)).rejects.toThrow(
      'pagination ended',
    );
  });

  it('advances by emitted rows and rejects changed filter bindings before search I/O', async () => {
    const requests = installBills((url) =>
      page([bill(Number(url.searchParams.get('Skip')) + 11)], 3),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    const first = await getBillsService().search({ query: 'Synthetic', limit: 1 }, call);
    const cursor = first.payload.page.nextCursor!;
    const second = await getBillsService().search({ query: 'Synthetic', limit: 1, cursor }, call);
    expect(second.payload.items[0]?.billId).toBe('12');
    expect(requests[1]?.searchParams.get('Skip')).toBe('1');
    await expect(
      getBillsService().search({ query: 'Changed', limit: 1, cursor }, call),
    ).rejects.toMatchObject({ data: { reason: 'invalid_cursor' } });
    expect(requests).toHaveLength(2);
  });
});

describe('BillsService selected complete records', () => {
  it('pages publications locally, preserves all links/files and finds only supplied statute URLs', async () => {
    const requests = installBills((url) =>
      url.pathname.endsWith('/Publications')
        ? { billId: 11, publications: [publication(), publication(302), publication(303)] }
        : { ...bill(), isAct: true },
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    const first = await getBillsService().get(
      { billId: '11', section: 'publications', limit: 2 },
      call,
    );
    expect(first.payload).toMatchObject({
      items: [
        {
          id: '301',
          house: 'unassigned',
          links: [{ id: '401' }, { id: '402' }],
          files: [{ id: '501' }, { id: '502', downloadUrl: null }],
        },
        { id: '302' },
      ],
      page: { returned: 2, total: 3, hasMore: true },
      legislationHandoff: {
        status: 'authoritative_link',
        links: expect.arrayContaining([
          expect.objectContaining({
            url: 'https://www.legislation.gov.uk/ukpga/2026/1/contents',
            documentId: '402',
          }),
        ]),
      },
    });
    const last = await getBillsService().get(
      { billId: '11', section: 'publications', limit: 2, cursor: first.payload.page!.nextCursor! },
      call,
    );
    expect(last.payload).toMatchObject({
      items: [{ id: '303' }],
      page: { returned: 1, total: 3, hasMore: false },
    });
    expect(last.payload.page).not.toHaveProperty('nextCursor');
    expect(
      requests
        .filter((url) => url.pathname.endsWith('/Publications'))
        .every((url) => url.search === ''),
    ).toBe(true);
  });

  it.each([
    ['stages', undefined, '/api/v1/Bills/11/Stages', stage()],
    ['amendments', '101', '/api/v1/Bills/11/Stages/101/Amendments', amendment()],
    [
      'motions',
      '101',
      '/api/v1/Bills/11/Stages/101/PingPongItems',
      { type: 'Motion', motion: { id: 601, summary: 'A motion' } },
    ],
  ] as const)('reads only %s using native Skip/Take', async (section, billStageId, path, row) => {
    const requests = installBills((url) =>
      url.pathname === '/api/v1/Bills/11' ? bill() : page([row], 3),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    const result = await getBillsService().get(
      { billId: '11', section, billStageId, limit: 1 },
      call,
    );
    expect(requests.map((url) => url.pathname)).toEqual(['/api/v1/Bills/11', path]);
    expect([...requests[1]!.searchParams]).toEqual([
      ['Skip', '0'],
      ['Take', '1'],
    ]);
    expect(result.payload).toMatchObject({
      found: true,
      section,
      page: { returned: 1, total: 3, hasMore: true },
      detailLevel: section === 'stages' ? 'complete' : 'summary',
    });
  });

  it.each(['Motion', 'Amendment'] as const)(
    'keeps every %s group relationship beyond the first group',
    async (type) => {
      installBills((url) => (url.pathname === '/api/v1/Bills/11' ? bill() : motion(type)));
      using call = getParliamentHttp().beginCall(createMockContext());
      const result = await getBillsService().get(
        { billId: '11', section: 'motion', billStageId: '101', itemId: '601' },
        call,
      );
      expect(result.payload.record).toMatchObject({
        id: '601',
        itemKind: type,
        motionGroups: [{ amendmentIndices: [0, 1] }, { amendmentIndices: [2] }],
        amendmentGroups: [{ amendmentIndices: [3, 4] }],
        relatedAmendments: [
          { number: '1', groupKind: 'motionGroups', groupIndex: 0, amendmentIndex: 0 },
          { number: '2', groupKind: 'motionGroups', groupIndex: 0, amendmentIndex: 1 },
          { number: '3', groupKind: 'motionGroups', groupIndex: 1, amendmentIndex: 0 },
          { number: '4', groupKind: 'amendmentGroups', groupIndex: 0, amendmentIndex: 0 },
          {
            number: '5',
            groupKind: 'amendmentGroups',
            groupIndex: 0,
            amendmentIndex: 1,
            text: [{ text: 'Related 5 full text' }],
          },
        ],
      });
    },
  );

  it('returns an explicit empty publication page past the end without fabricating another cursor', async () => {
    installBills((url) =>
      url.pathname.endsWith('/Publications')
        ? { billId: 11, publications: [publication(), publication(302)] }
        : bill(),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    const first = await getBillsService().get(
      { billId: '11', section: 'publications', limit: 1 },
      call,
    );
    const cursor = encodeCursor({
      ...decodeCursor(first.payload.page!.nextCursor!, CollectionCursorSchema),
      offset: 99,
    });
    const result = await getBillsService().get(
      { billId: '11', section: 'publications', limit: 1, cursor },
      call,
    );
    expect(result.payload).toMatchObject({
      found: true,
      items: [],
      page: { returned: 0, total: 2, hasMore: false },
    });
    expect(result.payload.page).not.toHaveProperty('nextCursor');
  });

  it('retrieves amendmentId rather than generic id zero and preserves complete lines', async () => {
    const requests = installBills((url) =>
      url.pathname === '/api/v1/Bills/11' ? bill() : amendmentDetail(),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    const result = await getBillsService().get(
      { billId: '11', section: 'amendment', billStageId: '101', itemId: '901' },
      call,
    );
    expect(requests[1]?.pathname).toBe('/api/v1/Bills/11/Stages/101/Amendments/901');
    expect(result.payload.record).toMatchObject({
      id: '0',
      amendmentId: '901',
      amendmentLines: amendmentDetail().amendmentLines,
      explanatoryText: amendmentDetail().explanatoryText,
    });
  });
});
