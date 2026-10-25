/**
 * @fileoverview Lossless whole-item paging and recursive bounded content delivery.
 * @module services/parliament-http/parliament-delivery
 */
import { z } from '@cyanheads/mcp-ts-core';
import { conflict, internalError } from '@cyanheads/mcp-ts-core/errors';
import {
  ContentCursorSchema,
  decodeCursor,
  digest,
  encodeCursor,
  invalidCursor,
} from './parliament-cursors.js';
import { type Page, PageSchema, type Source, SourceSchema } from './parliament-models.js';

/** Complete rendered result byte ceiling, including both MCP surfaces. */
export const DELIVERY_LIMIT_BYTES = 24_000;
const ValueTypeSchema = z.enum(['object', 'array', 'string', 'number', 'boolean', 'null']);
/** Recursive continuation metadata; fragments concatenate before one JSON parse. */
export const ContentPageSchema = z.object({
  path: z.string().describe('RFC 6901 pointer into the fully validated normalized payload.'),
  kind: z.enum(['object', 'array', 'scalar']).describe('Type of the selected subtree.'),
  entries: z
    .array(
      z
        .object({
          path: z.string().describe('Child RFC 6901 pointer.'),
          valueType: ValueTypeSchema.describe('JSON type of this child.'),
          sizeBytes: z
            .number()
            .int()
            .nonnegative()
            .describe('UTF-8 bytes of its complete JSON value.'),
          contentCursor: z.string().describe('Opaque same-tool child continuation.'),
        })
        .describe('One whole child continuation descriptor.'),
    )
    .optional()
    .describe('Whole child descriptors; follow every descriptor and continuation.'),
  fragment: z.string().optional().describe('JSON-encoded subtree or consecutive JSON-text chunk.'),
  encoding: z
    .literal('json')
    .optional()
    .describe('Concatenate chunks, then JSON-decode exactly once.'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('UTF-16 code-unit offset within JSON text.'),
  totalCodeUnits: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Complete JSON text length in UTF-16 code units.'),
  hasMore: z.boolean().describe('More descriptors or scalar chunks remain at this path.'),
  nextCursor: z
    .string()
    .optional()
    .describe('Opaque continuation for remaining descriptors or chunks.'),
});
/** Typed recursive continuation. */
export type ContentPage = z.infer<typeof ContentPageSchema>;
const CompactProvenanceSchema = z.object({
  api: SourceSchema.shape.api.describe('Official API namespace.'),
  origin: z.string().describe('Official origin only; the full request URL is at contentPath.'),
  retrievedAt: z.string().describe('Response retrieval time.'),
  licenceUrl: z.string().describe('Open Parliament Licence URL.'),
  contentPath: z
    .string()
    .describe('RFC 6901 pointer to full source provenance in the reconstructable payload.'),
});
/** Common output fields; domain schemas keep normal payload fields optional for outlines. */
export const DeliveryShape = {
  delivery: z
    .enum(['full', 'outline', 'fragment'])
    .describe('Full selected payload, child outline, or JSON fragment.'),
  contentPage: ContentPageSchema.optional().describe('Lossless recursive content continuation.'),
  retrieval: z.string().optional().describe('Same-tool retrieval instruction.'),
  provenance: z
    .union([
      SourceSchema.describe('Complete official request provenance.'),
      CompactProvenanceSchema.describe(
        'Compact provenance with a pointer to the complete request source.',
      ),
    ])
    .optional()
    .describe(
      'Selected response provenance retained during content retrieval; source notices remain in the reconstructed payload.',
    ),
  identity: z
    .record(z.string(), z.string())
    .optional()
    .describe('Stable selected-record identifiers retained during content retrieval.'),
  collectionPage: PageSchema.optional().describe(
    'Collection continuation; reconstruct the outlined selected payload before following it.',
  ),
};
/** Bounded content response omits the normal payload. */
export type ContentDelivery = {
  delivery: 'outline' | 'fragment';
  contentPage: ContentPage;
  retrieval: string;
  provenance?: Source | z.infer<typeof CompactProvenanceSchema>;
  identity?: Record<string, string>;
  collectionPage?: Page;
};

function json(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw internalError('Selected payload contains a non-JSON value.');
  return text;
}
function typeOf(value: unknown): z.infer<typeof ValueTypeSchema> {
  return value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : typeof value === 'object'
        ? 'object'
        : ValueTypeSchema.parse(typeof value);
}
function fenced(value: unknown): string {
  const text = json(value);
  const fences = text.match(/`+/g) ?? [];
  let fenceLength = 3;
  for (const run of fences) fenceLength = Math.max(fenceLength, run.length + 1);
  const fence = '`'.repeat(fenceLength);
  return `${fence}json\n${text}\n${fence}`;
}
/** Render every value recursively; source strings remain reversible JSON and links stay live. */
export function renderData(value: unknown, path = ''): string {
  if (value === null || typeof value !== 'object') {
    const link =
      typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value)
        ? `\n[Open source link](<${value.replaceAll('<', '%3C').replaceAll('>', '%3E')}>)`
        : '';
    return `${path || 'value'}\n${fenced(value)}${link}`;
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (!entries.length) return `${path || 'value'}\n${Array.isArray(value) ? '[]' : '{}'}`;
  return entries
    .map(([key, item]) =>
      renderData(item, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`),
    )
    .join('\n\n');
}
/** Default MCP content renderer, sharing the exact same data as structuredContent. */
export function formatData(value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: renderData(value) }];
}
/** Use this renderer on every enriched field so measured and framework trailers are identical. */
export function enrichmentField(key: string): (value: unknown) => string {
  return (value) => renderData(value, key);
}
/** Exact trailer emitted by per-field enrichmentField renderers, including the framework separator. */
export function renderEnrichment(values: object): string {
  return `\n\n${Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => enrichmentField(key)(value))
    .join('\n')}`;
}
/** Delivery dependencies supplied by each tool, including its complete enrichment trailer. */
export interface DeliveryOptions<T extends object, E extends object = object> {
  /** Apply exactly the measured values once; do not append late total/truncation metadata. */
  applyEnrichment?: ((values: E) => void) | undefined;
  /** Rebuild the domain page/cursor for the actual count; zero is never selected. */
  collection?: { count: number; repage: (count: number) => T } | undefined;
  contentCursor?: string | undefined;
  enrichment?: E | undefined;
  /** Pure computation of all final enriched values for this actual selected whole-item page. */
  enrichmentFor?: ((selectedPayload: T) => E) | undefined;
  enrichmentText?: string | undefined;
  format?: ((value: unknown) => { type: 'text'; text: string }[]) | undefined;
  /** Small source/identity fields repeated on continuation responses; full source notices stay in payload. */
  retained?:
    | ((selectedPayload: T) => { source?: Source; identity?: Record<string, string>; page?: Page })
    | undefined;
  selection: unknown;
  tool: string;
}
/** Measure the complete MCP result, accounting for both surfaces and enrichment. */
export function renderedBytes(
  value: object,
  options: Pick<DeliveryOptions<object>, 'enrichment' | 'enrichmentText' | 'format'> = {},
): number {
  const content = (options.format ?? formatData)(value);
  if (options.enrichment && Object.keys(options.enrichment).length)
    content.push({
      type: 'text',
      text: options.enrichmentText ?? renderEnrichment(options.enrichment),
    });
  return Buffer.byteLength(
    json({ content, structuredContent: { ...value, ...options.enrichment } }),
  );
}
function pointerValue(payload: unknown, path: string): unknown {
  if (path === '') return payload;
  if (!path.startsWith('/') || /~(?:[^01]|$)/.test(path)) return invalidCursor();
  let value = payload;
  for (const token of path.slice(1).split('/')) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key))
      return invalidCursor();
    if (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
      return invalidCursor();
    value = Reflect.get(value, key);
  }
  return value;
}
function findSourcePath(value: unknown, source: Source, path = ''): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  if (
    Object.hasOwn(value, 'api') &&
    Object.hasOwn(value, 'url') &&
    Reflect.get(value, 'api') === source.api &&
    Reflect.get(value, 'url') === source.url
  )
    return path;
  for (const [key, child] of Object.entries(value)) {
    const found = findSourcePath(
      child,
      source,
      `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
    );
    if (found !== undefined) return found;
  }
  return undefined;
}
function safeEnd(text: string, start: number, proposed: number): number {
  let end = Math.min(text.length, proposed);
  if (
    end < text.length &&
    end > start &&
    /[\uD800-\uDBFF]/.test(text[end - 1] ?? '') &&
    /[\uDC00-\uDFFF]/.test(text[end] ?? '')
  )
    end--;
  return end;
}
/** Fit whole collection items first, then recursively deliver only an indivisible oversized payload. */
export function deliverPayload<T extends object, E extends object = object>(
  initialPayload: T,
  options: DeliveryOptions<T, E>,
): (T & { delivery: 'full' }) | ContentDelivery {
  let payload = initialPayload;
  let enrichment = options.enrichmentFor?.(payload) ?? options.enrichment;
  const measure = (value: object) => renderedBytes(value, { ...options, enrichment });
  const finish = <R extends object>(value: R): R => {
    if (enrichment) options.applyEnrichment?.(enrichment);
    return value;
  };
  if (options.collection && options.collection.count > 0) {
    for (let count = options.collection.count; count >= 1; count--) {
      payload = options.collection.repage(count);
      enrichment = options.enrichmentFor?.(payload) ?? options.enrichment;
      if (measure({ ...payload, delivery: 'full' }) <= DELIVERY_LIMIT_BYTES) break;
    }
  }
  const full = { ...payload, delivery: 'full' as const };
  if (!options.contentCursor && measure(full) <= DELIVERY_LIMIT_BYTES) return finish(full);
  const binding = digest({ tool: options.tool, selection: options.selection });
  const revision = digest(payload, true);
  const cursor = options.contentCursor
    ? decodeCursor(options.contentCursor, ContentCursorSchema)
    : { v: 1 as const, binding, revision, path: '', arm: 'entries' as const, offset: 0 };
  if (cursor.binding !== binding) return invalidCursor();
  if (cursor.revision !== revision)
    throw conflict('The selected source changed during content retrieval.', {
      reason: 'source_changed',
      recovery: {
        hint: 'Repeat the same tool with its original filters and no contentCursor, then follow the new content cursors.',
      },
    });
  const selected = pointerValue(payload, cursor.path);
  const valueType = typeOf(selected);
  const kind = valueType === 'object' || valueType === 'array' ? valueType : 'scalar';
  if (options.contentCursor && cursor.arm !== (kind === 'scalar' ? 'fragment' : 'entries'))
    return invalidCursor();
  const context = options.retained?.(payload);
  const retained: Pick<ContentDelivery, 'provenance' | 'identity' | 'collectionPage'> = {
    ...(context?.source
      ? {
          provenance: {
            api: context.source.api,
            url: context.source.url,
            retrievedAt: context.source.retrievedAt,
            licenceUrl: context.source.licenceUrl,
          },
        }
      : {}),
    ...(context?.identity ? { identity: context.identity } : {}),
    ...(context?.page ? { collectionPage: context.page } : {}),
  };
  const retrieval = `Repeat ${options.tool} with the same original filters, mode, collection cursor and effective limit plus each contentCursor. Reconstruct this payload before advancing the collection cursor. Concatenate consecutive fragments before JSON-decoding once.`;
  const fits = (value: ContentDelivery): boolean => {
    if (measure(value) <= DELIVERY_LIMIT_BYTES) return true;
    const metadataOnly: ContentDelivery = {
      ...retained,
      delivery: 'outline',
      retrieval,
      contentPage: { path: cursor.path, kind, entries: [], hasMore: false },
    };
    const firstDescriptor = value.delivery === 'outline' && value.contentPage.entries?.length === 1;
    if (
      (measure(metadataOnly) > DELIVERY_LIMIT_BYTES || firstDescriptor) &&
      context?.source &&
      retained.provenance &&
      'url' in retained.provenance
    ) {
      const path = findSourcePath(payload, context.source);
      if (path === undefined)
        throw internalError('Retained provenance must also exist in the reconstructable payload.');
      retained.provenance = {
        api: context.source.api,
        origin: new URL(context.source.url).origin,
        retrievedAt: context.source.retrievedAt,
        licenceUrl: context.source.licenceUrl,
        contentPath: path,
      };
      value.provenance = retained.provenance;
    }
    return measure(value) <= DELIVERY_LIMIT_BYTES;
  };
  const makeCursor = (path: string, arm: 'entries' | 'fragment', offset: number) =>
    encodeCursor({ v: 1, binding, revision, path, arm, offset });
  const text = json(selected);
  const complete: ContentDelivery = {
    ...retained,
    delivery: 'fragment',
    retrieval,
    contentPage: {
      path: cursor.path,
      kind,
      fragment: text,
      encoding: 'json',
      offset: 0,
      totalCodeUnits: text.length,
      hasMore: false,
    },
  };
  if (cursor.offset === 0 && fits(complete)) return finish(complete);
  if (kind !== 'scalar') {
    if (cursor.arm !== 'entries') return invalidCursor();
    const children = Object.entries(selected as object).filter(
      ([, value]) => kind === 'array' || value !== undefined,
    );
    if (cursor.offset >= children.length) return invalidCursor();
    const entries: NonNullable<ContentPage['entries']> = [];
    let result: ContentDelivery | undefined;
    for (const [key, value] of children.slice(cursor.offset, cursor.offset + 20)) {
      const path = `${cursor.path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      const valueType = typeOf(value);
      entries.push({
        path,
        valueType,
        sizeBytes: Buffer.byteLength(json(value)),
        contentCursor: makeCursor(
          path,
          valueType === 'object' || valueType === 'array' ? 'entries' : 'fragment',
          0,
        ),
      });
      const end = cursor.offset + entries.length;
      const candidate: ContentDelivery = {
        ...retained,
        delivery: 'outline',
        retrieval,
        contentPage: {
          path: cursor.path,
          kind,
          entries: [...entries],
          hasMore: end < children.length,
          ...(end < children.length ? { nextCursor: makeCursor(cursor.path, 'entries', end) } : {}),
        },
      };
      if (!fits(candidate)) break;
      result = candidate;
    }
    if (!result) throw internalError('A content descriptor cannot fit the response envelope.');
    return finish(result);
  }
  if (cursor.arm !== 'fragment' && options.contentCursor) return invalidCursor();
  if (
    cursor.offset >= text.length ||
    (cursor.offset > 0 &&
      /[\uD800-\uDBFF]/.test(text[cursor.offset - 1] ?? '') &&
      /[\uDC00-\uDFFF]/.test(text[cursor.offset] ?? ''))
  )
    return invalidCursor();
  let end = safeEnd(text, cursor.offset, cursor.offset + 2000);
  while (end > cursor.offset) {
    const candidate: ContentDelivery = {
      ...retained,
      delivery: 'fragment',
      retrieval,
      contentPage: {
        path: cursor.path,
        kind,
        fragment: text.slice(cursor.offset, end),
        encoding: 'json',
        offset: cursor.offset,
        totalCodeUnits: text.length,
        hasMore: end < text.length,
        ...(end < text.length ? { nextCursor: makeCursor(cursor.path, 'fragment', end) } : {}),
      },
    };
    if (fits(candidate)) return finish(candidate);
    end = safeEnd(text, cursor.offset, end - 1);
  }
  throw internalError('A scalar code point cannot fit the response envelope.');
}
