/**
 * @fileoverview Retrieve complete selected Westminster bill scrutiny records.
 * @module mcp-server/tools/definitions/ukparl-get-bill.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  AmendmentDecisionSchema,
  BillSectionSchema,
  GetBillOutputSchema,
} from '@/services/bills/bills-schemas.js';
import { getBillsService } from '@/services/bills/bills-service.js';
import {
  deliverPayload,
  enrichmentField,
  formatData,
} from '@/services/parliament-http/parliament-delivery.js';
import { getParliamentHttp } from '@/services/parliament-http/parliament-http-service.js';
import {
  IdSchema,
  LICENCE_NOTICE,
  optionalText,
} from '@/services/parliament-http/parliament-models.js';

/** Select bill metadata, complete stage/publication records, or amendment/motion summaries and details. */
export const ukparlGetBill = tool('ukparl_get_bill', {
  description:
    'Retrieve a Westminster bill overview or select stages, stage, publications, amendments, amendment, motions or motion. Stage/amendment/motion selections require the bill-specific billStageId from section=stages; singular amendment/motion also require itemId from their parent collection. Use amendmentId for amendment retrieval and motion.id for motions. Filter only the amendments collection by amendmentNumber, decision or sponsoring memberId. Collection selectors paginate whole records. Overview leaves publications unchecked; select publications to discover actual supplied legislation.gov.uk statute links. Follow contentCursor with the original selection to reconstruct oversized records.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    billId: IdSchema.describe('Parent bill identifier from ukparl_search_bills.'),
    section: BillSectionSchema.default('overview').describe(
      'Selected bill section; overview by default.',
    ),
    billStageId: optionalText(IdSchema).describe(
      'Bill-specific stage occurrence ID, required for stage/amendment/motion selections.',
    ),
    itemId: optionalText(IdSchema).describe(
      'Amendment amendmentId or ping-pong motion.id; singular selections only.',
    ),
    amendmentNumber: optionalText(z.string().trim().min(1)).describe(
      'Published amendment number, retaining letter suffixes; amendments collection only.',
    ),
    decision: optionalText(AmendmentDecisionSchema).describe(
      'Official amendment decision filter; amendments collection only.',
    ),
    memberId: optionalText(IdSchema).describe('Sponsoring member ID; amendments collection only.'),
    cursor: optionalText(z.string().min(1)).describe('Collection continuation; collections only.'),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Collection records; positive safe integer, default 20, effective cap 50; collections only.',
      ),
    contentCursor: optionalText(z.string().min(1)).describe(
      'Lossless same-selection content continuation.',
    ),
  }),
  output: GetBillOutputSchema,
  enrichment: {
    applied: z
      .object({
        billId: z.string().describe('Parent bill ID.'),
        section: BillSectionSchema.describe('Applied section.'),
        billStageId: z.string().optional().describe('Stage occurrence ID.'),
        itemId: z.string().optional().describe('Selected retrieval ID.'),
        amendmentNumber: z.string().optional().describe('Applied published amendment number.'),
        decision: AmendmentDecisionSchema.optional().describe('Applied amendment decision filter.'),
        memberId: z.string().optional().describe('Applied amendment sponsor ID.'),
        source: z.literal('bills').describe('Official Bills API.'),
        limit: z.number().int().optional().describe('Effective collection limit.'),
      })
      .describe('Normalized selection and actual source.'),
    notice: z
      .string()
      .optional()
      .describe('Licence, workload and selected empty-collection notices.'),
    requestedLimit: z.number().int().optional().describe('Caller limit before clamping.'),
    totalCount: z.number().int().optional().describe('Known selected collection total.'),
    truncated: z
      .boolean()
      .optional()
      .describe('Further source records remain after this selected page.'),
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
        'Check the selected identifiers and filters, then repeat ukparl_get_bill with valid arguments.',
      retryable: false,
    },
    {
      reason: 'http_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 401.',
      recovery:
        'Repeat ukparl_get_bill later; if HTTP 401 persists, report the unavailable public API access.',
      retryable: false,
    },
    {
      reason: 'http_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 402 or 403.',
      recovery:
        'Repeat ukparl_get_bill later; if access remains forbidden, report the blocked public API request.',
      retryable: false,
    },
    {
      reason: 'http_conflict',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'The official API returned HTTP 409, 423 or 424.',
      recovery:
        'Restart ukparl_get_bill with the original selection and no cursor or contentCursor after the source conflict clears.',
      retryable: false,
    },
    {
      reason: 'http_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'The official API returned HTTP 429 after bounded retry handling.',
      recovery:
        'Wait for the returned retryAfter interval, then repeat ukparl_get_bill with the same selection.',
      retryable: true,
    },
    {
      reason: 'http_invalid_request',
      code: JsonRpcErrorCode.InvalidRequest,
      thrownBy: 'service',
      when: 'The official API returned an unexpected redirect or another unsupported HTTP client response.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_get_bill; report a persistent redirect or unsupported response.',
      retryable: false,
    },
    {
      reason: 'invalid_mode_arguments',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'Required branch IDs are missing, unrelated IDs are supplied, or pagination is used on a singular selector.',
      recovery:
        'Call ukparl_lookup_reference with topic=identifiers, then repeat this tool with the fields required by its selected mode.',
      thrownBy: 'service',
    },
    {
      reason: 'invalid_cursor',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A collection or content cursor is malformed or bound to another selection.',
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
      reason: 'queue_full',
      code: JsonRpcErrorCode.RateLimited,
      when: 'The Bills origin request queue is full.',
      recovery: 'Wait briefly, then repeat ukparl_get_bill with the same selection.',
      thrownBy: 'service',
    },
  ],
  async handler(input, ctx) {
    using call = getParliamentHttp().beginCall(ctx);
    const collection = ['stages', 'publications', 'amendments', 'motions'].includes(input.section);
    const limit = Math.min(input.limit ?? 20, 50);
    const capped = collection && (input.limit ?? 20) > limit;
    const applied = {
      billId: input.billId,
      section: input.section,
      ...(input.billStageId ? { billStageId: input.billStageId } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
      ...(input.amendmentNumber !== undefined ? { amendmentNumber: input.amendmentNumber } : {}),
      ...(input.decision !== undefined ? { decision: input.decision } : {}),
      ...(input.memberId !== undefined ? { memberId: input.memberId } : {}),
      source: 'bills' as const,
      ...(collection ? { limit } : {}),
    };
    const result = await getBillsService().get(input, call);
    const notice = `${LICENCE_NOTICE}${capped ? ` Requested limit ${input.limit} is capped at ${limit}.` : ''}${result.payload.items?.length === 0 ? ` The source returned no items for ukparl_get_bill section=${input.section} with these parent identifiers.` : ''}`;
    return deliverPayload(result.payload, {
      tool: 'ukparl_get_bill',
      selection: { ...applied, cursor: input.cursor },
      contentCursor: input.contentCursor,
      ...('repage' in result ? { collection: { count: result.count, repage: result.repage } } : {}),
      retained: (payload) => ({
        ...(payload.source ? { source: payload.source } : {}),
        identity: {
          billId: input.billId,
          ...(input.billStageId ? { billStageId: input.billStageId } : {}),
          ...(input.itemId ? { itemId: input.itemId } : {}),
        },
        ...(payload.page ? { page: payload.page } : {}),
      }),
      enrichmentFor: (selected) => ({
        applied,
        notice,
        ...(selected.page?.total !== undefined ? { totalCount: selected.page.total } : {}),
        ...(capped ? { requestedLimit: input.limit } : {}),
        ...(selected.page?.hasMore
          ? { truncated: true, shown: selected.page.returned, cap: limit }
          : {}),
      }),
      applyEnrichment: (values) => ctx.enrich(values),
    });
  },
  format: (result) => formatData(result),
});
