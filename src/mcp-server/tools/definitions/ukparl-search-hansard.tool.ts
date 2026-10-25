/**
 * @fileoverview Search complete Spoken contributions with explicit historical coverage.
 * @module mcp-server/tools/definitions/ukparl-search-hansard.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  HANSARD_COVERAGE,
  HansardCoverageSchema,
  HansardItemSchema,
} from '@/services/hansard/hansard-schemas.js';
import { getHansardService } from '@/services/hansard/hansard-service.js';
import {
  DeliveryShape,
  deliverPayload,
  enrichmentField,
  formatData,
} from '@/services/parliament-http/parliament-delivery.js';
import { getParliamentHttp } from '@/services/parliament-http/parliament-http-service.js';
import {
  HouseSchema,
  IdSchema,
  LICENCE_NOTICE,
  optionalText,
  PageSchema,
  SourceSchema,
  validateDateRange,
} from '@/services/parliament-http/parliament-models.js';

/** Discover Spoken contributions, retaining full source text and independent collection/content cursors. */
export const ukparlSearchHansard = tool('ukparl_search_hansard', {
  title: 'Search spoken Hansard',
  description:
    'Search spoken Westminster Hansard contributions by topic, member, House, date or numeric debateSectionId. Returns full source contribution text where supplied, including HTML; previews are labelled summaries. Repeat with a returned debateSectionId to search that section, which does not establish an entire debate transcript. Historical completeness is not guaranteed, including the 2004–2006 website warning despite some API records. Use ukparl_lookup_reference topic=coverage for archive guidance. Follow collection cursors unchanged and contentCursor for lossless oversized contributions; retry timeouts with shorter date windows.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    query: optionalText(z.string().trim().min(1)).describe(
      'Spoken contribution search text; no date range is inferred.',
    ),
    memberId: optionalText(IdSchema).describe(
      'Members API identifier discovered with ukparl_search_members.',
    ),
    house: optionalText(HouseSchema).describe(
      'Commons or Lords; exact official House aliases are accepted.',
    ),
    startDate: optionalText(z.string()).describe(
      'Inclusive earliest sitting date, real YYYY-MM-DD; no inferred archive cutoff.',
    ),
    endDate: optionalText(z.string()).describe(
      'Inclusive latest sitting date, real YYYY-MM-DD; must not precede startDate.',
    ),
    debateSectionId: optionalText(IdSchema).describe(
      'Returned numeric debateSectionId, distinct from external debate IDs.',
    ),
    limit: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .default(5)
      .describe('Requested whole contributions; default 5, effective cap 20 with notice.'),
    cursor: optionalText(z.string().min(1)).describe(
      'Opaque collection continuation; repeat the same filters and effective limit.',
    ),
    contentCursor: optionalText(z.string().min(1)).describe(
      'Opaque lossless content continuation; preserve original selection and collection cursor.',
    ),
  }),
  output: z.object({
    ...DeliveryShape,
    query: z
      .string()
      .optional()
      .describe('Complete normalized search text, reconstructable during content delivery.'),
    source: SourceSchema.optional().describe(
      'Exact official Spoken request provenance, including empty pages.',
    ),
    items: z
      .array(
        HansardItemSchema.describe(
          'One source Spoken contribution with exact text and provenance.',
        ),
      )
      .optional()
      .describe('Whole Spoken contributions in source search order.'),
    page: PageSchema.optional().describe(
      'Actual emitted whole-item continuation, independent of content delivery.',
    ),
    searchTerms: z
      .array(z.string().describe('Source parsed search term.'))
      .nullable()
      .optional()
      .describe('Source parsed terms, including explicit null.'),
    spokenResultCount: z
      .number()
      .int()
      .optional()
      .describe('Source SpokenResultCount, distinct from total matches.'),
    writtenResultCount: z.number().int().optional().describe('Source WrittenResultCount metadata.'),
    correctionsResultCount: z
      .number()
      .int()
      .optional()
      .describe('Source CorrectionsResultCount metadata.'),
    divisionsResultCount: z
      .number()
      .int()
      .optional()
      .describe('Source DivisionsResultCount metadata.'),
  }),
  enrichment: {
    applied: z
      .object({
        queryLocation: z
          .literal('/query')
          .optional()
          .describe('Complete query is retained at /query in the selected payload.'),
        memberId: z.string().optional().describe('Applied Members API identifier.'),
        house: z.string().optional().describe('Applied canonical House.'),
        startDate: z.string().optional().describe('Applied inclusive start date, unchanged.'),
        endDate: z.string().optional().describe('Applied inclusive end date, unchanged.'),
        debateSectionId: z.string().optional().describe('Applied numeric section filter.'),
        dateSemantics: z
          .literal('sitting_date_inclusive_no_inferred_window')
          .describe('Date filters use sitting dates without a default range.'),
        source: z.literal('hansard').describe('Official Spoken Hansard API namespace.'),
        limit: z.number().int().describe('Effective per-call whole-contribution limit.'),
      })
      .describe('Normalized filters and actual workload.'),
    coverage: HansardCoverageSchema.describe(
      'Historical source facts; samples never establish complete coverage.',
    ),
    notice: z
      .string()
      .optional()
      .describe('Licence, coverage, missing-text, empty-result and clamped-limit guidance.'),
    requestedLimit: z
      .number()
      .int()
      .optional()
      .describe('Original request when above the workload cap.'),
    totalCount: z.number().int().optional().describe('Source TotalResultCount.'),
    truncated: z
      .boolean()
      .optional()
      .describe('Further whole contributions remain; follow the collection cursor.'),
    shown: z
      .number()
      .int()
      .optional()
      .describe('Whole contributions emitted or selected for reconstruction.'),
    cap: z.number().int().optional().describe('Actual collection workload cap.'),
  },
  enrichmentTrailer: {
    applied: { render: enrichmentField('applied') },
    coverage: { render: enrichmentField('coverage') },
    notice: { render: enrichmentField('notice') },
    requestedLimit: { render: enrichmentField('requestedLimit') },
    totalCount: { render: enrichmentField('totalCount') },
    truncated: { render: enrichmentField('truncated') },
    shown: { render: enrichmentField('shown') },
    cap: { render: enrichmentField('cap') },
  },
  errors: [
    {
      reason: 'http_invalid_params',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'The official API returned HTTP 400 for this request.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_search_hansard with valid arguments.',
      retryable: false,
    },
    {
      reason: 'http_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 401.',
      recovery:
        'Repeat ukparl_search_hansard later; if HTTP 401 persists, report the unavailable public API access.',
      retryable: false,
    },
    {
      reason: 'http_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 402 or 403.',
      recovery:
        'Repeat ukparl_search_hansard later; if access remains forbidden, report the blocked public API request.',
      retryable: false,
    },
    {
      reason: 'http_conflict',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'The official API returned HTTP 409, 423 or 424.',
      recovery:
        'Restart ukparl_search_hansard with the original selection and no cursor or contentCursor after the source conflict clears.',
      retryable: false,
    },
    {
      reason: 'http_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'The official API returned HTTP 429 after bounded retry handling.',
      recovery:
        'Wait for the returned retryAfter interval, then repeat ukparl_search_hansard with the same selection.',
      retryable: true,
    },
    {
      reason: 'http_invalid_request',
      code: JsonRpcErrorCode.InvalidRequest,
      thrownBy: 'service',
      when: 'The official API returned an unexpected redirect or another unsupported HTTP client response.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_search_hansard; report a persistent redirect or unsupported response.',
      retryable: false,
    },
    {
      reason: 'invalid_cursor',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'Collection or content cursor is invalid or bound to another selection.',
      recovery:
        'Repeat the same tool with the same filters and no cursor or contentCursor to start a new page sequence.',
      thrownBy: 'service',
    },
    {
      reason: 'source_changed',
      code: JsonRpcErrorCode.Conflict,
      when: 'Selected contribution data changed during content reconstruction.',
      recovery:
        'Repeat the same tool with its original filters and no contentCursor, then follow the new content cursors.',
      thrownBy: 'service',
    },
    {
      reason: 'invalid_date_range',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'Date bounds are impossible or reversed.',
      recovery:
        'Call ukparl_lookup_reference with topic=coverage, then repeat this tool with valid ordered calendar dates.',
      thrownBy: 'service',
    },
    {
      reason: 'queue_full',
      code: JsonRpcErrorCode.RateLimited,
      when: 'Hansard origin request queue is full.',
      recovery: 'Wait briefly, then repeat ukparl_search_hansard with the same filters.',
      thrownBy: 'service',
    },
    {
      reason: 'attempt_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'A Spoken source attempt timed out.',
      recovery:
        'Repeat ukparl_search_hansard with shorter date windows and the same remaining filters.',
      thrownBy: 'service',
    },
    {
      reason: 'call_deadline_exceeded',
      code: JsonRpcErrorCode.Timeout,
      when: 'The shared call deadline elapsed while searching Spoken contributions.',
      recovery:
        'Repeat ukparl_search_hansard with shorter date windows and the same remaining filters.',
      thrownBy: 'service',
    },
  ],
  async handler(input, ctx) {
    validateDateRange(input.startDate, input.endDate);
    const limit = Math.min(input.limit, 20);
    const { cursor: _cursor, contentCursor: _contentCursor, limit: _limit, ...filters } = input;
    using call = getParliamentHttp().beginCall(ctx);
    const result = await getHansardService().search(
      { ...filters, cursor: input.cursor, limit },
      call,
    );
    const { query: _query, ...shortFilters } = filters;
    const applied = {
      ...shortFilters,
      ...(filters.query ? { queryLocation: '/query' as const } : {}),
      dateSemantics: 'sitting_date_inclusive_no_inferred_window' as const,
      source: 'hansard' as const,
      limit,
    };
    return deliverPayload(result.payload, {
      tool: 'ukparl_search_hansard',
      selection: { ...filters, limit, cursor: input.cursor },
      contentCursor: input.contentCursor,
      collection: { count: result.count, repage: result.repage },
      retained: (selected) => ({
        source: selected.source,
        ...(selected.items[0]
          ? {
              identity: {
                itemId: selected.items[0].itemId,
                contributionExtId: selected.items[0].contributionExtId,
              },
            }
          : {}),
        page: selected.page,
      }),
      enrichmentFor: (selected) => ({
        applied,
        coverage: HANSARD_COVERAGE,
        notice: `${LICENCE_NOTICE} Historical completeness is not guaranteed. The Parliament website warns of missing 2004–2006 content; some API records exist, which does not resolve that warning. The archive starts on 1803-11-22; the API minimum date is unknown. No legacy archive fallback is performed.${input.limit > limit ? ` Requested limit ${input.limit} is capped at ${limit}.` : ''}${selected.items.some((item) => item.detailLevel === 'summary') ? ' Some results lack ContributionTextFull and are labelled summaries; inspect their official contribution links.' : ''}${result.count === 0 ? ' No matches. Repeat ukparl_search_hansard with a broader query or fewer named filters.' : ''}${result.count === 0 && (input.startDate || input.endDate) ? ' Repeat ukparl_search_hansard with a wider date range.' : ''}${result.count === 0 ? ' Call ukparl_lookup_reference with topic=coverage; an empty result does not establish that Parliament did not debate the topic.' : ''}`,
        totalCount: selected.page.total,
        ...(input.limit > limit ? { requestedLimit: input.limit } : {}),
        ...(selected.page.hasMore
          ? { truncated: true, shown: selected.page.returned, cap: limit }
          : {}),
      }),
      applyEnrichment: (values) => ctx.enrich(values),
    });
  },
  format: (result) => formatData(result),
});
