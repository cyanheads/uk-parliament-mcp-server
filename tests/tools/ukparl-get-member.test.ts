/**
 * @fileoverview Selected member contracts through real services and synthetic HTTP.
 * @module tests/tools/ukparl-get-member.test
 */
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ukparlGetMember } from '@/mcp-server/tools/definitions/ukparl-get-member.tool.js';
import { BiographyCategorySchema } from '@/services/members/member-models.js';
import { disposeMembers } from '@/services/members/members-service.js';
import {
  advanceCollectionCursor,
  readCollectionCursor,
} from '@/services/parliament-http/parliament-cursors.js';
import { disposeParliamentHttp } from '@/services/parliament-http/parliament-http-service.js';
import {
  installMembers,
  member,
  page,
  withFullMembersQueue,
} from '../services/members/members-fixtures.js';

function text(result: Awaited<ReturnType<typeof runToolContract>>) {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}
function installSection(value: unknown) {
  return installMembers((url) =>
    url.pathname === '/api/Members/77'
      ? { value: member(), links: [{ rel: 'self', href: '/77', method: 'GET' }] }
      : { value, links: [] },
  );
}
afterEach(() => {
  disposeMembers();
  disposeParliamentHttp();
});
describe('ukparl_get_member', () => {
  it('renders queue saturation with exact-tool recovery on both surfaces', async () => {
    await withFullMembersQueue(async () => {
      const result = await runToolContract(ukparlGetMember, { memberId: '77' });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          data: {
            reason: 'queue_full',
            recovery: { hint: expect.stringContaining('ukparl_get_member') },
          },
        },
      });
      expect(text(result)).toContain('queue_full');
      expect(text(result)).toContain(
        'Wait briefly, then repeat ukparl_get_member with the same selectors.',
      );
    });
  });
  it('preserves sparse profile and relationship links without fetching other sections', async () => {
    const requests = installSection(null);
    const result = await runToolContract(ukparlGetMember, { memberId: '077' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      found: true,
      memberId: '77',
      record: { kind: 'profile', value: member(), links: [{ href: '/77' }] },
    });
    expect(requests).toHaveLength(1);
    for (const term of ['latestHouseMembership', 'null', '/77', 'licenceUrl', 'retrievedAt'])
      expect(text(result)).toContain(term);
  });
  it('returns a successful miss and actionable search recovery for a missing parent', async () => {
    const requests = installMembers(() => new Response(null, { status: 404 }));
    const result = await runToolContract(ukparlGetMember, { memberId: '77', section: 'contact' });
    expect(result.structuredContent).toMatchObject({ found: false });
    expect(text(result)).toContain('ukparl_search_members');
    expect(requests).toHaveLength(1);
  });
  it('lists every biography category and distinguishes null, missing and empty histories', async () => {
    installSection({
      representations: [{ id: 1, name: 'Synthetic seat' }],
      electionsContested: [],
      houseMemberships: null,
    });
    const result = await runToolContract(ukparlGetMember, { memberId: '77', section: 'roles' });
    expect(result.structuredContent).toMatchObject({
      record: {
        kind: 'role_categories',
        categories: [
          { category: 'representations', available: true, count: 1 },
          { category: 'electionsContested', available: true, count: 0 },
          { category: 'houseMemberships', available: false, count: null },
          ...[
            'governmentPosts',
            'oppositionPosts',
            'otherPosts',
            'partyAffiliations',
            'committeeMemberships',
          ].map((category) => ({ category, available: false, count: null })),
        ],
      },
    });
    for (const category of BiographyCategorySchema.options)
      expect(text(result)).toContain(category);
  });
  it.each(BiographyCategorySchema.options)(
    'retrieves complete %s periods and local past-end pages',
    async (category) => {
      const period = {
        id: 91,
        name: 'Synthetic period',
        startDate: '2001-01-01',
        endDate: null,
        additionalInfo: 'Complete notes',
        additionalInfoLink: 'https://example.org/synthetic',
        constituencyStart: '2000-01-01',
        constituencyEnd: null,
      };
      installSection({ [category]: [period] });
      const result = await runToolContract(ukparlGetMember, {
        memberId: '77',
        section: 'roles',
        category,
        limit: 1000,
      });
      expect(result.structuredContent).toMatchObject({
        items: [{ kind: 'role', value: period }],
        requestedLimit: 1000,
        cap: 50,
      });
      for (const value of [
        'Complete notes',
        'constituencyStart',
        'https://example.org/synthetic',
        'capped at 50',
      ])
        expect(text(result)).toContain(value);
      const cursor = advanceCollectionCursor(
        readCollectionCursor(undefined, {
          source: 'members',
          selector: 'roles',
          filters: { memberId: '77', category },
          nativePageSize: 50,
        }),
        99,
      );
      const end = await runToolContract(ukparlGetMember, {
        memberId: '77',
        section: 'roles',
        category,
        limit: 1000,
        cursor,
      });
      expect(end.structuredContent).toMatchObject({
        items: [],
        totalCount: 1,
        page: { returned: 0, total: 1, hasMore: false },
      });
      expect(text(end)).toContain('no rows');
    },
  );
  it('preserves complete official contact caveats on both consumption surfaces', async () => {
    const contact = {
      type: 'Synthetic office',
      typeDescription: 'Official office only',
      notes: 'Synthetic fixture; do not use for personal requests.\nSecond caveat Ω',
      line1: 'Synthetic address',
      line5: null,
      phone: null,
      email: 'synthetic@example.invalid',
      website: 'https://example.invalid/contact',
      isPreferred: false,
    };
    installSection([contact]);
    const result = await runToolContract(ukparlGetMember, { memberId: '77', section: 'contact' });
    expect(result.structuredContent).toMatchObject({
      items: [{ kind: 'contact', value: contact }],
    });
    expect(text(result)).toContain(JSON.stringify(contact.notes));
    expect(text(result)).toContain('personal data is excluded');
    expect(text(result)).toContain(contact.email);
  });
  it.each(['contact', 'interests', 'roles'] as const)(
    'does not turn unavailable %s collections into empty facts',
    async (section) => {
      installSection(null);
      const result = await runToolContract(ukparlGetMember, {
        memberId: '77',
        section,
        ...(section === 'interests' ? { house: 'commons' } : {}),
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).not.toHaveProperty('items');
      expect(text(result)).toContain('no');
    },
  );
  it('retains every nested interest with ordered parent/source paths and missing/null child states', async () => {
    installSection([
      {
        id: 1,
        name: 'Synthetic category',
        interests: [
          {
            id: 10,
            interest: 'root',
            childInterests: [
              { id: 11, interest: 'first', childInterests: null },
              { id: 12, interest: 'second', childInterests: [{ id: 13, interest: 'grandchild' }] },
            ],
          },
          { id: 14, interest: 'second root', childInterests: [] },
        ],
      },
      { id: 2, interests: null },
      { id: 3 },
    ]);
    const result = await runToolContract(ukparlGetMember, {
      memberId: '77',
      section: 'interests',
      house: 'lords',
    });
    expect(result.isError).not.toBe(true);
    const output = ukparlGetMember.output.parse(result.structuredContent);
    const item = output.items![0]!;
    if (item.kind !== 'interest_category') throw new Error('Wrong interest kind');
    expect(item.value.rootPaths).toEqual(['/interests/0', '/interests/1']);
    expect(
      item.value.interests!.map((node) => [node.id, node.path, node.parentPath, node.childPaths]),
    ).toEqual([
      [
        10,
        '/interests/0',
        undefined,
        ['/interests/0/childInterests/0', '/interests/0/childInterests/1'],
      ],
      [11, '/interests/0/childInterests/0', '/interests/0', null],
      [
        12,
        '/interests/0/childInterests/1',
        '/interests/0',
        ['/interests/0/childInterests/1/childInterests/0'],
      ],
      [
        13,
        '/interests/0/childInterests/1/childInterests/0',
        '/interests/0/childInterests/1',
        undefined,
      ],
      [14, '/interests/1', undefined, []],
    ]);
    expect(output.items![1]).toMatchObject({ value: { interests: null, rootPaths: null } });
    expect(output.items![2]).not.toHaveProperty('value.rootPaths');
    const nodes = new Map(item.value.interests!.map((node) => [node.path, node]));
    type RebuiltInterest = {
      id: number;
      interest?: string | null | undefined;
      childInterests?: RebuiltInterest[] | null;
    };
    const rebuild = (path: string): RebuiltInterest => {
      const node = nodes.get(path)!;
      return {
        id: node.id,
        interest: node.interest,
        ...(node.childPaths === undefined
          ? {}
          : { childInterests: node.childPaths === null ? null : node.childPaths.map(rebuild) }),
      };
    };
    expect(item.value.rootPaths!.map(rebuild)).toEqual([
      {
        id: 10,
        interest: 'root',
        childInterests: [
          { id: 11, interest: 'first', childInterests: null },
          { id: 12, interest: 'second', childInterests: [{ id: 13, interest: 'grandchild' }] },
        ],
      },
      { id: 14, interest: 'second root', childInterests: [] },
    ]);
    for (const value of [
      'grandchild',
      'second root',
      '/interests/0/childInterests/1/childInterests/0',
      'null',
    ])
      expect(text(result)).toContain(value);
  });
  it('rejects a committee join on a different MNIS member instead of accepting matching personId', async () => {
    installMembers((url) =>
      url.origin.includes('members-api')
        ? { value: member() }
        : [{ id: 1, personId: 77, memberInfo: { mnisId: 88 }, committees: [] }],
    );
    const result = await runToolContract(ukparlGetMember, {
      memberId: '77',
      section: 'committee_seats',
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('inconsistent MNIS');
  });
  it.each(['contact', 'interests', 'voting'] as const)(
    'returns explicit empty %s pages and same-selection continuation facts',
    async (section) => {
      installMembers((url) =>
        url.pathname === '/api/Members/77'
          ? { value: member() }
          : section === 'voting'
            ? page([])
            : { value: [] },
      );
      const result = await runToolContract(ukparlGetMember, {
        memberId: '77',
        section,
        ...(section === 'contact' ? {} : { house: 'commons' }),
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        items: [],
        totalCount: 0,
        page: { returned: 0, hasMore: false },
      });
      expect(text(result)).toContain('no rows');
    },
  );
  it('rejects malformed and selector-rebound member collection cursors', async () => {
    installSection([{ id: 1 }, { id: 2 }]);
    const first = await runToolContract(ukparlGetMember, {
      memberId: '77',
      section: 'roles',
      category: 'representations',
      cursor: 'malformed!',
    });
    expect(first.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(first)).toContain('no cursor or contentCursor');
    const cursor = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'members',
        selector: 'contact',
        filters: { memberId: '77' },
        nativePageSize: 20,
      }),
      1,
    );
    const rebound = await runToolContract(ukparlGetMember, {
      memberId: '78',
      section: 'contact',
      cursor,
    });
    expect(rebound.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(rebound)).toContain('same filters');
  });
  it('keeps committee person and MNIS namespaces, all nested occurrences and unknown collection states', async () => {
    const requests = installMembers((url) =>
      url.origin.includes('members-api')
        ? { value: member() }
        : [
            {
              id: 900,
              personId: 888,
              memberInfo: { mnisId: 77 },
              committees: [
                {
                  id: 5,
                  name: 'Root',
                  contact: { contactDisclaimer: 'Complete synthetic disclaimer' },
                  parentCommittee: {
                    id: 6,
                    subCommittees: [{ id: 7 }, { id: 8, parentCommittee: null }],
                  },
                  subCommittees: [{ id: 9 }, { id: 10, subCommittees: null }],
                  roles: [
                    {
                      role: {
                        id: 3,
                        name: 'Chair',
                        roleType: { id: 4, name: 'Elected' },
                        isChair: true,
                      },
                      exOfficio: false,
                    },
                  ],
                },
              ],
            },
            { id: 901, personId: 889, memberInfo: { mnisId: 77 }, committees: null },
            { id: 902, memberInfo: { mnisId: 77 } },
          ],
    );
    const result = await runToolContract(ukparlGetMember, {
      memberId: '77',
      section: 'committee_seats',
    });
    expect(result.isError).not.toBe(true);
    expect(Object.fromEntries(requests[1]!.searchParams)).toEqual({
      Members: '77',
      MembershipStatus: 'All',
      ShowOnWebsiteOnly: 'true',
    });
    const output = ukparlGetMember.output.parse(result.structuredContent);
    const item = output.items![0]!;
    if (item.kind !== 'committee_seat') throw new Error('Wrong committee kind');
    expect(item.member).toMatchObject({ id: 900, personId: 888, memberInfo: { mnisId: 77 } });
    expect(new Map(item.relatedCommittees.map((node) => [node.path, node.id]))).toEqual(
      new Map([
        ['/parentCommittee/subCommittees/0', 7],
        ['/parentCommittee/subCommittees/1', 8],
        ['/parentCommittee', 6],
        ['/subCommittees/0', 9],
        ['/subCommittees/1', 10],
      ]),
    );
    expect(item.value.parentCommitteePath).toBe('/parentCommittee');
    expect(item.value.subCommitteePaths).toEqual(['/subCommittees/0', '/subCommittees/1']);
    expect(output.membershipContexts!.map((context) => context.committeesState)).toEqual([
      'present',
      'null',
      'missing',
    ]);
    expect(output.totalCount).toBeUndefined();
    for (const value of [
      '888',
      'mnisId',
      '77',
      'Complete synthetic disclaimer',
      'Elected',
      '/parentCommittee/subCommittees/1',
    ])
      expect(text(result)).toContain(value);
  });
  it.each([
    { section: 'interests' },
    { section: 'voting' },
    { section: 'profile', house: 'commons' },
    { section: 'contact', category: 'representations' },
    { section: 'roles', cursor: 'bad' },
  ] as const)('rejects incompatible selector %j before I/O', async (input) => {
    const requests = installSection([]);
    const result = await runToolContract(ukparlGetMember, { memberId: '77', ...input });
    expect(result.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_mode_arguments' } },
    });
    expect(text(result)).toContain('ukparl_get_member');
    expect(text(result)).toContain('house');
    expect(requests).toEqual([]);
  });
  it('reconstructs oversized UTF-8 profile text losslessly and rejects changed source or selectors', async () => {
    let title = 'Synthetic 文🏛️\n"quoted" '.repeat(2000);
    installMembers(() => ({ value: { ...member(), nameFullTitle: title } }));
    const first = await runToolContract(ukparlGetMember, { memberId: '77' });
    expect(first.isError).not.toBe(true);
    const initial = ukparlGetMember.output.parse(first.structuredContent);
    expect(initial.delivery).toBe('outline');
    const firstCursor = initial.contentPage!.entries![0]!.contentCursor;
    async function retrieve(contentCursor: string): Promise<unknown> {
      const result = await runToolContract(ukparlGetMember, { memberId: '77', contentCursor });
      expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
      const output = ukparlGetMember.output.parse(result.structuredContent);
      const cp = output.contentPage!;
      expect(text(result)).toContain(cp.path);
      expect(output.identity).toEqual({ memberId: '77' });
      expect(output.provenance).toMatchObject({
        api: 'members',
        licenceUrl: expect.any(String),
        retrievedAt: expect.any(String),
      });
      if (cp.fragment !== undefined) {
        let fragments = cp.fragment;
        let nextCursor = cp.nextCursor;
        while (nextCursor) {
          const next = await runToolContract(ukparlGetMember, {
            memberId: '77',
            contentCursor: nextCursor,
          });
          expect(next.isError).not.toBe(true);
          expect(Buffer.byteLength(JSON.stringify(next))).toBeLessThanOrEqual(24000);
          const part = ukparlGetMember.output.parse(next.structuredContent).contentPage!;
          fragments += part.fragment!;
          nextCursor = part.nextCursor;
        }
        return JSON.parse(fragments);
      }
      const value: Record<string, unknown> | unknown[] =
        cp.kind === 'array' ? [] : Object.create(null);
      let entries = cp.entries!;
      let nextCursor = cp.nextCursor;
      while (true) {
        for (const entry of entries) {
          const key = entry.path
            .slice(entry.path.lastIndexOf('/') + 1)
            .replaceAll('~1', '/')
            .replaceAll('~0', '~');
          Reflect.set(value, key, await retrieve(entry.contentCursor));
        }
        if (!nextCursor) break;
        const next = await runToolContract(ukparlGetMember, {
          memberId: '77',
          contentCursor: nextCursor,
        });
        expect(next.isError).not.toBe(true);
        expect(Buffer.byteLength(JSON.stringify(next))).toBeLessThanOrEqual(24000);
        const part = ukparlGetMember.output.parse(next.structuredContent).contentPage!;
        entries = part.entries!;
        nextCursor = part.nextCursor;
      }
      return value;
    }
    const rebuilt: Record<string, unknown> = Object.create(null);
    for (const entry of initial.contentPage!.entries!)
      Reflect.set(rebuilt, entry.path.slice(1), await retrieve(entry.contentCursor));
    expect(rebuilt).toMatchObject({
      record: { value: { nameFullTitle: title } },
      source: { api: 'members', url: 'https://members-api.parliament.uk/api/Members/77' },
    });
    const rebound = await runToolContract(ukparlGetMember, {
      memberId: '78',
      contentCursor: firstCursor,
    });
    expect(rebound.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(rebound)).toContain('no cursor or contentCursor');
    title = 'Changed synthetic title';
    const changed = await runToolContract(ukparlGetMember, {
      memberId: '77',
      contentCursor: firstCursor,
    });
    expect(changed.structuredContent).toMatchObject({
      error: { data: { reason: 'source_changed' } },
    });
    expect(text(changed)).toContain('original filters');
  });
  it('re-fetches native vote remainders before page two, ignoring false skip and next-link metadata', async () => {
    const votes = Array.from({ length: 23 }, (_, i) => ({
      id: 100 + i,
      house: 1,
      title: `${i}: ${'文🏛️'.repeat(200)}`,
      inAffirmativeLobby: i % 2 === 0,
      inNegativeLobby: false,
      actedAsTeller: null,
    }));
    const requests = installMembers((url) =>
      url.pathname.endsWith('/Voting')
        ? page(
            votes.slice(
              (Number(url.searchParams.get('page')) - 1) * 20,
              Number(url.searchParams.get('page')) * 20,
            ),
            23,
          )
        : { value: member() },
    );
    const ids: string[] = [];
    let cursor: string | undefined;
    const nativePages: number[] = [];
    do {
      const result = await runToolContract(ukparlGetMember, {
        memberId: '77',
        section: 'voting',
        house: 'commons',
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
      const output = ukparlGetMember.output.parse(result.structuredContent);
      expect(output.delivery).toBe('full');
      expect(output.nativePage).toBe(Math.floor(ids.length / 20) + 1);
      nativePages.push(output.nativePage!);
      expect(result.structuredContent).toMatchObject({
        requestedLimit: 1,
        cap: 20,
        shown: output.items!.length,
      });
      for (const vote of output.items!) {
        if (vote.kind !== 'vote') throw new Error('Wrong vote kind');
        ids.push(vote.divisionId);
        expect(text(result)).toContain(JSON.stringify(vote.value.title));
      }
      expect(text(result)).toContain('Neither lobby flag alone establishes abstention');
      cursor = output.page!.nextCursor;
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 23 }, (_, i) => String(100 + i)));
    expect(nativePages.filter((n) => n === 1).length).toBeGreaterThan(1);
    expect(nativePages.at(-1)).toBe(2);
    for (const request of requests.filter((url) => url.pathname.endsWith('/Voting'))) {
      expect(request.searchParams.has('skip')).toBe(false);
      expect(request.searchParams.get('house')).toBe('1');
    }
  });
});
