/**
 * @fileoverview Typed Spoken Hansard records and documented historical coverage.
 * @module services/hansard/hansard-schemas
 */
import { z } from '@cyanheads/mcp-ts-core';
import { SourceSchema } from '../parliament-http/parliament-models.js';

/** Coverage facts do not establish an API lower bound or continuous completeness. */
export const HANSARD_COVERAGE = {
  source: 'spoken_api' as const,
  archiveStartDate: '1803-11-22',
  apiMinimumDate: null,
  verifiedSampleYears: [1803, 2003, 2005, 2007, 2020, 2026],
  completeness: 'not_guaranteed' as const,
  knownGaps: ['2004–2006 website warning; some API records exist'],
  archiveUrl: 'https://api.parliament.uk/historic-hansard/volumes/1/1',
};
/** Shared public coverage schema for search and reference discovery. */
export const HansardCoverageSchema = z.object({
  source: z
    .literal('spoken_api')
    .describe('Spoken contributions API, without automatic archive fallback.'),
  archiveStartDate: z.string().describe('Documented historical archive start; not an API cutoff.'),
  apiMinimumDate: z.null().describe('No official API minimum date has been established.'),
  verifiedSampleYears: z
    .array(z.number().int().describe('Year with a verified successful API sample.'))
    .describe('Samples establish availability only, never complete coverage.'),
  completeness: z
    .literal('not_guaranteed')
    .describe('Continuous historical coverage is not guaranteed.'),
  knownGaps: z
    .array(z.string().describe('Documented coverage warning.'))
    .describe('Known warnings, including website/API distinctions.'),
  archiveUrl: z
    .string()
    .describe('Official historical archive, which is not an automatic fallback.'),
});
const RawIdSchema = z.union([
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^[0-9]+$/),
]);
const RawMemberIdSchema = z.union([
  z.number().int().min(-2147483648).max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^-?[0-9]+$/),
]);
const nullableText = z.string().nullish();
/** Raw SearchReferencesItem, including nullable procedural and historical speakers. */
export const RawHansardItemSchema = z.object({
  MemberName: nullableText,
  MemberId: RawMemberIdSchema.nullish(),
  AttributedTo: nullableText,
  ItemId: RawIdSchema,
  ContributionExtId: z.string().min(1),
  ContributionText: nullableText,
  ContributionTextFull: nullableText,
  HRSTag: nullableText,
  HansardSection: nullableText,
  Timecode: nullableText,
  DebateSection: nullableText,
  DebateSectionId: RawIdSchema.nullish(),
  DebateSectionExtId: nullableText,
  SittingDate: nullableText,
  Section: nullableText,
  House: nullableText,
  OrderInDebateSection: z.number().int().nullish(),
  DebateSectionOrder: z.number().int().nullish(),
  Rank: z.number().nullish(),
});
/** Exact Spoken search wrapper; generic full-search responses deliberately fail validation. */
export const RawHansardSearchSchema = z.object({
  SearchTerms: z.array(z.string()).nullish(),
  SpokenResultCount: z.number().int().nonnegative().optional(),
  WrittenResultCount: z.number().int().nonnegative().optional(),
  CorrectionsResultCount: z.number().int().nonnegative().optional(),
  DivisionsResultCount: z.number().int().nonnegative().optional(),
  Results: z.array(RawHansardItemSchema),
  TotalResultCount: z.number().int().nonnegative(),
});
/** Complete contribution when supplied; preview is retained separately and never substituted. */
export const HansardItemSchema = z.object({
  itemId: z
    .string()
    .describe('Source content item identifier; decimal string preserves int64 IDs.'),
  contributionExtId: z
    .string()
    .describe('Open external identifier, including historical digit strings.'),
  memberName: z
    .string()
    .nullable()
    .optional()
    .describe('Source speaker name; null includes procedural records.'),
  memberId: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Positive Members API join identifier; null for source null or nonpositive sentinels.',
    ),
  sourceMemberId: z
    .string()
    .optional()
    .describe('Original nonpositive source MemberId sentinel; not a Members API join identifier.'),
  attributedTo: z
    .string()
    .nullable()
    .optional()
    .describe('Source attribution preserved without trimming.'),
  text: z
    .string()
    .optional()
    .describe('Complete ContributionTextFull, including source HTML and whitespace.'),
  preview: z
    .string()
    .nullable()
    .optional()
    .describe('Source ContributionText preview, distinct from complete text.'),
  textFormat: z
    .literal('source_html_or_text')
    .describe('Source text is preserved verbatim, never executed.'),
  detailLevel: z
    .enum(['complete', 'summary'])
    .describe('Complete only when full contribution text is supplied.'),
  notice: z.string().optional().describe('Explanation when full text is unavailable.'),
  hrsTag: z.string().nullable().optional().describe('Source HRSTag classification.'),
  hansardSection: z.string().nullable().optional().describe('Source HansardSection code.'),
  timecode: z
    .string()
    .nullable()
    .optional()
    .describe('Source timecode as supplied; null is unknown.'),
  debateSection: z.string().nullable().optional().describe('Source debate section title.'),
  debateSectionId: z
    .string()
    .nullable()
    .optional()
    .describe('Numeric debate section filter ID; repeat this tool with this ID.'),
  debateSectionExtId: z
    .string()
    .nullable()
    .optional()
    .describe('External debate section ID, distinct from the numeric filter ID.'),
  sittingDate: z
    .string()
    .nullable()
    .optional()
    .describe('Source sitting date and time representation.'),
  section: z.string().nullable().optional().describe('Source chamber or section label.'),
  house: z.string().nullable().optional().describe('Source House label, preserved verbatim.'),
  orderInDebateSection: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe('Source contribution order within this section.'),
  debateSectionOrder: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe('Source debate section order.'),
  rank: z.number().nullable().optional().describe('Source search rank, not a synthesized score.'),
  contributionUrl: z
    .string()
    .describe(
      'Official permalink resolver; returns the contribution website path as JSON, resolved against https://hansard.parliament.uk.',
    ),
  debateUrl: z
    .string()
    .optional()
    .describe(
      'Official debate permalink resolver when its external ID is supplied; returns the website path as JSON, resolved against https://hansard.parliament.uk.',
    ),
  source: SourceSchema.describe('Actual request provenance and licence.'),
});
/** Normalized source contribution. */
export type HansardItem = z.infer<typeof HansardItemSchema>;
