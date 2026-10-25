/**
 * @fileoverview Members adapters tested through the real JSON transport.
 * @module tests/services/members/members-service.test
 */
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { disposeMembers, getMembers } from '@/services/members/members-service.js';
import {
  disposeParliamentHttp,
  getParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import { installMembers, member, page } from './members-fixtures.js';

afterEach(() => {
  disposeMembers();
  disposeParliamentHttp();
});
describe('MembersService network adapters', () => {
  it('keeps historical, voting and active-party wrapper metadata compatible', async () => {
    const requests = installMembers((url) => ({
      ...page([
        url.pathname.includes('Voting')
          ? { id: 8, inAffirmativeLobby: true }
          : url.pathname.includes('GetActive')
            ? { id: 3, name: 'Synthetic party' }
            : member(),
      ]),
      resultType: url.pathname.includes('Voting') ? 0 : null,
    }));
    using call = getParliamentHttp().beginCall(createMockContext());
    expect(
      (await getMembers().search(call, { currentOnly: false, asOf: '2001-01-01' }, 0, 10)).data
        .items![0]!.value,
    ).toEqual({
      id: 77,
      nameDisplayAs: 'Synthetic Member',
      latestParty: null,
      latestHouseMembership: null,
    });
    expect(
      (await getMembers().voting(call, '77', 'commons', 1)).data.items![0]!.value,
    ).toMatchObject({ id: 8, inAffirmativeLobby: true });
    expect(await getMembers().parties(call, 'commons')).toMatchObject({
      total: 1,
      items: [{ value: { id: 3 } }],
    });
    expect(requests.map((url) => url.pathname)).toEqual([
      '/api/Members/SearchHistorical',
      '/api/Members/77/Voting',
      '/api/Parties/GetActive/1',
    ]);
  });
  it('omits unrestricted membership status, sets true explicitly, and uses the historical route', async () => {
    const requests = installMembers(() => page([member()]));
    using call = getParliamentHttp().beginCall(createMockContext());
    await getMembers().search(call, { currentOnly: false }, 0, 10);
    await getMembers().search(call, { currentOnly: true, house: 'lords', partyId: '999' }, 10, 20);
    const historic = await getMembers().search(
      call,
      { currentOnly: false, asOf: '2001-01-01', name: 'Synthetic' },
      4,
      3,
    );
    expect(requests[0]!.searchParams.has('IsCurrentMember')).toBe(false);
    expect(Object.fromEntries(requests[1]!.searchParams)).toEqual({
      PartyId: '999',
      House: '2',
      IsCurrentMember: 'true',
      skip: '10',
      take: '20',
    });
    expect(requests[2]!.pathname).toBe('/api/Members/SearchHistorical');
    expect(Object.fromEntries(requests[2]!.searchParams)).toEqual({
      name: 'Synthetic',
      dateToSearchFor: '2001-01-01',
      skip: '4',
      take: '3',
    });
    expect(historic.data.items![0]!.value).toEqual(member());
    expect(historic.source).toMatchObject({
      api: 'members',
      url: requests[2]!.href,
      retrievedAt: expect.any(String),
      licenceUrl: expect.stringContaining('parliament'),
    });
  });
  it('reads complete reference lists despite misleading party totals and null departments', async () => {
    installMembers((url) =>
      url.pathname.includes('GetActive')
        ? page(
            [
              { id: 1, name: 'Synthetic A' },
              { id: 2, name: 'Synthetic B' },
            ],
            0,
          )
        : url.pathname.endsWith('AnsweringBodies')
          ? [
              { id: 9, name: 'Synthetic body', department: null },
              { id: 10, department: { id: 3, name: 'Synthetic department' } },
            ]
          : [
              { id: 3, name: 'Synthetic department' },
              { id: 4, url: null },
            ],
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    expect(await getMembers().parties(call, 'commons')).toMatchObject({
      total: 2,
      items: [{ value: { id: 1 } }, { value: { id: 2 } }],
    });
    expect((await getMembers().departments(call)).data).toEqual([
      { id: 3, name: 'Synthetic department' },
      { id: 4, url: null },
    ]);
    expect((await getMembers().answeringBodies(call)).data).toEqual([
      { id: 9, name: 'Synthetic body', department: null },
      { id: 10, department: { id: 3, name: 'Synthetic department' } },
    ]);
  });
  it('treats profile 404 as absence but rejects a malformed successful profile', async () => {
    installMembers((url) =>
      url.pathname.endsWith('/77') ? new Response(null, { status: 404 }) : { value: { id: 'bad' } },
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    expect(await getMembers().profile(call, '77')).toBeUndefined();
    await expect(getMembers().profile(call, '78')).rejects.toThrow('contract');
  });
});
