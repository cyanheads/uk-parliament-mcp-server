/**
 * @fileoverview Synthetic written-statement fixtures shaped like captured source rows, plus real-service transport setup.
 * @module tests/services/statements/statements-fixtures
 */
import { initMembers } from '@/services/members/members-service.js';
import {
  getParliamentHttp,
  initParliamentHttp,
  type ParliamentExchange,
} from '@/services/parliament-http/parliament-http-service.js';
import { initStatements } from '@/services/statements/statements-service.js';

/** Complete synthetic Lords statement; the ID, UIN and wrapper link deliberately differ. */
export function statement(
  id = 1952546,
  text = '<p>Complete synthetic statement 文🏛️ &amp; detail.</p>',
) {
  return {
    id,
    memberId: 4959,
    member: {
      id: 4959,
      listAs: 'Minister, S.',
      name: 'Synthetic Minister',
      party: 'Synthetic Party',
      partyColour: 'd50000',
      partyAbbreviation: 'Syn',
      memberFrom: 'Life peer',
      thumbnailUrl: 'https://example.org/member.png',
    },
    memberRole: 'Parliamentary Under-Secretary of State (Synthetic)',
    uin: 'HLWS419',
    dateMade: '2026-10-23T00:00:00',
    answeringBodyId: 220,
    answeringBodyName: 'Department for Synthetic Affairs ',
    title: 'Synthetic Taskforce: Government Response',
    text,
    house: 'Lords',
    noticeNumber: 0,
    hasAttachments: true,
    hasLinkedStatements: true,
    linkedStatements: [
      { linkedStatementId: 1952855, linkType: 'JointStatement', linkDate: '2026-10-26T00:00:00' },
      { linkedStatementId: 1912154, linkType: 'CorrectedAnswer', linkDate: '2026-06-03T00:00:00' },
    ],
    attachments: [
      {
        url: 'https://example.org/terms of reference.pdf',
        title: 'Terms of Reference',
        fileType: 'pdf',
        fileSizeBytes: 114424,
      },
    ],
  };
}
/** Commons statement: nonzero order on the day, no links or attachments. */
export function commonsStatement(id = 1952855) {
  return {
    ...statement(id, 'Commons preview text that ends mid-sentence...'),
    uin: 'HCWS416',
    house: 'Commons',
    noticeNumber: 3,
    hasAttachments: false,
    hasLinkedStatements: false,
    linkedStatements: null,
    attachments: [],
  };
}
/** Official singular wrapper; the self link only restates the ID. */
export function item(value: unknown = statement()) {
  return { value, links: [{ rel: 'self', href: '/Statements/1952546', method: 'GET' }] };
}
/** Official search wrapper; search-row links are sequential numbers unrelated to the record. */
export function page(values: unknown[], totalResults = values.length) {
  return {
    totalResults,
    results: values.map((value, index) => ({
      value,
      links: [{ rel: 'self', href: `/Statements/${1741554 + index}`, method: 'GET' }],
    })),
  };
}
/** Synthetic answering-body reference rows 1..count. */
export function answeringBodies(count = 300) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Synthetic Body ${index + 1}`,
  }));
}
/** Install all real services, replacing only the HTTP exchange. */
export function installStatements(
  route: (url: URL, signal: AbortSignal) => unknown | Response | Promise<unknown | Response>,
) {
  const requests: URL[] = [];
  const signals: AbortSignal[] = [];
  const exchange: ParliamentExchange = async (url, _timeoutMs, _ctx, signal) => {
    requests.push(new URL(url));
    signals.push(signal);
    const data = await route(url, signal);
    return data instanceof Response ? data : Response.json(data);
  };
  initParliamentHttp({ exchange });
  initMembers(getParliamentHttp());
  initStatements(getParliamentHttp());
  return { requests, signals };
}
