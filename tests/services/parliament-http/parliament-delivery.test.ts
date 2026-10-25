/**
 * @fileoverview Independent reconstruction of bounded Parliament content pages.
 * @module tests/services/parliament-http/parliament-delivery.test
 */
import { describe, expect, it } from 'vitest';
import {
  ContentCursorSchema,
  decodeCursor,
  encodeCursor,
} from '@/services/parliament-http/parliament-cursors.js';
import {
  type ContentDelivery,
  type DeliveryOptions,
  deliverPayload,
  formatData,
} from '@/services/parliament-http/parliament-delivery.js';
import { LICENCE_URL, type Source } from '@/services/parliament-http/parliament-models.js';

const selection = { memberId: '42', section: 'interests', limit: 20 };
const enrichment = { applied: selection, notice: 'Contains Parliamentary information.' };
const options = { tool: 'ukparl_get_member', selection, enrichment };

function assertSurfaces(value: object): void {
  const content = formatData(value);
  content.push(...formatData(enrichment));
  expect(
    Buffer.byteLength(JSON.stringify({ structuredContent: { ...value, ...enrichment }, content })),
  ).toBeLessThanOrEqual(24_000);
  const text = content.map((block) => block.text).join('\n');
  // Every scalar is JSON fenced; decode each fence independently of the renderer.
  const encoded = [...text.matchAll(/(`{3,})json\n([^\n]*)\n\1/g)].map((match) =>
    JSON.parse(match[2] ?? 'null'),
  );
  function visit(node: unknown): void {
    if (node !== null && typeof node === 'object')
      for (const child of Object.values(node)) visit(child);
    else expect(encoded).toContainEqual(node);
  }
  visit(value);
}

function reconstruct(
  payload: object,
  contentCursor?: string,
  deliveryOptions: DeliveryOptions<object> = options,
): unknown {
  const result = deliverPayload(payload, {
    ...deliveryOptions,
    ...(contentCursor ? { contentCursor } : {}),
  });
  assertSurfaces(result);
  if (result.delivery === 'full') {
    const { delivery: _delivery, ...value } = result;
    return value;
  }
  const first = result as ContentDelivery;
  if (first.contentPage.fragment !== undefined) {
    let encoded = first.contentPage.fragment;
    let page = first.contentPage;
    while (page.hasMore) {
      const next = deliverPayload(payload, {
        ...deliveryOptions,
        contentCursor: page.nextCursor,
      }) as ContentDelivery;
      assertSurfaces(next);
      expect(next.contentPage.offset).toBe(encoded.length);
      expect(next.contentPage.fragment?.length).toBeGreaterThan(0);
      const fragment = next.contentPage.fragment ?? '';
      expect(/[\uD800-\uDBFF]$/.test(fragment)).toBe(false);
      encoded += fragment;
      page = next.contentPage;
    }
    expect(encoded.length).toBe(page.totalCodeUnits);
    return JSON.parse(encoded);
  }
  const output: Record<string, unknown> | unknown[] = first.contentPage.kind === 'array' ? [] : {};
  let page = first.contentPage;
  for (;;) {
    expect(page.entries?.length).toBeGreaterThan(0);
    expect(page.entries?.length).toBeLessThanOrEqual(20);
    for (const entry of page.entries ?? []) {
      const key = entry.path
        .slice(entry.path.lastIndexOf('/') + 1)
        .replaceAll('~1', '/')
        .replaceAll('~0', '~');
      Object.defineProperty(output, key, {
        value: reconstruct(payload, entry.contentCursor, deliveryOptions),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (!page.hasMore) break;
    const next = deliverPayload(payload, {
      ...deliveryOptions,
      contentCursor: page.nextCursor,
    }) as ContentDelivery;
    assertSurfaces(next);
    page = next.contentPage;
  }
  return output;
}

describe('lossless content delivery', () => {
  it('retains source, identity and actual collection page on outline and fragment surfaces', () => {
    const source: Source = {
      api: 'members',
      url: 'https://members-api.parliament.uk/api/Members/42',
      retrievedAt: '2026-10-25T00:00:00Z',
      licenceUrl: LICENCE_URL,
      notices: ['Complete source notice.'],
    };
    const payload = {
      source,
      id: '42',
      text: '🦊'.repeat(20000),
      page: { returned: 1, hasMore: true, nextCursor: 'next-whole-item', total: 2 },
    };
    const retainedOptions = {
      ...options,
      retained: () => ({ source, identity: { memberId: '42' }, page: payload.page }),
    };
    const outline = deliverPayload(payload, retainedOptions);
    expect(outline.delivery).toBe('outline');
    if (outline.delivery === 'full') throw new Error('Expected outline.');
    const cursor = outline.contentPage.entries?.find(
      (entry) => entry.path === '/text',
    )?.contentCursor;
    expect(cursor).toBeDefined();
    if (!cursor) throw new Error('Expected text continuation.');
    const fragment = deliverPayload(payload, { ...retainedOptions, contentCursor: cursor });
    expect(fragment.delivery).toBe('fragment');
    for (const result of [outline, fragment]) {
      expect(result).toMatchObject({
        provenance: {
          api: 'members',
          url: source.url,
          retrievedAt: source.retrievedAt,
          licenceUrl: LICENCE_URL,
        },
        identity: { memberId: '42' },
        collectionPage: payload.page,
      });
      assertSurfaces(result);
      const rendered = formatData(result)[0]?.text ?? '';
      for (const value of [
        source.url,
        source.retrievedAt,
        LICENCE_URL,
        'memberId',
        'next-whole-item',
      ])
        expect(rendered).toContain(value);
      expect(rendered).not.toContain('Complete source notice.');
    }
    expect(reconstruct(payload, undefined, retainedOptions)).toEqual(payload);
  });

  it('retrieves an oversized source URL without repeating it into every content envelope', () => {
    const source: Source = {
      api: 'members',
      url: `https://members-api.parliament.uk/api/Members/Search?Name=${'a'.repeat(14000)}`,
      retrievedAt: '2026-10-25T00:00:00Z',
      licenceUrl: LICENCE_URL,
    };
    const payload = {
      source,
      id: '42',
      text: 'x'.repeat(30000),
      page: { returned: 1, hasMore: false, total: 1 },
    };
    expect(
      reconstruct(payload, undefined, {
        ...options,
        retained: () => ({ source, identity: { memberId: '42' }, page: payload.page }),
      }),
    ).toEqual(payload);
  });
  it('reconstructs nested arrays, many descriptors, pointers and escaped Unicode scalars', () => {
    const text = '🦊漢字\n"quoted"\\<p>source</p>```'.repeat(1500);
    const payload = {
      record: {
        id: '42',
        'a/b~c': text,
        nullable: null,
        knownFalse: false,
        zero: 0,
        categories: Array.from({ length: 27 }, (_, id) => ({
          id,
          children: [
            {
              description: text,
              links: [{ url: 'https://example.test/evidence', label: 'Evidence' }],
            },
          ],
        })),
      },
    };
    expect(reconstruct(payload)).toEqual(payload);
  });

  it('reduces an ordinary page to whole items and reports the actual emitted count', () => {
    const items = Array.from({ length: 20 }, (_, id) => ({
      id: String(id),
      text: 'é'.repeat(900),
    }));
    const result = deliverPayload(
      { items, page: { returned: 20, hasMore: false } },
      {
        ...options,
        collection: {
          count: 20,
          repage: (count) => ({
            items: items.slice(0, count),
            page: { returned: count, hasMore: count < 20 },
          }),
        },
      },
    );
    assertSurfaces(result);
    expect(result.delivery).toBe('full');
    if (result.delivery !== 'full') throw new Error('Expected a whole-item page.');
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThan(20);
    expect(result.items).toEqual(items.slice(0, result.page.returned));
    expect(result.page.hasMore).toBe(true);
  });

  it('outlines only the oversized first item while retaining collection continuation', () => {
    const items = [
      { id: 'first', text: 'x'.repeat(30000) },
      { id: 'second', text: 'small' },
    ];
    const payload = { items, page: { returned: 2, hasMore: false, nextCursor: 'after-two' } };
    const deliveryOptions = {
      ...options,
      collection: {
        count: 2,
        repage: (count: number) => ({
          items: items.slice(0, count),
          page: { returned: count, hasMore: true, nextCursor: `after-${count}` },
        }),
      },
    };
    const result = deliverPayload(payload, deliveryOptions);
    expect(result.delivery).toBe('outline');
    assertSurfaces(result);
    expect(reconstruct(payload, undefined, deliveryOptions)).toEqual({
      items: [items[0]],
      page: { returned: 1, hasMore: true, nextCursor: 'after-1' },
    });
  });

  it('keeps an empty selected collection distinct from absent data', () => {
    const result = deliverPayload(
      { items: [], page: { returned: 0, hasMore: false, total: 0 } },
      options,
    );
    expect(result).toEqual({
      delivery: 'full',
      items: [],
      page: { returned: 0, hasMore: false, total: 0 },
    });
    assertSurfaces(result);
    expect(formatData(result)[0]?.text).toContain('/items\n[]');
    expect(formatData(result)[0]?.text).not.toContain('nextCursor');
  });

  it('rejects changed filters, source revisions, traversal and unsupported cursors', () => {
    const payload = { text: 'a'.repeat(30000), source: { retrievedAt: '2026-01-01T00:00:00Z' } };
    const result = deliverPayload(payload, options) as ContentDelivery;
    const cursor = result.contentPage.entries?.[0]?.contentCursor;
    expect(cursor).toBeDefined();
    if (!cursor) throw new Error('Expected a child cursor.');
    expect(() =>
      deliverPayload(payload, {
        ...options,
        selection: { ...selection, memberId: '43' },
        contentCursor: cursor,
      }),
    ).toThrow(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'invalid_cursor' }) }),
    );
    expect(() =>
      deliverPayload(
        { ...payload, text: 'b'.repeat(30000) },
        { ...options, contentCursor: cursor },
      ),
    ).toThrow(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'source_changed' }) }),
    );
    expect(() =>
      deliverPayload(
        { ...payload, source: { retrievedAt: '2026-02-01T00:00:00Z' } },
        { ...options, contentCursor: cursor },
      ),
    ).not.toThrow();
    const decoded = decodeCursor(cursor, ContentCursorSchema);
    for (const path of ['/__proto__', '/constructor', '/text/~2bad'])
      expect(() =>
        deliverPayload(payload, { ...options, contentCursor: encodeCursor({ ...decoded, path }) }),
      ).toThrow(
        expect.objectContaining({ data: expect.objectContaining({ reason: 'invalid_cursor' }) }),
      );
    for (const offset of [30003, 1000000])
      expect(() =>
        deliverPayload(payload, {
          ...options,
          contentCursor: encodeCursor({ ...decoded, offset }),
        }),
      ).toThrow(
        expect.objectContaining({ data: expect.objectContaining({ reason: 'invalid_cursor' }) }),
      );
  });
});
