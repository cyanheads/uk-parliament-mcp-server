/**
 * @fileoverview Synthetic Bills wire records and an injected HTTP boundary.
 * @module tests/services/bills/bills-fixtures
 */
import { z } from '@cyanheads/mcp-ts-core';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { initBillsService } from '@/services/bills/bills-service.js';
import {
  getParliamentHttp,
  initParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';

/** Sparse synthetic summary retaining the independent identifier namespaces. */
export function bill(billId = 11, shortTitle = 'Synthetic Test Bill') {
  return {
    billId,
    shortTitle,
    currentHouse: 'Commons',
    originatingHouse: 'Lords',
    introducedSessionId: 35,
    includedSessionIds: [34, 35],
    isAct: false,
    currentStage: stage(101),
  };
}

/** Whole stage with more than one sitting and an explicitly unassigned House. */
export function stage(id = 101) {
  return {
    id,
    stageId: 7,
    sessionId: 35,
    description: 'Synthetic consideration',
    house: 'Unassigned',
    stageSittings: [
      { id: 201, billStageId: id, stageId: 7, billId: 11, date: '2026-02-01T00:00:00' },
      { id: 202, billStageId: id, stageId: 7, billId: 11, date: '2026-02-02T00:00:00' },
    ],
  };
}

/** Summary id zero deliberately differs from the actual amendment retrieval ID. */
export function amendment(amendmentId = 901) {
  return {
    id: 0,
    amendmentId,
    billId: 11,
    billStageId: 101,
    decision: 'NoDecision',
    summaryText: ['First summary line', 'Second summary line'],
    sponsors: [
      {
        memberId: 77,
        name: 'Synthetic Sponsor',
        house: 'Commons',
        memberPage: 'https://members.parliament.uk/member/77/contact',
        isLead: true,
      },
    ],
  };
}

/** Complete text preserves HTML, indentation, quotes, Unicode and source newlines. */
export function amendmentDetail() {
  return {
    ...amendment(),
    amendmentLines: [
      {
        text: '<b>“Synthetic clause”</b>\n  second line',
        indentation: 1,
        hangingIndentation: '(1)',
        isImage: false,
      },
      { text: 'Final provision Ω 🏛️', indentation: 3, hangingIndentation: '(2)' },
    ],
    explanatoryTextPrefix: "Member's explanatory statement",
    explanatoryText: '<p>Keep every <em>word</em> &amp; newline.\nNext paragraph.</p>',
    amendmentNote: null,
  };
}

/** Multiple groups exercise both grouping namespaces and non-first related items. */
export function motion(type: 'Motion' | 'Amendment' = 'Motion', id = 601) {
  const related = (number: string) => ({
    number,
    decision: 'Agreed',
    text: [{ text: `Related ${number} full text`, indentation: 2 }],
    sponsors: [{ memberId: 78, name: 'Synthetic Related Sponsor' }],
  });
  const record = {
    id,
    billId: 11,
    billStageId: 101,
    type,
    number: '1A',
    summary: 'Synthetic full motion summary',
    sponsors: [{ memberId: 77, memberPage: 'https://members.parliament.uk/member/77/contact' }],
    motionGroups: [
      {
        sortOrder: 1,
        text: [{ text: '<b>First group</b>' }],
        amendments: [related('1'), related('2')],
      },
      { sortOrder: 2, text: [{ text: 'Second group\ncomplete' }], amendments: [related('3')] },
    ],
    amendmentGroups: [{ sortOrder: 3, amendments: [related('4'), related('5')] }],
  };
  return type === 'Motion'
    ? { type, motion: record, amendment: null }
    : { type, motion: null, amendment: record };
}

/** Whole publication retains every source file and actual link. */
export function publication(id = 301) {
  return {
    id,
    title: `Synthetic publication ${id}`,
    house: 'Unassigned',
    links: [
      {
        id: 401,
        title: 'Source report',
        url: 'https://bills.parliament.uk/publications/301',
        contentType: 'text/html',
      },
      {
        id: 402,
        title: 'Published Act',
        url: 'https://www.legislation.gov.uk/ukpga/2026/1/contents',
        contentType: 'text/html',
      },
    ],
    files: [
      {
        id: 501,
        filename: 'synthetic.pdf',
        contentType: 'application/pdf',
        contentLength: 42,
        downloadUrl: 'https://publications.parliament.uk/synthetic.pdf',
      },
      { id: 502, filename: 'annex.pdf', downloadUrl: null },
    ],
  };
}

/** Native Bills skip/take response, including explicit null empty collections. */
export function page(items: unknown[] | null, totalResults = items?.length ?? 0) {
  return { items, totalResults, itemsPerPage: items?.length ?? 0 };
}

/** Install real services backed only by a strict synthetic network exchange. */
export function installBills(route: (url: URL) => unknown | Response) {
  const requests: URL[] = [];
  initParliamentHttp({
    exchange: async (url) => {
      requests.push(new URL(url));
      const data = route(url);
      return data instanceof Response ? data : Response.json(data);
    },
  });
  initBillsService();
  return requests;
}

/** Fill the real origin queue with two blocked exchanges and thirty-two waiting requests. */
export async function withFullBillsQueue(run: () => Promise<void>): Promise<void> {
  const gate = Promise.withResolvers<void>();
  initParliamentHttp({
    exchange: async () => {
      await gate.promise;
      return Response.json({ billId: 11 });
    },
  });
  initBillsService();
  using call = getParliamentHttp().beginCall(createMockContext());
  const requests = Array.from({ length: 34 }, () =>
    getParliamentHttp().get(call, 'bills', '/api/v1/Bills/11', z.object({ billId: z.number() })),
  );
  try {
    await run();
  } finally {
    gate.resolve();
    await Promise.all(requests);
  }
}
