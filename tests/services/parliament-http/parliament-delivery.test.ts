/**
 * @fileoverview Independent reconstruction of bounded Parliament content pages.
 * @module tests/services/parliament-http/parliament-delivery.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { describe, expect, it, vi } from 'vitest';
import {
  ContentCursorSchema,
  decodeCursor,
  digest,
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

/** Whole-record pages over `rows` from `offset`, continuing after the emitted count. */
function pageOver<R>(rows: R[], offset = 0) {
  return (count: number) => {
    const end = offset + count;
    return {
      items: rows.slice(offset, end),
      page: {
        returned: count,
        hasMore: end < rows.length,
        ...(end < rows.length ? { nextCursor: `offset-${end}` } : {}),
      },
    };
  };
}

/** Both surfaces carry the value; outline and fragment replies also fit 24,000 bytes. */
function assertSurfaces(value: object): void {
  const content = formatData(value);
  content.push(...formatData(enrichment));
  if (Reflect.get(value, 'delivery') !== 'full')
    expect(
      Buffer.byteLength(
        JSON.stringify({
          jsonrpc: '2.0',
          id: Number.MAX_SAFE_INTEGER,
          result: { structuredContent: { ...value, ...enrichment }, content },
        }),
      ),
    ).toBeLessThanOrEqual(24_000);
  const text = content.map((block) => block.text).join('\n');
  // Decode the complete JSON blocks independently of the renderer.
  const encoded = [...text.matchAll(/(`{3,})json\n([^\n]*)\n\1/g)].map((match) =>
    JSON.parse(match[2] ?? 'null'),
  );
  expect(encoded).toContainEqual(JSON.parse(JSON.stringify(value)));
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
        value:
          entry.jsonValue === undefined
            ? reconstruct(payload, entry.contentCursor, deliveryOptions)
            : JSON.parse(entry.jsonValue),
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
  it('preserves a pre-existing content cursor for a smaller whole-record prefix', () => {
    const items = [
      { id: 'first', text: 'x'.repeat(1000) },
      { id: 'second', text: 'y'.repeat(1000) },
    ];
    const payload = { items };
    const contentCursor = encodeCursor({
      v: 1,
      binding: digest({ tool: options.tool, selection }),
      revision: digest({ items: items.slice(0, 1) }, true),
      path: '/items',
      arm: 'entries',
      offset: 0,
    });
    expect(
      reconstruct(payload, contentCursor, {
        ...options,
        collection: { count: 2, repage: (count) => ({ items: items.slice(0, count) }) },
      }),
    ).toEqual([items[0]]);
  });
  it.each([
    ['limit 1, same page', 1],
    ['limit 3, larger page', 3],
  ])('resolves a 0.1.2 scalar fragment cursor minted for the first record (%s)', (_name, limit) => {
    const items = Array.from({ length: 3 }, (_, id) => ({
      id: `c${id}`,
      text: `${id}:${'é'.repeat(6000)}`,
    }));
    const repage = (count: number) => ({
      items: items.slice(0, count),
      page: { returned: count, hasMore: count < items.length },
    });
    const deliveryOptions = { ...options, collection: { count: limit, repage } };
    // 0.1.2 outlined this ~12 KB record alone and continued its text at offset 5499.
    const contentCursor = encodeCursor({
      v: 1,
      binding: digest({ tool: options.tool, selection }),
      revision: digest(repage(1), true),
      path: '/items/0/text',
      arm: 'fragment',
      offset: 5499,
    });
    const expected = JSON.stringify(items[0]!.text);
    let encoded = '';
    let cursor: string | undefined = contentCursor;
    do {
      const next = deliverPayload(repage(limit), {
        ...deliveryOptions,
        contentCursor: cursor,
      }) as ContentDelivery;
      assertSurfaces(next);
      expect(next.delivery).toBe('fragment');
      expect(next.contentPage).toMatchObject({
        path: '/items/0/text',
        offset: 5499 + encoded.length,
      });
      encoded += next.contentPage.fragment;
      cursor = next.contentPage.nextCursor;
    } while (cursor);
    expect(encoded).toBe(expected.slice(5499));
  });
  it('renders a complete record in one reversible JSON block with clickable source links', () => {
    const payload = {
      rows: [{ id: '42', html: '<p>Text</p>', nullable: null, url: 'https://example.test/source' }],
    };
    const rendered = formatData(payload)[0]!.text;
    expect(rendered).toContain(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``);
    expect(rendered).not.toContain('/rows/0/html');
    expect(rendered).toContain('[Open source link](<https://example.test/source>)');
  });
  it('inlines fitting child JSON without removing its equivalent continuation', () => {
    const payload = { text: 'a'.repeat(30000), small: { rows: [null, false, {}, []] } };
    const result = deliverPayload(payload, options) as ContentDelivery;
    const entry = result.contentPage.entries!.find((row) => row.path === '/small')!;
    expect(entry).toHaveProperty('jsonValue', JSON.stringify(payload.small));
    expect(reconstruct(payload, entry.contentCursor)).toEqual(payload.small);
  });
  it('uses the remaining response budget for Unicode scalar fragments', () => {
    const payload = { text: '🦊'.repeat(30000) };
    const outline = deliverPayload(payload, options) as ContentDelivery;
    const fragment = deliverPayload(payload, {
      ...options,
      contentCursor: outline.contentPage.entries![0]!.contentCursor,
    }) as ContentDelivery;
    expect(fragment.contentPage.fragment!.length).toBeGreaterThan(2000);
    assertSurfaces(fragment);
    expect(reconstruct(payload)).toEqual(payload);
  });
  it('keeps inline JSON and cursor retrieval equivalent through nested descriptor pages', () => {
    const rows = Array.from({ length: 27 }, (_, id) => ({
      id,
      'a/b~c': {
        html: `<p>${'文'.repeat(900)}</p>`,
        nullable: null,
        empty: [],
        source: 'https://example.test/source',
      },
    }));
    const payload = { rows };
    const root = deliverPayload(payload, options) as ContentDelivery;
    const rowsCursor = root.contentPage.entries!.find(
      (entry) => entry.path === '/rows',
    )!.contentCursor;
    let page = (
      deliverPayload(payload, { ...options, contentCursor: rowsCursor }) as ContentDelivery
    ).contentPage;
    const restored: unknown[] = [];
    let inlineCount = 0;
    let pages = 0;
    for (;;) {
      pages++;
      for (const entry of page.entries!) {
        const fetched = reconstruct(payload, entry.contentCursor);
        if (entry.jsonValue !== undefined) {
          const inline = JSON.parse(entry.jsonValue);
          expect(inline).toEqual(fetched);
          inlineCount++;
        }
        restored.push(fetched);
      }
      if (!page.hasMore) break;
      page = (
        deliverPayload(payload, { ...options, contentCursor: page.nextCursor }) as ContentDelivery
      ).contentPage;
    }
    expect(restored).toEqual(rows);
    expect(inlineCount).toBeGreaterThan(0);
    expect(pages).toBeGreaterThan(1);
    expect(reconstruct(payload)).toEqual(payload);
  });
  it('preserves literal HTML, null, false, empty collections and source links', () => {
    const payload = {
      html: '<p>source &amp; text</p>',
      nullable: null,
      flag: false,
      rows: [],
      metadata: {},
      url: 'https://example.test/source',
    };
    const result = deliverPayload(payload, options);
    expect(result).toEqual({ ...payload, delivery: 'full' });
    assertSurfaces(result);
    expect(formatData(result)[0]!.text).toContain(
      '[Open source link](<https://example.test/source>)',
    );
  });
  it.each([
    ['many short runs', '`a'.repeat(150000), '```'],
    ['one long run', '`'.repeat(100), '`'.repeat(101)],
    ['ordinary text', 'Ordinary source text.', '```'],
  ])(
    'renders %s with a reversible complete scalar and an adequate fence',
    (_name, value, fence) => {
      expect(process.release.name).toBe('node');
      expect(formatData({ nameContains: value })).toEqual([
        {
          type: 'text',
          text: `value\n${fence}json\n${JSON.stringify({ nameContains: value })}\n${fence}`,
        },
      ]);
    },
  );

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
      if (result.delivery === 'full') throw new Error('Expected content continuation.');
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
      expect(result.provenance).not.toHaveProperty('notices');
      if (result.delivery === 'outline') {
        const sourceEntry = result.contentPage.entries!.find((entry) => entry.path === '/source')!;
        expect(JSON.parse(sourceEntry.jsonValue!)).toEqual(source);
      } else expect(rendered).not.toContain('Complete source notice.');
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
  it('serializes only the selected subtree on a single-payload content-cursor call', () => {
    const payload = { record: { id: '42', text: 'x'.repeat(30_000), more: 'y'.repeat(30_000) } };
    const outline = deliverPayload(payload, options) as ContentDelivery;
    const child = outline.contentPage.entries?.find((entry) => entry.jsonValue === undefined);
    expect(child?.path).toBe('/record');
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      const next = deliverPayload(payload, { ...options, contentCursor: child?.contentCursor });
      expect(next.delivery).toBe('outline');
      expect(stringify.mock.calls.filter(([value]) => value === payload)).toHaveLength(0);
    } finally {
      stringify.mockRestore();
    }
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

  it.each([20, 100])(
    'returns all %i requested whole records however large the combined page',
    (limit) => {
      const rows = Array.from({ length: 100 }, (_, id) => ({
        id: String(id),
        text: 'é'.repeat(2500),
      }));
      const repage = pageOver(rows);
      const result = deliverPayload(repage(limit), {
        ...options,
        collection: { count: limit, repage },
      });
      expect(result).toEqual({
        delivery: 'full',
        items: rows.slice(0, limit),
        page: {
          returned: limit,
          hasMore: limit < 100,
          ...(limit < 100 ? { nextCursor: `offset-${limit}` } : {}),
        },
      });
      expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(limit * 5000);
      assertSurfaces(result);
    },
  );

  it('stops a page before an oversized record, then serves that record alone as an exact outline', () => {
    // Two 8 KB records exceed a 24,000-byte reply together but are each far under the limit.
    const rows = [
      { id: 'a', text: 'é'.repeat(4000) },
      { id: 'b', text: 'è'.repeat(4000) },
      { id: 'big', text: '🦊"<p>\n'.repeat(5000) },
      { id: 'c', text: 'small c' },
    ];
    expect(Buffer.byteLength(JSON.stringify(rows[2]))).toBeGreaterThan(24_000);
    const first = pageOver(rows);
    expect(
      deliverPayload(first(4), { ...options, collection: { count: 4, repage: first } }),
    ).toEqual({
      delivery: 'full',
      items: rows.slice(0, 2),
      page: { returned: 2, hasMore: true, nextCursor: 'offset-2' },
    });
    const second = pageOver(rows, 2);
    const secondOptions = {
      ...options,
      selection: { ...selection, cursor: 'offset-2' },
      collection: { count: 2, repage: second },
    };
    const outline = deliverPayload(second(2), secondOptions);
    expect(outline.delivery).toBe('outline');
    expect(reconstruct(second(2), undefined, secondOptions)).toEqual({
      items: [rows[2]],
      page: { returned: 1, hasMore: true, nextCursor: 'offset-3' },
    });
    const third = pageOver(rows, 3);
    expect(
      deliverPayload(third(1), { ...options, collection: { count: 1, repage: third } }),
    ).toEqual({ delivery: 'full', items: [rows[3]], page: { returned: 1, hasMore: false } });
  });

  it.each([
    ['exactly 24,000 bytes', 'é'.repeat(11_990), 24_000, 3],
    ['24,001 bytes', `${'é'.repeat(11_990)}a`, 24_001, 1],
  ])('sizes a collection record in UTF-8 bytes: %s', (_name, text, bytes, returned) => {
    const rows = [
      { id: 'a', text: 'small' },
      { id: 'r', text },
      { id: 'c', text: 'small' },
    ];
    expect(Buffer.byteLength(JSON.stringify(rows[1]))).toBe(bytes);
    // About half as many UTF-16 code units, so a code-unit count would keep this record.
    expect(JSON.stringify(rows[1]).length).toBeLessThan(12_100);
    const repage = pageOver(rows);
    expect(deliverPayload(repage(3), { ...options, collection: { count: 3, repage } })).toEqual({
      ...repage(returned),
      delivery: 'full',
    });
  });

  it.each([
    ['a 15,000-byte payload', 'x'.repeat(14_989), 15_000, 'full'],
    ['exactly 24,000 bytes', `${'é'.repeat(11_994)}a`, 24_000, 'full'],
    ['24,001 bytes', `${'é'.repeat(11_994)}ab`, 24_001, 'outline'],
  ])('delivers a single payload by its own UTF-8 JSON size: %s', (_name, text, bytes, delivery) => {
    const payload = { text };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBe(bytes);
    const result = deliverPayload(payload, options);
    expect(result.delivery).toBe(delivery);
    assertSurfaces(result);
    expect(reconstruct(payload)).toEqual(payload);
  });

  it('finds the record array by its growth, nested and beside a fixed one-element array', () => {
    // A 13 KB first voter is whole; the 30 KB second one is oversized.
    const voters = [
      { id: 'v1', name: 'é'.repeat(6500) },
      { id: 'v2', name: 'x'.repeat(30_000) },
    ];
    const repageFrom =
      (offset: number) =>
      (count: number): object => ({
        sources: ['https://example.test/one'],
        data: {
          house: 'commons',
          // Some pages omit the record array when it is empty.
          ...(count ? { voters: voters.slice(offset, offset + count) } : {}),
        },
        page: { returned: count },
      });
    const first = repageFrom(0);
    expect(
      deliverPayload(first(2), { ...options, collection: { count: 2, repage: first } }),
    ).toEqual({ ...first(1), delivery: 'full' });
    const second = repageFrom(1);
    const secondOptions = { ...options, collection: { count: 1, repage: second } };
    expect(deliverPayload(second(1), secondOptions).delivery).toBe('outline');
    expect(reconstruct(second(1), undefined, secondOptions)).toEqual(second(1));
  });

  it('fails loudly when a repage grows no record array or several', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    for (const repage of [
      (count: number) => ({ count }),
      (count: number) => ({ items: rows.slice(0, count), copy: rows.slice(0, count) }),
    ])
      expect(() =>
        deliverPayload(repage(2), { ...options, collection: { count: 2, repage } }),
      ).toThrow(expect.objectContaining({ code: JsonRpcErrorCode.InternalError }));
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
    expect(formatData(result)[0]?.text).toContain('"items":[]');
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
