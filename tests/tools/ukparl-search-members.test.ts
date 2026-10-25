/**
 * @fileoverview Member discovery contracts across both MCP consumption paths.
 * @module tests/tools/ukparl-search-members.test
 */
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ukparlSearchMembers } from '@/mcp-server/tools/definitions/ukparl-search-members.tool.js';
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
afterEach(() => {
  disposeMembers();
  disposeParliamentHttp();
});
describe('ukparl_search_members', () => {
  it('renders queue saturation with exact-tool recovery on both surfaces', async () => {
    await withFullMembersQueue(async () => {
      const result = await runToolContract(ukparlSearchMembers, {});
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          data: {
            reason: 'queue_full',
            recovery: { hint: expect.stringContaining('ukparl_search_members') },
          },
        },
      });
      expect(text(result)).toContain('queue_full');
      expect(text(result)).toContain(
        'Wait briefly, then repeat ukparl_search_members with the same filters.',
      );
    });
  });
  it('preserves sparse historical membership and full provenance on both surfaces', async () => {
    const requests = installMembers(() => page([member()]));
    const result = await runToolContract(ukparlSearchMembers, {
      asOf: '2001-01-01',
      name: ' Synthetic ',
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      mode: 'historical',
      query: { asOf: '2001-01-01', name: 'Synthetic', currentOnly: false },
      items: [
        {
          memberId: '77',
          latestParty: null,
          latestHouseMembership: null,
          source: { url: requests[0]!.href },
        },
      ],
    });
    for (const value of [
      'historical',
      '2001-01-01',
      'latestHouseMembership',
      'null',
      'retrievedAt',
      'licenceUrl',
      requests[0]!.href,
    ])
      expect(text(result)).toContain(value);
  });
  it.each([
    { house: 'commons' },
    { currentOnly: true },
    { partyId: '1' },
    { constituency: 'Synthetic' },
  ])('rejects incompatible historical filters %j before I/O', async (filter) => {
    const requests = installMembers(() => page([]));
    const result = await runToolContract(ukparlSearchMembers, { asOf: '2001-01-01', ...filter });
    expect(result.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_mode_arguments' } },
    });
    expect(text(result)).toContain('asOf');
    expect(text(result)).toContain('ukparl_search_members');
    expect(requests).toEqual([]);
  });
  it('discloses empty results and overcap limits, without adding current status', async () => {
    const requests = installMembers(() => page([]));
    const result = await runToolContract(ukparlSearchMembers, { limit: 1000 });
    expect(result.structuredContent).toMatchObject({
      items: [],
      totalCount: 0,
      requestedLimit: 1000,
      cap: 20,
      page: { returned: 0, hasMore: false },
    });
    expect(text(result)).toContain('currentOnly=false');
    expect(text(result)).toContain('capped at 20');
    expect(requests[0]!.searchParams.has('IsCurrentMember')).toBe(false);
  });
  it('pages UTF-8 whole records by actual emitted counts without duplicates', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => member(77 + i, `${i} ${'文🏛️'.repeat(250)}`));
    const requests = installMembers((url) =>
      page(
        rows.slice(
          Number(url.searchParams.get('skip')),
          Number(url.searchParams.get('skip')) + Number(url.searchParams.get('take')),
        ),
        6,
      ),
    );
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await runToolContract(ukparlSearchMembers, {
        limit: 6,
        ...(cursor ? { cursor } : {}),
      });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
      const output = ukparlSearchMembers.output.parse(result.structuredContent);
      expect(output.delivery).toBe('full');
      expect(requests.at(-1)!.searchParams.get('skip')).toBe(String(ids.length));
      for (const row of output.items!) {
        ids.push(row.memberId);
        expect(text(result)).toContain(JSON.stringify(row.nameDisplayAs));
      }
      cursor = output.page!.nextCursor;
    } while (cursor);
    expect(ids).toEqual(['77', '78', '79', '80', '81', '82']);
    expect(requests.length).toBeGreaterThan(1);
  });
  it('rejects malformed and rebound cursors with recovery on both surfaces', async () => {
    installMembers(() => page([member()], 2));
    const first = await runToolContract(ukparlSearchMembers, { limit: 1 });
    const cursor = ukparlSearchMembers.output.parse(first.structuredContent).page!.nextCursor!;
    for (const input of [{ cursor: 'bad!' }, { cursor, limit: 1, name: 'changed' }]) {
      const result = await runToolContract(ukparlSearchMembers, input);
      expect(result.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_cursor' } },
      });
      expect(text(result)).toContain('no cursor or contentCursor');
    }
  });
  it('handles a valid offset beyond the source end without inferring more records', async () => {
    const requests = installMembers(() => page([], 3));
    const cursor = advanceCollectionCursor(
      readCollectionCursor(undefined, {
        source: 'members',
        selector: 'search',
        filters: { currentOnly: false },
        nativePageSize: 10,
      }),
      99,
    );
    const result = await runToolContract(ukparlSearchMembers, { cursor });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      items: [],
      totalCount: 3,
      page: { returned: 0, hasMore: false },
    });
    expect(requests[0]!.searchParams.get('skip')).toBe('99');
    expect(text(result)).toContain('returned');
  });
  it('reports changed content revisions and rebound content selections on both surfaces', async () => {
    let name = 'Synthetic 文'.repeat(4000);
    installMembers(() => page([member(77, name)]));
    const first = await runToolContract(ukparlSearchMembers, {});
    const cursor = ukparlSearchMembers.output.parse(first.structuredContent).contentPage!
      .entries![0]!.contentCursor;
    const rebound = await runToolContract(ukparlSearchMembers, {
      name: 'Different',
      contentCursor: cursor,
    });
    expect(rebound.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(rebound)).toContain('no cursor or contentCursor');
    name = 'Changed synthetic';
    const changed = await runToolContract(ukparlSearchMembers, { contentCursor: cursor });
    expect(changed.structuredContent).toMatchObject({
      error: { data: { reason: 'source_changed' } },
    });
    expect(text(changed)).toContain('original filters');
  });
});
