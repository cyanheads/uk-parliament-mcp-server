/**
 * @fileoverview Discover Westminster bill summaries with validated reference filters.
 * @module mcp-server/tools/definitions/ukparl-search-bills.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { BillHitSchema } from '@/services/bills/bills-schemas.js';
import { getBillsService } from '@/services/bills/bills-service.js';
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
  LimitSchema,
  optionalText,
  PageSchema,
} from '@/services/parliament-http/parliament-models.js';

/** Discover bills; summaries expose IDs for selected complete scrutiny records. */
export const ukparlSearchBills = tool('ukparl_search_bills', {
  description:
    'Search Westminster bill summaries by title, House, session, sponsoring member, reference stage or bill type. Use ukparl_lookup_reference for stage/type IDs and ukparl_get_bill for complete selected records. No session or date scope is inferred. Follow collection cursors with the same filters; use contentCursor to reconstruct an oversized item.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    query: optionalText(z.string().trim().min(1)).describe('Bill title search text.'),
    house: optionalText(HouseSchema).describe('Current Commons or Lords House.'),
    sessionId: optionalText(IdSchema).describe('Session identifier discovered in bill records.'),
    memberId: optionalText(IdSchema).describe('Sponsoring member identifier.'),
    stageIds: z
      .array(IdSchema.describe('Reference stage identifier.'))
      .max(20)
      .optional()
      .describe('Reference stages, distinct from bill-specific stage IDs.'),
    billTypeIds: z
      .array(IdSchema.describe('Reference bill type identifier.'))
      .max(20)
      .optional()
      .describe('Reference bill types.'),
    cursor: optionalText(z.string().min(1)).describe(
      'Opaque collection continuation; preserve filters.',
    ),
    limit: LimitSchema.describe(
      'Requested bills; positive safe integer, default 10, effective cap 20.',
    ),
    contentCursor: optionalText(z.string().min(1)).describe(
      'Opaque same-selection lossless content continuation.',
    ),
  }),
  output: z.object({
    ...DeliveryShape,
    query: z
      .string()
      .optional()
      .describe('Complete normalized query text, also reconstructed through content continuation.'),
    items: z
      .array(BillHitSchema)
      .optional()
      .describe('Complete source bill summaries on this page.'),
    page: PageSchema.optional().describe('Actual whole-item pagination.'),
  }),
  enrichment: {
    applied: z
      .object({
        queryLocation: z
          .literal('/query')
          .optional()
          .describe('Complete normalized search text is in the selected payload at /query.'),
        house: z.string().optional().describe('Applied House.'),
        sessionId: z.string().optional().describe('Applied session ID.'),
        memberId: z.string().optional().describe('Applied member ID.'),
        stageIds: z.array(z.string()).optional().describe('Applied reference stages.'),
        billTypeIds: z.array(z.string()).optional().describe('Applied bill types.'),
        source: z.literal('bills').describe('Official Bills API.'),
        limit: z.number().int().describe('Effective bill limit.'),
      })
      .describe('Normalized filters; no implicit current-session scope.'),
    notice: z.string().optional().describe('Licence and empty/workload notices.'),
    requestedLimit: z.number().int().optional().describe('Caller limit before clamping.'),
    totalCount: z.number().int().optional().describe('Source total matches.'),
    truncated: z
      .boolean()
      .optional()
      .describe('Further source matches remain after this selected page.'),
    shown: z
      .number()
      .int()
      .optional()
      .describe('Actual whole records emitted or selected for lossless reconstruction.'),
    cap: z.number().int().optional().describe('Effective per-call collection limit.'),
  },
  enrichmentTrailer: {
    applied: { render: enrichmentField('applied') },
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
        'Check the selected identifiers and filters, then repeat ukparl_search_bills with valid arguments.',
      retryable: false,
    },
    {
      reason: 'http_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 401.',
      recovery:
        'Repeat ukparl_search_bills later; if HTTP 401 persists, report the unavailable public API access.',
      retryable: false,
    },
    {
      reason: 'http_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 402 or 403.',
      recovery:
        'Repeat ukparl_search_bills later; if access remains forbidden, report the blocked public API request.',
      retryable: false,
    },
    {
      reason: 'http_conflict',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'The official API returned HTTP 409, 423 or 424.',
      recovery:
        'Restart ukparl_search_bills with the original selection and no cursor or contentCursor after the source conflict clears.',
      retryable: false,
    },
    {
      reason: 'http_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'The official API returned HTTP 429 after bounded retry handling.',
      recovery:
        'Wait for the returned retryAfter interval, then repeat ukparl_search_bills with the same selection.',
      retryable: true,
    },
    {
      reason: 'http_invalid_request',
      code: JsonRpcErrorCode.InvalidRequest,
      thrownBy: 'service',
      when: 'The official API returned an unexpected redirect or another unsupported HTTP client response.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_search_bills; report a persistent redirect or unsupported response.',
      retryable: false,
    },
    {
      reason: 'invalid_cursor',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A collection or content cursor is malformed or belongs to another selection.',
      recovery:
        'Repeat the same tool with the same filters and no cursor or contentCursor to start a new page sequence.',
      thrownBy: 'service',
    },
    {
      reason: 'source_changed',
      code: JsonRpcErrorCode.Conflict,
      when: 'The selected payload changed during content retrieval.',
      recovery:
        'Repeat the same tool with its original filters and no contentCursor, then follow the new content cursors.',
      thrownBy: 'service',
    },
    {
      reason: 'unknown_reference_id',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A complete authoritative stage or bill type reference excludes a supplied ID.',
      recovery:
        'Call ukparl_lookup_reference for the matching filter topic and use an ID from its results.',
      thrownBy: 'service',
    },
    {
      reason: 'queue_full',
      code: JsonRpcErrorCode.RateLimited,
      when: 'The Bills origin request queue is full.',
      recovery: 'Wait briefly, then repeat ukparl_search_bills with the same filters.',
      thrownBy: 'service',
    },
  ],
  async handler(input, ctx) {
    using call = getParliamentHttp().beginCall(ctx);
    const limit = Math.min(input.limit, 20);
    const { cursor: _cursor, contentCursor: _contentCursor, limit: _limit, ...filters } = input;
    const { query: _query, ...shortFilters } = filters;
    const applied = {
      ...shortFilters,
      ...(filters.query ? { queryLocation: '/query' as const } : {}),
      limit,
      source: 'bills' as const,
    };
    const result = await getBillsService().search(
      { ...filters, cursor: input.cursor, limit },
      call,
    );
    const notice = `${LICENCE_NOTICE}${input.limit > limit ? ` Requested limit ${input.limit} is capped at ${limit}.` : ''}${result.count === 0 ? ' No matches. Repeat ukparl_search_bills with a broader query or fewer named filters. Call ukparl_lookup_reference with topic=bill_stages or topic=bill_types to verify filter IDs.' : ''}`;
    return deliverPayload(result.payload, {
      tool: 'ukparl_search_bills',
      selection: { ...filters, limit, cursor: input.cursor },
      contentCursor: input.contentCursor,
      collection: { count: result.count, repage: result.repage },
      retained: (payload) => ({
        ...(payload.items[0]
          ? { source: payload.items[0].source, identity: { billId: payload.items[0].billId } }
          : {}),
        page: payload.page,
      }),
      enrichmentFor: (selected) => ({
        applied,
        notice,
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
