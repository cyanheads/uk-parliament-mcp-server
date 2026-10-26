/**
 * @fileoverview Stateless filter-bound collection and content cursors.
 * @module services/parliament-http/parliament-cursors
 */
import { createHash } from 'node:crypto';
import { z } from '@cyanheads/mcp-ts-core';
import { invalidParams } from '@cyanheads/mcp-ts-core/errors';
import type { Page } from './parliament-models.js';

function canonical(value: unknown, omitRetrieval: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => canonical(item, omitRetrieval));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, item]) => item !== undefined && !(omitRetrieval && key === 'retrievedAt'))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item, omitRetrieval)]),
    );
  }
  return value;
}
/** Stable normalized query/payload digest; source retrieval clocks do not represent revisions. */
export function digest(value: unknown, omitRetrieval = false): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value, omitRetrieval)))
    .digest('base64url');
}
/** Raise the shared cursor failure with a restart instruction. */
export function invalidCursor(): never {
  throw invalidParams('Cursor does not match this selection.', {
    reason: 'invalid_cursor',
    recovery: {
      hint: 'Repeat the same tool with the same filters and no cursor or contentCursor to start a new page sequence.',
    },
  });
}
/** Strict collection cursor keeps native-page remainders without losing rows. */
export const CollectionCursorSchema = z
  .object({
    v: z.literal(1),
    source: z.string(),
    selector: z.string(),
    filters: z.string(),
    // Upstream skip/take parameters are int32.
    offset: z.number().int().nonnegative().max(2147483647),
    nativePage: z.number().int().positive().optional(),
    nativePageSize: z.number().int().positive(),
    intraPageOffset: z.number().int().nonnegative().optional(),
  })
  .strict();
/** Parsed collection cursor. */
export type CollectionCursor = z.infer<typeof CollectionCursorSchema>;
/** Content cursor cannot choose a route, origin or query parameter. */
export const ContentCursorSchema = z
  .object({
    v: z.literal(1),
    binding: z.string(),
    revision: z.string(),
    path: z.string(),
    arm: z.enum(['entries', 'fragment']),
    offset: z.number().int().nonnegative(),
  })
  .strict();
/** Parsed content continuation. */
export type ContentCursor = z.infer<typeof ContentCursorSchema>;
/** Encode validated cursor data as opaque base64url JSON. */
export function encodeCursor(value: CollectionCursor | ContentCursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
/** Parse strict versioned cursor data; noncanonical encodings are rejected. */
export function decodeCursor<T extends z.ZodType>(value: string, schema: T): z.infer<T> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return invalidCursor();
  let parsed: unknown;
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return invalidCursor();
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return invalidCursor();
  }
  const result = schema.safeParse(parsed);
  if (!result.success) return invalidCursor();
  return result.data;
}
/** Validate binding before a collection cursor can influence upstream offsets. */
export function readCollectionCursor(
  value: string | undefined,
  binding: { source: string; selector: string; filters: unknown; nativePageSize: number },
): CollectionCursor {
  const expected = {
    source: binding.source,
    selector: binding.selector,
    filters: digest(binding.filters),
    nativePageSize: binding.nativePageSize,
  };
  if (!value) return { v: 1, ...expected, offset: 0 };
  const cursor = decodeCursor(value, CollectionCursorSchema);
  if (
    cursor.source !== expected.source ||
    cursor.selector !== expected.selector ||
    cursor.filters !== expected.filters ||
    cursor.nativePageSize !== expected.nativePageSize ||
    (cursor.intraPageOffset !== undefined && cursor.intraPageOffset >= cursor.nativePageSize) ||
    (cursor.nativePage !== undefined &&
      cursor.offset !==
        (cursor.nativePage - 1) * cursor.nativePageSize + (cursor.intraPageOffset ?? 0))
  )
    return invalidCursor();
  return cursor;
}
/** Advance by emitted whole items, preserving a native page's unreturned remainder. */
export function advanceCollectionCursor(cursor: CollectionCursor, emitted: number): string {
  const offset = cursor.offset + emitted;
  if (cursor.nativePage !== undefined)
    return encodeCursor({
      ...cursor,
      offset,
      nativePage: Math.floor(offset / cursor.nativePageSize) + 1,
      intraPageOffset: offset % cursor.nativePageSize,
    });
  return encodeCursor({ ...cursor, offset });
}
/** Whole-item page against a known total; the continuation advances by the emitted count. */
export function pageFor(cursor: CollectionCursor, returned: number, total: number): Page {
  const hasMore = cursor.offset + returned < total;
  return {
    returned,
    total,
    hasMore,
    ...(hasMore ? { nextCursor: advanceCollectionCursor(cursor, returned) } : {}),
  };
}
