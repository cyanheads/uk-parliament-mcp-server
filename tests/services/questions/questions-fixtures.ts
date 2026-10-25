/**
 * @fileoverview Synthetic written-question fixtures and real-service transport setup.
 * @module tests/services/questions/questions-fixtures
 */
import { initMembers } from '@/services/members/members-service.js';
import {
  getParliamentHttp,
  initParliamentHttp,
  type ParliamentExchange,
} from '@/services/parliament-http/parliament-http-service.js';
import { initQuestions } from '@/services/questions/questions-service.js';

/** Complete synthetic question; IDs and UIN deliberately differ. */
export function question(
  id = 701,
  answerText = '<p>Complete synthetic answer 文🏛️ &amp; evidence.</p>',
) {
  return {
    id,
    askingMemberId: 77,
    askingMember: { id: 77, name: 'Synthetic Asking Member', party: null },
    house: 'Commons',
    memberHasInterest: true,
    dateTabled: '2026-02-01T00:00:00',
    dateForAnswer: '2026-02-04T00:00:00',
    uin: '42',
    questionText: 'Complete synthetic question?',
    answeringBodyId: 13,
    answeringBodyName: 'Synthetic Department',
    isWithdrawn: false,
    isNamedDay: true,
    groupedQuestions: ['43', '44'],
    answerIsHolding: true,
    answerIsCorrection: true,
    answeringMemberId: 78,
    answeringMember: {
      id: 78,
      name: 'Synthetic Answering Member',
      thumbnailUrl: 'https://example.org/member.png',
    },
    correctingMemberId: 79,
    correctingMember: { id: 79, name: 'Synthetic Correcting Member' },
    dateAnswered: '2026-02-04T00:00:00',
    answerText,
    originalAnswerText: '<p>Original answer</p>',
    comparableAnswerText: 'Comparable answer',
    dateAnswerCorrected: '2026-02-05T00:00:00',
    dateHoldingAnswer: '2026-02-03T00:00:00',
    attachmentCount: 2,
    heading: 'Synthetic Evidence',
    attachments: [
      {
        url: 'https://example.org/one.pdf',
        title: 'First evidence',
        fileType: 'pdf',
        fileSizeBytes: 123,
      },
      { url: 'https://example.org/two.csv', title: null, fileType: 'csv', fileSizeBytes: 456 },
    ],
    groupedQuestionsDates: [
      { questionUin: '43', dateTabled: '2026-02-01T00:00:00' },
      { questionUin: '44', dateTabled: '2026-02-02T00:00:00' },
    ],
  };
}
/** Official singular wrapper. */
export function item(value: unknown = question()) {
  return { value, links: [{ rel: 'self', href: '/Questions/701', method: 'GET' }] };
}
/** Official search wrapper; no invented wrapper pagination fields. */
export function page(values: unknown[], totalResults = values.length) {
  return { results: values.map(item), totalResults };
}
/** Install all real services, replacing only the HTTP exchange. */
export function installQuestions(
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
  initQuestions(getParliamentHttp());
  return { requests, signals };
}
