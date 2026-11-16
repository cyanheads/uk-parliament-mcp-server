/**
 * @fileoverview Search written ministerial statement previews or retrieve one complete statement.
 * @module mcp-server/tools/definitions/ukparl-search-statements.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, validationError } from '@cyanheads/mcp-ts-core/errors';
import { canonicalAnsweringBodyIds } from '@/services/parliament-http/answering-body-filter.js';
import { pageFor, readCollectionCursor } from '@/services/parliament-http/parliament-cursors.js';
import {
  DeliveryShape,
  deliverPayload,
  enrichmentField,
  formatData,
} from '@/services/parliament-http/parliament-delivery.js';
import { getParliamentHttp } from '@/services/parliament-http/parliament-http-service.js';
import {
  DateShapeSchema,
  HouseSchema,
  IdSchema,
  LICENCE_NOTICE,
  LimitSchema,
  optionalText,
  PageSchema,
  SourceSchema,
  validateDateRange,
} from '@/services/parliament-http/parliament-models.js';
import {
  StatementRecordSchema,
  toStatementRecord,
} from '@/services/statements/statement-models.js';
import { getStatements } from '@/services/statements/statements-service.js';

const LIMIT_CAP = 100;
const FiltersSchema = z.object({
  query: z.string().optional().describe('Content search terms.'),
  uin: z.string().optional().describe('Uppercased source UIN, potentially shared across sessions.'),
  memberId: z.string().optional().describe('Making minister member ID.'),
  answeringBodyIds: z
    .array(z.string().describe('Answering-body ID.'))
    .optional()
    .describe('Selected answering-body IDs, matched as any.'),
  house: z.enum(['commons', 'lords']).optional().describe('Selected House.'),
  madeFrom: z.string().optional().describe('Inclusive start date made.'),
  madeTo: z.string().optional().describe('Inclusive end date made.'),
});
const AppliedSchema = z.object({
  mode: z.enum(['search', 'detail']).describe('Selected mode.'),
  source: z.literal('questions').describe('Official Questions and Statements API.'),
  limit: z.number().int().describe('Effective maximum whole search records.'),
  filters: z
    .literal('/filters')
    .describe('Complete normalized search filters are retained at /filters.'),
  statementId: z.string().optional().describe('Selected statement ID.'),
  sessionStatus: z.literal('Any').describe('No current-session restriction.'),
  expandMember: z.literal(true).describe('Expanded member names requested.'),
  dateSemantics: z
    .literal('inclusive calendar dates; no implicit date window')
    .describe('Date-bound semantics.'),
});
const OutputSchema = z.object({
  ...DeliveryShape,
  mode: z.enum(['search', 'detail']).optional().describe('Selected statement operation.'),
  filters: FiltersSchema.optional().describe('Complete normalized selection filters.'),
  statementId: z.string().optional().describe('Selected statement ID.'),
  items: z
    .array(StatementRecordSchema.describe('Statement preview summary.'))
    .optional()
    .describe('Selected search page; never automatically hydrated.'),
  record: StatementRecordSchema.optional().describe(
    'Complete selected statement including source HTML and attachment metadata.',
  ),
  found: z.boolean().optional().describe('Detail lookup success; false requires guidance.'),
  page: PageSchema.optional().describe('Whole-statement search continuation.'),
  source: SourceSchema.optional().describe('Actual selected official request.'),
  guidance: z.string().optional().describe('Same-tool recovery for missing or empty selections.'),
});

/** Search statement previews, then retrieve complete HTML using the returned statementId. */
export const ukparlSearchStatements = tool('ukparl_search_statements', {
  title: 'Search written statements',
  description:
    'Search Westminster written ministerial statements by text, exact UIN, minister, House, answering body and date made. Search returns plain-text previews; retrieve mode=detail with a returned statementId for the complete HTML. A UIN such as HLWS419 is reused across sessions: narrow it with madeFrom/madeTo. A UIN is not a statementId. Search covers all sessions. A CorrectedAnswer link carries a written-question questionId for ukparl_search_questions mode=detail. Follow collection cursors unchanged; use contentCursor for lossless oversized statements.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    mode: z
      .enum(['search', 'detail'])
      .default('search')
      .describe('Search previews or retrieve one complete statement.'),
    query: optionalText(z.string().trim().min(1)).describe(
      'Statement title or text terms; search only.',
    ),
    uin: optionalText(z.string().trim().min(1)).describe(
      'Exact statement UIN, such as HLWS419 or HCWS416, case-insensitive. Search only; combine with madeFrom/madeTo to narrow reused UINs.',
    ),
    statementId: optionalText(IdSchema).describe(
      'Positive decimal statement ID required in detail; UIN is not this ID.',
    ),
    memberId: optionalText(IdSchema).describe(
      'Members API ID of the minister making the statement; search only.',
    ),
    answeringBodyIds: z
      .array(IdSchema.describe('Official answering-body ID.'))
      .min(1)
      .max(20)
      .optional()
      .describe(
        'Up to 20 answering-body IDs resolved through ukparl_lookup_reference, matching any; search only.',
      ),
    house: optionalText(HouseSchema).describe('Commons or Lords; search only.'),
    madeFrom: optionalText(DateShapeSchema).describe(
      'Inclusive start YYYY-MM-DD of the date made; search only.',
    ),
    madeTo: optionalText(DateShapeSchema).describe(
      'Inclusive end YYYY-MM-DD of the date made; search only.',
    ),
    cursor: optionalText(z.string().min(1)).describe(
      'Opaque search continuation; repeat unchanged filters.',
    ),
    limit: LimitSchema.removeDefault()
      .optional()
      .describe(
        `Search page size, default 10, cap ${LIMIT_CAP}; larger safe integers are capped. Omit in detail.`,
      ),
    contentCursor: optionalText(z.string().min(1)).describe(
      'Opaque lossless content continuation for this same selection.',
    ),
  }),
  output: OutputSchema,
  enrichment: {
    applied: AppliedSchema.describe(
      'Effective filters, explicit upstream scope and date semantics.',
    ),
    notice: z.string().describe('Licence, preview and workload notices.'),
    requestedLimit: z.number().int().optional().describe('Original page-size request when capped.'),
    total: z.number().int().optional().describe('Upstream total when known.'),
    truncated: z.boolean().optional().describe('Further whole search results remain.'),
    shown: z.number().int().optional().describe('Actually emitted whole search results.'),
    cap: z
      .number()
      .int()
      .optional()
      .describe('Search page-size ceiling; a larger limit is clamped to it.'),
  },
  enrichmentTrailer: {
    applied: { render: enrichmentField('applied') },
    notice: { render: enrichmentField('notice') },
    requestedLimit: { render: enrichmentField('requestedLimit') },
    total: { render: enrichmentField('total') },
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
        'Check the selected identifiers and filters, then repeat ukparl_search_statements with valid arguments.',
      retryable: false,
    },
    {
      reason: 'http_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 401.',
      recovery:
        'Repeat ukparl_search_statements later; if HTTP 401 persists, report the unavailable public API access.',
      retryable: false,
    },
    {
      reason: 'http_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 402 or 403.',
      recovery:
        'Repeat ukparl_search_statements later; if access remains forbidden, report the blocked public API request.',
      retryable: false,
    },
    {
      reason: 'http_conflict',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'The official API returned HTTP 409, 423 or 424.',
      recovery:
        'Restart ukparl_search_statements with the original selection and no cursor or contentCursor after the source conflict clears.',
      retryable: false,
    },
    {
      reason: 'http_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'The official API returned HTTP 429 after bounded retry handling.',
      recovery:
        'Wait for the returned retryAfter interval, then repeat ukparl_search_statements with the same selection.',
      retryable: true,
    },
    {
      reason: 'http_invalid_request',
      code: JsonRpcErrorCode.InvalidRequest,
      thrownBy: 'service',
      when: 'The official API returned an unexpected redirect or another unsupported HTTP client response.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_search_statements; report a persistent redirect or unsupported response.',
      retryable: false,
    },
    {
      reason: 'http_server_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      thrownBy: 'service',
      when: 'The official API returned an HTTP 5xx server error.',
      recovery:
        'Repeat ukparl_search_statements with a narrower query, a madeFrom/madeTo window or answeringBodyIds; retry later if it still fails.',
    },
    {
      reason: 'call_deadline_exceeded',
      code: JsonRpcErrorCode.Timeout,
      thrownBy: 'service',
      when: 'The 45-second call deadline elapsed before the official API answered.',
      recovery:
        'Repeat ukparl_search_statements once after a short wait; if it times out again, use a narrower query, a madeFrom/madeTo window or answeringBodyIds.',
    },
    {
      reason: 'queue_full',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'A selected Questions or Members origin request queue is full.',
      recovery: 'Wait briefly, then repeat ukparl_search_statements with the same selection.',
    },
    {
      reason: 'invalid_mode_arguments',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'Required detail ID is missing or fields conflict with the selected mode.',
      recovery:
        'Call ukparl_lookup_reference with topic=identifiers, then repeat ukparl_search_statements with the fields required by its selected mode.',
    },
    {
      reason: 'invalid_date_range',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'Calendar dates are invalid or reversed.',
      recovery:
        'Call ukparl_lookup_reference with topic=coverage, then repeat ukparl_search_statements with valid ordered calendar dates.',
    },
    {
      reason: 'unknown_reference_id',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'The complete answering-body reference excludes a supplied ID.',
      recovery:
        'Call ukparl_lookup_reference with topic=answering_bodies and repeat ukparl_search_statements with an ID from its results.',
    },
    {
      reason: 'invalid_cursor',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'Collection or content cursor is malformed or bound to another selection.',
      recovery:
        'Repeat ukparl_search_statements with the same filters and no cursor or contentCursor to start a new page sequence.',
    },
    {
      reason: 'source_changed',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'Selected content changed during retrieval.',
      recovery:
        'Repeat ukparl_search_statements with its original filters and any collection cursor, but no contentCursor, then follow the new content cursors.',
    },
  ],
  async handler(input, ctx) {
    const { mode, statementId } = input;
    const filters = FiltersSchema.parse({
      query: input.query,
      // The source matches UINs case-insensitively; one spelling keeps cursors bound.
      uin: input.uin?.toUpperCase(),
      memberId: input.memberId,
      answeringBodyIds: canonicalAnsweringBodyIds(input.answeringBodyIds),
      house: input.house,
      madeFrom: input.madeFrom,
      madeTo: input.madeTo,
    });
    const conflicts: string[] = [];
    if (mode === 'search' && statementId !== undefined)
      conflicts.push('mode=search does not accept statementId; omit it or use mode=detail.');
    if (mode === 'detail') {
      if (!statementId)
        conflicts.push(
          'mode=detail requires statementId; use an ID returned by mode=search, not a UIN.',
        );
      const fields = Object.entries({ ...filters, cursor: input.cursor, limit: input.limit })
        .filter(([, value]) => value !== undefined)
        .map(([field]) => field);
      if (fields.length)
        conflicts.push(
          `mode=detail does not accept ${fields.join(', ')}; remove these fields or use mode=search.`,
        );
    }
    if (conflicts.length) throw ctx.fail('invalid_mode_arguments', conflicts.join(' '));
    validateDateRange(input.madeFrom, input.madeTo);
    const requestedLimit = input.limit ?? 10;
    const limit = Math.min(LIMIT_CAP, requestedLimit);
    const capped = requestedLimit > LIMIT_CAP;
    const applied = AppliedSchema.parse({
      mode,
      source: 'questions',
      limit,
      filters: '/filters',
      statementId,
      sessionStatus: 'Any',
      expandMember: true,
      dateSemantics: 'inclusive calendar dates; no implicit date window',
    });
    const notice = `${LICENCE_NOTICE} ${mode === 'search' ? 'Statement text is a plain-text preview; retrieve mode=detail with statementId before quoting the complete statement.' : 'Complete source statement HTML; attachment metadata and links only, no files downloaded.'}${capped ? ` Requested limit ${requestedLimit} is capped at ${LIMIT_CAP}.` : ''}`;
    const enrichment = { applied, notice, ...(capped ? { requestedLimit } : {}) };
    const selection = { mode, statementId, filters, limit, cursor: input.cursor };
    if (mode === 'detail') {
      if (!statementId)
        throw ctx.fail(
          'invalid_mode_arguments',
          'mode=detail requires statementId; use an ID returned by mode=search, not a UIN.',
        );
      using call = getParliamentHttp().beginCall(ctx);
      const response = await getStatements().detail(call, statementId);
      const payload = response
        ? {
            mode,
            statementId,
            filters,
            found: true,
            source: response.source,
            record: toStatementRecord(response.data.value, 'complete'),
          }
        : {
            mode,
            statementId,
            filters,
            found: false,
            guidance:
              'No statement matched this statementId. Repeat ukparl_search_statements in search mode to find a statementId; a UIN alone is not a statementId.',
          };
      return deliverPayload(payload, {
        tool: 'ukparl_search_statements',
        selection,
        contentCursor: input.contentCursor,
        retained: (selected) => ({
          ...(selected.source ? { source: selected.source } : {}),
          identity: { statementId },
        }),
        enrichmentFor: () => enrichment,
        applyEnrichment: (values) => ctx.enrich(values),
      });
    }
    const cursor = readCollectionCursor(input.cursor, {
      source: 'statements',
      selector: mode,
      filters,
      nativePageSize: limit,
    });
    using call = getParliamentHttp().beginCall(ctx);
    const response = await getStatements().search(call, filters, cursor.offset, limit);
    if (
      response.data.results.length > limit ||
      (response.data.results.length === 0 && cursor.offset < response.data.totalResults)
    )
      throw validationError(
        'Statement search page does not agree with its requested size or reported total.',
      );
    const items = response.data.results.map((row) => toStatementRecord(row.value, 'summary'));
    const repage = (count: number) => ({
      mode,
      filters,
      source: response.source,
      items: items.slice(0, count),
      page: pageFor(cursor, count, response.data.totalResults),
      ...(items.length === 0
        ? {
            guidance:
              'No statements matched. Repeat ukparl_search_statements with broader text, fewer filters or a wider date range; an empty result does not establish that no statement was made. Call ukparl_lookup_reference with topic=answering_bodies to verify department filters.',
          }
        : {}),
    });
    return deliverPayload(repage(items.length), {
      tool: 'ukparl_search_statements',
      selection,
      contentCursor: input.contentCursor,
      collection: { count: items.length, repage },
      retained: (selected) => ({
        source: selected.source,
        page: selected.page,
        ...(selected.items[0] ? { identity: { statementId: selected.items[0].statementId } } : {}),
      }),
      enrichmentFor: (selected) => ({
        ...enrichment,
        total: selected.page.total,
        truncated: selected.page.hasMore,
        shown: selected.page.returned,
        cap: LIMIT_CAP,
        notice: `${notice}${selected.page.returned === 0 ? ' No statements matched; broaden the search or reduce filters.' : ''}`,
      }),
      applyEnrichment: (values) => ctx.enrich(values),
    });
  },
  format: (result) => formatData(result),
});
