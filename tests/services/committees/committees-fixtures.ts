/**
 * @fileoverview Synthetic official-schema committee graphs and independent reconstruction.
 * @module tests/services/committees/committees-fixtures
 */
import type { z } from '@cyanheads/mcp-ts-core';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { expect } from 'vitest';
import type { CommitteeRecordSchema } from '@/services/committees/committee-models.js';
import { initCommittees } from '@/services/committees/committees-service.js';
import {
  getParliamentHttp,
  initParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';

/** CommitteeSummary fields shared by list and detail capture contracts. */
export function committee(id = 11, name = 'Synthetic scrutiny') {
  return {
    id,
    name,
    contact: {
      email: 'committee@example.test',
      phone: null,
      address: 'Synthetic office',
      contactDisclaimer: 'Synthetic data',
    },
    parentCommittee: {
      id: 10,
      parentCommittee: { id: 9, parentCommittee: null },
      subCommittees: [],
    },
    subCommittees: [
      { id: 12, subCommittees: [{ id: 13, name: 'Third level', subCommittees: null }] },
      { id: 12, name: 'Repeated linked committee', parentCommittee: null },
    ],
    house: 'Joint',
    leadHouse: { isCommons: true, isLords: true },
    category: { id: 1, name: 'Select' },
    committeeTypes: [{ id: 3, name: 'Joint select', committeeCategory: { id: 1, name: 'Select' } }],
    showOnWebsite: true,
    websiteLegacyUrl: 'https://example.test/legacy',
    websiteLegacyRedirectEnabled: false,
    startDate: '2020-01-01',
    endDate: null,
    dateCommonsAppointed: '2025-01-01',
    dateLordsAppointed: null,
    scrutinisingDepartments: [
      { departmentId: 41, name: 'Synthetic department' },
      { departmentId: null },
    ],
    isLeadCommittee: false,
    nameHistory: [
      {
        id: 21,
        committeeId: id,
        name: 'Previous name',
        startDate: '2020-01-01',
        endDate: '2024-01-01',
      },
      { id: 22, name: null },
    ],
  };
}
/** Detail-only fields include source HTML, banner and previous committees. */
export function committeeDetail() {
  return {
    ...committee(),
    purpose: '<p>Keep  spaces &amp; “quotes”.\n```</p> 🏛️',
    banner: { desktopBanner: { fileName: 'banner.png', fileData: null }, mobileBanner: null },
    contentLinks: [
      {
        title: 'Evidence',
        url: 'https://example.test/evidence',
        description: null,
        displayOrder: 2,
      },
    ],
    previousCommittees: [{ id: 8, subCommittees: [{ id: 7 }] }],
  };
}
/** Person, membership and MNIS namespaces intentionally differ. */
export function membership() {
  return {
    id: 71,
    personId: 800,
    name: 'Synthetic member',
    photoUrl: null,
    memberInfo: {
      mnisId: 99,
      memberFrom: 'Synthetic seat',
      party: 'Synthetic party',
      partyColour: '#123456',
      isChair: false,
      listAs: 'Member, Synthetic',
      displayAs: 'Synthetic member',
      fullTitle: 'Synthetic title',
      addressAs: 'Synthetic salutation',
      house: 'Commons',
      isCurrent: true,
    },
    isLayMember: false,
    roles: [
      {
        startDate: '2020-01-01',
        endDate: '2024-01-01',
        role: { id: 1, name: 'Member', isChair: false, roleType: { id: 2, name: 'Ordinary' } },
        exOfficio: false,
        alternate: true,
        coOpted: false,
      },
      {
        startDate: '2025-01-01',
        endDate: null,
        role: { id: 3, name: 'Chair', isChair: true, roleType: null },
        exOfficio: true,
        alternate: false,
        coOpted: true,
      },
    ],
  };
}
/** PublicationSummary with nested responses, papers and complete document metadata. */
export function report(id = 51) {
  return {
    id,
    description: 'Synthetic report Ω',
    publicationStartDate: '2026-01-01T12:00:00',
    publicationEndDate: null,
    governmentResponses: {
      publication: [
        {
          id: 52,
          description: 'Synthetic response',
          responseToPublicationId: id,
          governmentResponses: {
            publication: [{ id: 53, documents: null }],
            responseDeadline: null,
            responseExcepted: false,
          },
        },
      ],
      responseDeadline: '2026-03-01',
      responseExcepted: true,
    },
    documents: [
      {
        documentId: 61,
        files: [
          {
            fileName: 'synthetic.pdf',
            fileSize: 241900,
            fileDataFormat: 'OriginalFormat',
            url: null,
            documentPurpose: {
              id: 1,
              name: 'Standard',
              description: null,
              label: 'standard',
              sortOrder: 10,
            },
            format: 'pdf',
          },
          {
            fileName: 'annex.html',
            url: 'https://example.test/annex',
            fileSize: null,
            documentPurpose: null,
            format: 'html',
          },
        ],
      },
      { documentId: 62, files: [] },
    ],
    hcNumber: { number: 'HC 632', sessionId: 40, sessionDescription: '2026-27' },
    hlPaper: { number: 'HL 100', sessionId: 40, sessionDescription: null },
    type: {
      id: 1,
      name: 'Report',
      description: 'Synthetic report type',
      governmentCanRespond: true,
      canBeResponse: false,
      iconKey: null,
      pluralVersion: 'Reports',
    },
    responseToPublicationId: null,
    additionalContentUrl: 'https://publications.parliament.uk/synthetic/report.pdf',
    additionalContentUrl2: 'https://example.test/report',
    respondingDepartment: {
      id: 41,
      name: 'Synthetic department',
      address: { addressLine1: 'Synthetic office', addressLine2: null, postcode: 'TEST' },
      otherAddress: null,
      phone: null,
      email: 'department@example.test',
      url: 'https://example.test/department',
    },
  };
}
/** Business summary preserves non-inquiry work and nested oral evidence attendees. */
export function business(id = 31) {
  return {
    id,
    title: 'Synthetic scrutiny work',
    type: { id: 2, name: 'Correspondence', isInquiry: false, description: 'Other scrutiny work' },
    openDate: '2025-01-01',
    closeDate: null,
    latestReport: report(),
    openSubmissionPeriods: [
      {
        id: 41,
        startDate: '2026-01-01',
        endDate: null,
        submissionType: 'Written',
        isPromoted: true,
        statusMessage: 'Open',
        allowSubmissionsPastEndDate: false,
      },
    ],
    closedSubmissionPeriods: [
      {
        id: 42,
        startDate: '2025-01-01',
        endDate: '2025-02-01',
        submissionType: 'Oral',
        isPromoted: false,
        statusMessage: null,
        allowSubmissionsPastEndDate: true,
      },
    ],
    nextOralEvidenceSession: {
      id: 81,
      name: 'Synthetic evidence',
      startDate: '2026-02-01T10:00:00',
      endDate: null,
      eventId: 82,
      isPrivate: false,
      activityType: 'OralEvidence',
      attendees: [
        {
          id: 83,
          personId: 800,
          name: 'Synthetic witness',
          memberInfo: { mnisId: 99 },
          organisations: [
            { name: 'Synthetic organisation', role: 'Witness', idmsId: 'synthetic-1', cisId: 84 },
          ],
          submitterType: 'Person',
          additionalContext: null,
          displayOrder: 1,
        },
        { id: 85, memberInfo: null, organisations: null },
      ],
    },
    contact: null,
  };
}
/** Full business detail adds source scope, links, banner and HC numbers. */
export function businessDetail() {
  return {
    ...business(),
    scope: '<p>Complete scope\nwith whitespace.</p>',
    relatedInformation: [{ url: 'https://example.test/scope', description: null }],
    banner: null,
    hcNumbers: [{ number: 'HC 101', sessionId: 40 }],
  };
}
/** Publication detail includes committee and repeated business relationships. */
export function publication() {
  return {
    ...report(),
    committee: { id: 11, parentCommittee: { id: 10 } },
    businesses: [
      {
        id: 31,
        title: 'First business',
        latestReport: { id: 51 },
        type: { id: 1, isInquiry: true },
      },
      { id: 31, title: 'Repeated business', latestReport: null },
    ],
  };
}
/** Written and oral namespaces share witnesses/documents, with distinct business relationships. */
export function evidence(type: 'written' | 'oral') {
  const shared = {
    id: 91,
    publicationDate: null,
    witnesses: [
      {
        id: 92,
        personId: 800,
        name: 'Synthetic witness',
        memberInfo: { mnisId: 99 },
        organisations: [{ name: 'Synthetic organisation', role: null }],
        submitterType: 'Person',
        additionalContext: '<p>Exact source HTML</p>',
      },
      { id: 93, memberInfo: null, organisations: null },
    ],
    document: report().documents[0],
    committees: [committee()],
    legacyHtmlUrl: null,
    legacyPdfUrl: 'https://example.test/evidence.pdf',
  };
  return type === 'written'
    ? {
        ...shared,
        submissionId: '00000000-0000-0000-0000-000000000001',
        internalReference: 'TEST0001',
        anonymous: false,
        anonymousWitnessText: null,
        committeeBusiness: business(),
        hcNumber: { number: 'HC 10', sessionId: 40 },
      }
    : {
        ...shared,
        activityId: 81,
        meetingDate: null,
        activityStartDate: '2026-01-01T10:00:00',
        committeeBusinesses: [business(), { id: 32, latestReport: null }],
        hcNumbers: [{ number: 'HC 10', sessionId: 40 }, { number: null }],
      };
}
/** Native collection shape; null and array absence are distinct source states. */
export function page(items: unknown[] | null, totalResults = items?.length ?? 0) {
  return {
    items,
    totalResults,
    itemsPerPage: items?.length ?? 0,
    links: [
      { rel: 'self', href: '/api/Committees', method: 'GET' },
      { rel: null, href: null },
    ],
  };
}
/** Only the HTTP exchange is replaced; all validation and domain code remains real. */
export function installCommittees(route: (url: URL) => unknown | Response) {
  const requests: URL[] = [];
  initParliamentHttp({
    exchange: async (url) => {
      if (url.origin !== 'https://committees-api.parliament.uk')
        throw new Error(`Unexpected fixture origin ${url.origin}`);
      requests.push(new URL(url));
      const body = route(url);
      return body instanceof Response ? body : Response.json(body);
    },
  });
  initCommittees();
  return requests;
}
/** Invert typed relationships without importing a production normalizer or raw schema. */
export function reconstruct(record: z.infer<typeof CommitteeRecordSchema>): unknown {
  const nodes = new Map(record.entities.map((node) => [node.sourcePath, node]));
  expect(nodes.size).toBe(record.entities.length);
  const visited = new Set<string>();
  function read(path: string): unknown {
    const node = nodes.get(path);
    expect(node, `missing relationship ${path}`).toBeDefined();
    if (!node) throw new Error(`Missing source path ${path}`);
    visited.add(path);
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key, value]) => key !== 'kind' && key !== 'sourcePath' && value !== undefined)
        .map(([key, value]) => {
          if (key.endsWith('Paths'))
            return [key.slice(0, -5), value === null ? null : (value as string[]).map(read)];
          if (key.endsWith('Path'))
            return [key.slice(0, -4), value === null ? null : read(String(value))];
          return [key, value];
        }),
    );
  }
  const raw = read(record.rootPath);
  expect(visited.size).toBe(nodes.size);
  return raw;
}
/** Saturate the actual per-origin queue without timers or live network. */
export async function withFullCommitteeQueue(run: () => Promise<void>) {
  const gate = Promise.withResolvers<void>();
  initParliamentHttp({
    exchange: async () => {
      await gate.promise;
      return Response.json(page([]));
    },
  });
  initCommittees();
  using call = getParliamentHttp().beginCall(createMockContext());
  const { getCommittees } = await import('@/services/committees/committees-service.js');
  const pending = Array.from({ length: 34 }, () => getCommittees().search(call, {}, 0, 10));
  try {
    await run();
  } finally {
    gate.resolve();
    await Promise.all(pending);
  }
}
