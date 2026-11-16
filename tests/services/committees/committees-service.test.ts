/**
 * @fileoverview Committee service behavior through the actual HTTP schema boundary.
 * @module tests/services/committees/committees-service.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitteeRecordSchema } from '@/services/committees/committee-models.js';
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
  documentEnvelope,
  evidence,
  htmlEvidence,
  installCommittees,
  membership,
  page,
  publication,
  reconstruct,
  report,
  without,
} from './committees-fixtures.js';

type CommitteeRecord = ReturnType<typeof CommitteeRecordSchema.parse>;
/** Every DocumentFile's derived route by source path; `absent` marks a file without one. */
function fileRoutes(record: CommitteeRecord): Record<string, string> {
  return Object.fromEntries(
    record.entities
      .filter((node) => node.kind === 'DocumentFile')
      .map((node) => [node.sourcePath, 'apiRoute' in node ? String(node.apiRoute) : 'absent']),
  );
}

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
    expect(reconstruct(pubs.data.items[0]!)).toStrictEqual(without(publication(), 'committee'));
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

describe('Committee list items', () => {
  it('drops written-evidence committees and business from list items, entities and pointers alike', async () => {
    const raw = evidence('written');
    const sparse = { id: 92, committees: null, committeeBusiness: null, document: null };
    installCommittees((url) =>
      url.pathname === '/api/WrittenEvidence' ? page([raw, sparse]) : raw,
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    const service = getCommittees();
    const list = await service.evidence(call, 'written', '31', 0, 10);
    const [item, sparseItem] = list.data.items;
    expect(reconstruct(item!)).toStrictEqual(without(raw, 'committees', 'committeeBusiness'));
    expect(reconstruct(sparseItem!)).toStrictEqual({ id: 92, document: null });
    for (const record of [item!, sparseItem!]) {
      const root = JSON.parse(JSON.stringify(record.entities[0]));
      expect(root).not.toHaveProperty('committeesPaths');
      expect(root).not.toHaveProperty('committeeBusinessPath');
      expect(
        record.entities.filter(
          (node) => node.kind === 'CommitteeSummary' || node.kind === 'CommitteeBusinessSummary',
        ),
      ).toEqual([]);
    }
    const detail = await service.evidenceDetail(call, 'written', '91');
    expect(reconstruct(detail!.data)).toStrictEqual(raw);
  });

  it('keeps oral-evidence committees and businesses on list items', async () => {
    const raw = evidence('oral');
    installCommittees(() => page([raw]));
    using call = getParliamentHttp().beginCall(createMockContext());
    const list = await getCommittees().evidence(call, 'oral', '31', 0, 10);
    expect(reconstruct(list.data.items[0]!)).toStrictEqual(raw);
  });

  it('drops the publication committee from list items only', async () => {
    const raw = publication();
    const sparse = { id: 54, committee: null };
    installCommittees((url) => (url.pathname === '/api/Publications' ? page([raw, sparse]) : raw));
    using call = getParliamentHttp().beginCall(createMockContext());
    const service = getCommittees();
    const list = await service.publications(call, '11', undefined, undefined, 0, 10);
    const [item, sparseItem] = list.data.items;
    expect(reconstruct(item!)).toStrictEqual(without(raw, 'committee'));
    expect(reconstruct(sparseItem!)).toStrictEqual({ id: 54 });
    for (const record of [item!, sparseItem!]) {
      expect(JSON.parse(JSON.stringify(record.entities[0]))).not.toHaveProperty('committeePath');
      expect(record.entities.some((node) => node.kind === 'CommitteeSummary')).toBe(false);
    }
    const detail = await service.publication(call, '51');
    expect(reconstruct(detail!.data)).toStrictEqual(raw);
  });
});

describe('Committee document file routes', () => {
  it.each([
    ['written', 'WrittenEvidence', '/committeeBusiness'],
    ['oral', 'OralEvidence', '/committeeBusinesses/0'],
  ] as const)(
    'derives %s evidence and nested report file routes without a document request',
    async (evidenceType, route, businessPath) => {
      const raw = htmlEvidence(evidenceType);
      const requests = installCommittees(() => raw);
      using call = getParliamentHttp().beginCall(createMockContext());
      const response = await getCommittees().evidenceDetail(call, evidenceType, '91');
      expect(reconstruct(response!.data)).toStrictEqual(raw);
      expect(fileRoutes(response!.data)).toEqual({
        '/document/files/0': `/api/${route}/91/Document/OriginalFormat`,
        '/document/files/1': 'absent',
        '/document/files/2': `/api/${route}/91/Document/Html`,
        [`${businessPath}/latestReport/documents/0/files/0`]:
          '/api/Publications/51/Document/61/OriginalFormat',
        [`${businessPath}/latestReport/documents/0/files/1`]: 'absent',
      });
      expect(requests.map((url) => url.pathname)).toEqual([`/api/${route}/91`]);
    },
  );

  it('derives publication and nested response routes from each publication and document ID', async () => {
    const raw = {
      ...publication(),
      governmentResponses: {
        publication: [
          {
            id: 52,
            documents: [
              {
                documentId: 70,
                files: [{ fileDataFormat: 'Pdf', url: null }, { fileDataFormat: 'A/B Html' }],
              },
            ],
          },
        ],
        responseDeadline: null,
      },
    };
    installCommittees(() => raw);
    using call = getParliamentHttp().beginCall(createMockContext());
    const response = await getCommittees().publication(call, '51');
    expect(reconstruct(response!.data)).toStrictEqual(raw);
    expect(fileRoutes(response!.data)).toEqual({
      '/documents/0/files/0': '/api/Publications/51/Document/61/OriginalFormat',
      '/documents/0/files/1': 'absent',
      '/governmentResponses/publication/0/documents/0/files/0':
        '/api/Publications/52/Document/70/Pdf',
      '/governmentResponses/publication/0/documents/0/files/1':
        '/api/Publications/52/Document/70/A%2FB%20Html',
    });
  });

  it('carries the same routes on evidence and publication list items', async () => {
    installCommittees((url) =>
      page([url.pathname === '/api/Publications' ? publication() : htmlEvidence('oral')]),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    const service = getCommittees();
    const oral = await service.evidence(call, 'oral', '31', 0, 10);
    expect(fileRoutes(oral.data.items[0]!)).toMatchObject({
      '/document/files/0': '/api/OralEvidence/91/Document/OriginalFormat',
      '/document/files/2': '/api/OralEvidence/91/Document/Html',
    });
    const pubs = await service.publications(call, '11', undefined, undefined, 0, 10);
    expect(fileRoutes(pubs.data.items[0]!)).toEqual({
      '/documents/0/files/0': '/api/Publications/51/Document/61/OriginalFormat',
      '/documents/0/files/1': 'absent',
    });
  });
});

describe('Committee evidence documents', () => {
  it.each([
    ['written', 'WrittenEvidence'],
    ['oral', 'OralEvidence'],
  ] as const)(
    'reads the %s record, then its own Html route, and decodes the rendition verbatim',
    async (evidenceType, route) => {
      const html = '﻿<html><body><p>“Evidence” Ω 🏛️ \\ </p>\r\n</body></html>';
      const raw = htmlEvidence(evidenceType);
      const requests = installCommittees((url) =>
        url.pathname.endsWith('/Document/Html') ? documentEnvelope(html) : raw,
      );
      using call = getParliamentHttp().beginCall(createMockContext());
      const response = await getCommittees().evidenceDocument(call, evidenceType, '91');
      expect(response!.document!.html).toBe(html);
      expect(reconstruct(response!.data)).toStrictEqual(raw);
      expect(requests.map((url) => `${url.pathname}${url.search}`)).toEqual([
        `/api/${route}/91?showOnWebsiteOnly=true`,
        `/api/${route}/91/Document/Html?showOnWebsiteOnly=true`,
      ]);
      expect(response!.source.url).toBe(
        `https://committees-api.parliament.uk/api/${route}/91?showOnWebsiteOnly=true`,
      );
      expect(response!.document!.source.url).toBe(
        `https://committees-api.parliament.uk/api/${route}/91/Document/Html?showOnWebsiteOnly=true`,
      );
    },
  );

  it('never follows a nested report Html file when the evidence lists no Html of its own', async () => {
    const raw = {
      ...evidence('written'),
      committeeBusiness: {
        ...business(),
        latestReport: {
          ...report(),
          documents: [{ documentId: 61, files: [{ fileName: 'r.Html', fileDataFormat: 'Html' }] }],
        },
      },
    };
    const requests = installCommittees(() => raw);
    using call = getParliamentHttp().beginCall(createMockContext());
    const response = await getCommittees().evidenceDocument(call, 'written', '91');
    expect(reconstruct(response!.data)).toStrictEqual(raw);
    expect(response!.document).toBeUndefined();
    expect(requests.map((url) => url.pathname)).toEqual(['/api/WrittenEvidence/91']);
  });

  it('keeps the found record when the document route answers 404', async () => {
    const requests = installCommittees((url) =>
      url.pathname.endsWith('/Document/Html')
        ? new Response(null, { status: 404 })
        : htmlEvidence('oral'),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    const response = await getCommittees().evidenceDocument(call, 'oral', '91');
    expect(response?.data.recordType).toBe('oral_evidence');
    expect(response!.document).toBeUndefined();
    expect(requests).toHaveLength(2);
  });

  it('misses a missing evidence ID without requesting a document', async () => {
    const requests = installCommittees(() => new Response(null, { status: 404 }));
    using call = getParliamentHttp().beginCall(createMockContext());
    await expect(getCommittees().evidenceDocument(call, 'written', '999')).resolves.toBeUndefined();
    expect(requests.map((url) => url.pathname)).toEqual(['/api/WrittenEvidence/999']);
  });

  it.each([
    ['non-base64 text', documentEnvelope('', 'not base64!')],
    ['unpadded base64', documentEnvelope('', 'PGh0bWw')],
    ['base64 broken by a line feed', documentEnvelope('', 'PGh0\nbWw=')],
    [
      'invalid UTF-8 bytes',
      documentEnvelope('', Buffer.from([0x3c, 0xff, 0xfe]).toString('base64')),
    ],
    [
      'an encoded lone surrogate',
      documentEnvelope('', Buffer.from([0xed, 0xa0, 0x80]).toString('base64')),
    ],
    ['a numeric data field', { ...documentEnvelope(''), data: 5 }],
    ['a null data field', { ...documentEnvelope(''), data: null }],
  ])('rejects a document envelope with %s as a non-retryable validation error', async (_, body) => {
    const requests = installCommittees((url) =>
      url.pathname.endsWith('/Document/Html') ? body : htmlEvidence('written'),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    await expect(getCommittees().evidenceDocument(call, 'written', '91')).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { retryable: false },
    });
    expect(requests).toHaveLength(2);
  });
});
