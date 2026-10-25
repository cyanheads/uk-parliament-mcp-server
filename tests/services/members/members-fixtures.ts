/**
 * @fileoverview Synthetic Members wire fixtures and injected network boundary.
 * @module tests/services/members/members-fixtures
 */
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { getMembers, initMembers } from '@/services/members/members-service.js';
import {
  getParliamentHttp,
  initParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';

/** Deliberately sparse historical member, with no inferred latest membership. */
export function member(id = 77, nameDisplayAs = 'Synthetic Member') {
  return { id, nameDisplayAs, latestParty: null, latestHouseMembership: null };
}
/** Members wrappers retain links and independently reported totals. */
export function page(values: unknown[], totalResults = values.length) {
  return {
    items: values.map((value) => ({
      value,
      links: [{ rel: 'self', href: '/synthetic', method: 'GET' }],
    })),
    totalResults,
    skip: 99999,
    take: 20,
    links: [{ rel: 'next', href: '/Voting?skip=99999', method: 'GET' }],
  };
}
/** Install actual transport and domain services, replacing only the HTTP exchange. */
export function installMembers(route: (url: URL) => unknown | Response) {
  const requests: URL[] = [];
  initParliamentHttp({
    exchange: async (url) => {
      requests.push(new URL(url));
      const data = route(url);
      return data instanceof Response ? data : Response.json(data);
    },
  });
  initMembers(getParliamentHttp());
  return requests;
}

/** Hold two real Members requests active and 32 queued, then release every request. */
export async function withFullMembersQueue(run: () => Promise<void>): Promise<void> {
  const gate = Promise.withResolvers<void>();
  const active = Promise.withResolvers<void>();
  let started = 0;
  initParliamentHttp({
    exchange: async () => {
      if (++started === 2) active.resolve();
      await gate.promise;
      return Response.json({ value: member() });
    },
  });
  initMembers(getParliamentHttp());
  using call = getParliamentHttp().beginCall(createMockContext());
  const requests = Array.from({ length: 34 }, () => getMembers().profile(call, '77'));
  try {
    await active.promise;
    await run();
  } finally {
    gate.resolve();
    await Promise.all(requests);
  }
}
