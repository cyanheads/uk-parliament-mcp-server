/**
 * @fileoverview Shared Parliament identifiers, provenance and pagination schemas.
 * @module services/parliament-http/parliament-models
 */
import { z } from '@cyanheads/mcp-ts-core';
import { invalidParams } from '@cyanheads/mcp-ts-core/errors';

/** Blank optional form fields are omitted before their validators run. */
export function optionalText<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );
}

/** Positive int32 identifiers remain decimal strings until an upstream numeric boundary. */
export const IdSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && /^[0-9]+$/.test(value) ? value.replace(/^0+(?=\d)/, '') : value,
  z
    .string()
    .regex(/^[0-9]+$/)
    .refine(
      (value) => /^[0-9]+$/.test(value) && BigInt(value) > 0n && BigInt(value) <= 2147483647n,
      'Use a positive int32 decimal identifier.',
    ),
);
/** Canonical Parliament chambers, accepting exact official display aliases. */
export const HouseSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toLowerCase();
    return normalized === 'house of commons'
      ? 'commons'
      : normalized === 'house of lords'
        ? 'lords'
        : normalized;
  },
  z.enum(['commons', 'lords']),
);
/** Canonical House used by public records. */
export type House = z.infer<typeof HouseSchema>;
/** Official API namespaces; IDs from different sources are not interchangeable. */
export const ApiSchema = z.enum([
  'bills',
  'members',
  'commons_votes',
  'lords_votes',
  'hansard',
  'questions',
  'committees',
]);
/** Official API namespace. */
export type Api = z.infer<typeof ApiSchema>;
/** Open Parliament Licence applies subject to its stated exclusions. */
export const LICENCE_URL =
  'https://www.parliament.uk/site-information/copyright-parliament/open-parliament-licence/';
/** Required attribution and exclusions, suitable for both client surfaces. */
export const LICENCE_NOTICE =
  'Contains Parliamentary information licensed under the Open Parliament Licence v3.0 where applicable. Personal data, parliamentary marks and third-party rights are excluded. Independent software; no parliamentary endorsement.';
/** Provenance for a selected official response. */
export const SourceSchema = z.object({
  api: ApiSchema.describe('Official API namespace.'),
  url: z.string().describe('Actual official HTTPS request URL.'),
  retrievedAt: z.iso.datetime().describe('Response retrieval time in ISO 8601 UTC.'),
  licenceUrl: z.string().describe('Open Parliament Licence HTTPS URL; its exclusions still apply.'),
  notices: z
    .array(z.string().describe('Source notice preserved verbatim.'))
    .optional()
    .describe('Source-specific notices.'),
});
/** Official response provenance. */
export type Source = z.infer<typeof SourceSchema>;
/** A published link, never implicitly downloaded. */
export const LinkSchema = z.object({
  url: z.string().describe('Published document URL.'),
  label: z.string().describe('Published link label.'),
  documentId: z.string().optional().describe('Upstream document identifier.'),
  format: z.string().optional().describe('Published format or media type.'),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Published document size in bytes.'),
  publicationDate: z.string().optional().describe('Published date as supplied by the source.'),
});
/** Published document link. */
export type Link = z.infer<typeof LinkSchema>;
/** Whole-item collection continuation, distinct from content continuation. */
export const PageSchema = z.object({
  returned: z.number().int().nonnegative().describe('Whole items emitted on this page.'),
  hasMore: z.boolean().describe('Further collection items remain.'),
  nextCursor: z
    .string()
    .optional()
    .describe('Opaque collection continuation; repeat the same filters.'),
  total: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Total supplied by the source or fully read local collection.'),
});
/** Whole-item collection page. */
export type Page = z.infer<typeof PageSchema>;
/** Shared caller workload request; clamp to each collection cap after parsing. */
export const LimitSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(10);
/** Check calendar dates before any I/O. */
export const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a real YYYY-MM-DD calendar date.');
/** Reject reversed date ranges without dropping either bound. */
export function validateDateRange(from?: string, to?: string): void {
  if (
    (from !== undefined && !DateSchema.safeParse(from).success) ||
    (to !== undefined && !DateSchema.safeParse(to).success) ||
    (from !== undefined && to !== undefined && from > to)
  ) {
    throw invalidParams('Use valid ordered YYYY-MM-DD calendar dates.', {
      reason: 'invalid_date_range',
    });
  }
}
/** Members API boundary uses 1 for Commons and 2 for Lords. */
export function numericHouse(house: House): 1 | 2 {
  return house === 'commons' ? 1 : 2;
}
