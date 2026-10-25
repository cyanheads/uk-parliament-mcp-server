/**
 * @fileoverview Search written-question previews or retrieve one complete answer.
 * @module mcp-server/tools/definitions/ukparl-search-questions.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, validationError } from '@cyanheads/mcp-ts-core/errors';
import {
  advanceCollectionCursor,
  invalidCursor,
  readCollectionCursor,
} from '@/services/parliament-http/parliament-cursors.js';
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
import { QuestionRecordSchema } from '@/services/questions/question-models.js';
import { getQuestions } from '@/services/questions/questions-service.js';

const FiltersSchema = z.object({
  query: z.string().optional().describe('Content search terms.'),
  memberId: z.string().optional().describe('Asking member ID.'),
  answeringBodyIds: z
    .array(z.string().describe('Answering-body ID.'))
    .optional()
    .describe('Selected answering-body IDs.'),
  house: z.enum(['commons', 'lords']).optional().describe('Selected House.'),
  answered: z.boolean().optional().describe('True answered, false unanswered, omitted either.'),
  tabledFrom: z.string().optional().describe('Inclusive tabling start date.'),
  tabledTo: z.string().optional().describe('Inclusive tabling end date.'),
  answeredFrom: z.string().optional().describe('Inclusive answer start date.'),
  answeredTo: z.string().optional().describe('Inclusive answer end date.'),
});
const AppliedSchema = z.object({
  mode: z.enum(['search', 'detail']).describe('Selected mode.'),
  source: z.literal('questions').describe('Official Questions API.'),
  limit: z.number().int().describe('Effective maximum whole search records.'),
  filters: z
    .literal('/filters')
    .describe('Complete normalized search filters are retained at /filters.'),
  questionId: z.string().optional().describe('Selected Questions API record ID.'),
  sessionStatus: z.literal('Any').describe('No current-session restriction.'),
  expandMember: z.literal(true).describe('Expanded source member references requested.'),
  questionStatus: z
    .literal('AllQuestions')
    .optional()
    .describe('Search includes every question status.'),
  includeWithdrawn: z.literal(true).optional().describe('Search includes withdrawn questions.'),
  answerState: z
    .enum(['Any', 'Answered', 'Unanswered'])
    .optional()
    .describe('Independent upstream answered selection.'),
  dateSemantics: z
    .literal('inclusive calendar dates; no implicit date window')
    .describe('Date-bound semantics.'),
});
const OutputSchema = z.object({
  ...DeliveryShape,
  mode: z.enum(['search', 'detail']).optional().describe('Selected question operation.'),
  filters: FiltersSchema.optional().describe('Complete normalized selection filters.'),
  questionId: z.string().optional().describe('Selected Questions API ID.'),
  items: z
    .array(QuestionRecordSchema.describe('Question preview summary.'))
    .optional()
    .describe('Selected search page; never automatically hydrated.'),
  record: QuestionRecordSchema.optional().describe(
    'Complete selected question including answer HTML and attachments metadata.',
  ),
  found: z.boolean().optional().describe('Detail lookup success; false requires guidance.'),
  page: PageSchema.optional().describe('Whole-question search continuation.'),
  source: SourceSchema.optional().describe('Actual selected official request.'),
  guidance: z.string().optional().describe('Same-tool recovery for missing or empty selections.'),
});

/** Search previews, then retrieve complete answers using the returned questionId. */
export const ukparlSearchQuestions = tool('ukparl_search_questions', {
  title: 'Search written questions',
  description:
    'Search Westminster written questions and answer previews by text, asking member, House, answering body, answer state and dates. Use mode=detail with a returned questionId for complete question and answer HTML, corrections and attachment links. A UIN is not a questionId. Search includes all sessions and withdrawn questions. Follow collection cursors unchanged; use contentCursor for lossless oversized answers.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    mode: z
      .enum(['search', 'detail'])
      .default('search')
      .describe('Search previews or retrieve one complete question.'),
    query: optionalText(z.string().trim().min(1)).describe(
      'Question or answer content terms; search only.',
    ),
    questionId: optionalText(IdSchema).describe(
      'Positive decimal Questions API ID required in detail; UIN is not this ID.',
    ),
    memberId: optionalText(IdSchema).describe('Asking Members API ID; search only.'),
    answeringBodyIds: z
      .array(IdSchema.describe('Official answering-body ID.'))
      .min(1)
      .max(20)
      .optional()
      .describe(
        'Up to 20 answering-body IDs resolved through ukparl_lookup_reference; search only.',
      ),
    house: optionalText(HouseSchema).describe('Commons or Lords; search only.'),
    answered: z
      .boolean()
      .optional()
      .describe('True answered, false unanswered, omission either; search only.'),
    tabledFrom: optionalText(DateShapeSchema).describe(
      'Inclusive tabling start YYYY-MM-DD; search only.',
    ),
    tabledTo: optionalText(DateShapeSchema).describe(
      'Inclusive tabling end YYYY-MM-DD; search only.',
    ),
    answeredFrom: optionalText(DateShapeSchema).describe(
      'Inclusive answer start YYYY-MM-DD; search only.',
    ),
    answeredTo: optionalText(DateShapeSchema).describe(
      'Inclusive answer end YYYY-MM-DD; search only.',
    ),
    cursor: optionalText(z.string().min(1)).describe(
      'Opaque search continuation; repeat unchanged filters.',
    ),
    limit: LimitSchema.removeDefault()
      .optional()
      .describe(
        'Search page size, default 10, cap 20; larger safe integers are capped. Omit in detail.',
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
    cap: z.number().int().optional().describe('Effective search page-size cap.'),
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
        'Check the selected identifiers and filters, then repeat ukparl_search_questions with valid arguments.',
      retryable: false,
    },
    {
      reason: 'http_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 401.',
      recovery:
        'Repeat ukparl_search_questions later; if HTTP 401 persists, report the unavailable public API access.',
      retryable: false,
    },
    {
      reason: 'http_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 402 or 403.',
      recovery:
        'Repeat ukparl_search_questions later; if access remains forbidden, report the blocked public API request.',
      retryable: false,
    },
    {
      reason: 'http_conflict',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'The official API returned HTTP 409, 423 or 424.',
      recovery:
        'Restart ukparl_search_questions with the original selection and no cursor or contentCursor after the source conflict clears.',
      retryable: false,
    },
    {
      reason: 'http_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'The official API returned HTTP 429 after bounded retry handling.',
      recovery:
        'Wait for the returned retryAfter interval, then repeat ukparl_search_questions with the same selection.',
      retryable: true,
    },
    {
      reason: 'http_invalid_request',
      code: JsonRpcErrorCode.InvalidRequest,
      thrownBy: 'service',
      when: 'The official API returned an unexpected redirect or another unsupported HTTP client response.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_search_questions; report a persistent redirect or unsupported response.',
      retryable: false,
    },
    {
      reason: 'queue_full',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'A selected Questions or Members origin request queue is full.',
      recovery: 'Wait briefly, then repeat ukparl_search_questions with the same selection.',
    },
    {
      reason: 'invalid_mode_arguments',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'Required detail ID is missing or fields conflict with the selected mode.',
      recovery:
        'Call ukparl_lookup_reference with topic=identifiers, then repeat this tool with the fields required by its selected mode.',
    },
    {
      reason: 'invalid_date_range',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'Calendar dates are invalid or reversed.',
      recovery:
        'Call ukparl_lookup_reference with topic=coverage, then repeat this tool with valid ordered calendar dates.',
    },
    {
      reason: 'unknown_reference_id',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'The complete answering-body reference excludes a supplied ID.',
      recovery:
        'Call ukparl_lookup_reference for the matching filter topic and use an ID from its results.',
    },
    {
      reason: 'invalid_cursor',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'Collection or content cursor is malformed or bound to another selection.',
      recovery:
        'Repeat the same tool with the same filters and no cursor or contentCursor to start a new page sequence.',
    },
    {
      reason: 'source_changed',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'Selected content changed during retrieval.',
      recovery:
        'Repeat the same tool with its original filters and no contentCursor, then follow the new content cursors.',
    },
  ],
  async handler(input, ctx) {
    const { mode, questionId } = input;
    const filters = FiltersSchema.parse({
      query: input.query,
      memberId: input.memberId,
      answeringBodyIds:
        input.answeringBodyIds === undefined
          ? undefined
          : [...new Set(input.answeringBodyIds)].sort((a, b) => Number(a) - Number(b)),
      house: input.house,
      answered: input.answered,
      tabledFrom: input.tabledFrom,
      tabledTo: input.tabledTo,
      answeredFrom: input.answeredFrom,
      answeredTo: input.answeredTo,
    });
    if (
      (mode === 'search' && questionId !== undefined) ||
      (mode === 'detail' &&
        (!questionId ||
          Object.values(filters).some((value) => value !== undefined) ||
          input.cursor !== undefined ||
          input.limit !== undefined))
    )
      throw ctx.fail(
        'invalid_mode_arguments',
        'Use questionId alone in detail mode, or search filters without questionId.',
      );
    validateDateRange(input.tabledFrom, input.tabledTo);
    validateDateRange(input.answeredFrom, input.answeredTo);
    const requestedLimit = input.limit ?? 10;
    const limit = Math.min(20, requestedLimit);
    const applied = AppliedSchema.parse({
      mode,
      source: 'questions',
      limit,
      filters: '/filters',
      questionId,
      sessionStatus: 'Any',
      expandMember: true,
      ...(mode === 'search'
        ? {
            questionStatus: 'AllQuestions',
            includeWithdrawn: true,
            answerState:
              input.answered === undefined ? 'Any' : input.answered ? 'Answered' : 'Unanswered',
          }
        : {}),
      dateSemantics: 'inclusive calendar dates; no implicit date window',
    });
    const notice = `${LICENCE_NOTICE} ${mode === 'search' ? 'Question and answer text are previews; retrieve mode=detail with questionId before quoting a complete answer.' : 'Complete source question and answer content; attachment metadata and links only, no files downloaded.'}${requestedLimit > 20 ? ` Requested limit ${requestedLimit} is capped at 20.` : ''}`;
    const enrichment = { applied, notice, ...(requestedLimit > 20 ? { requestedLimit } : {}) };
    const selection = { mode, questionId, filters, limit, cursor: input.cursor };
    const cursor =
      mode === 'search'
        ? readCollectionCursor(input.cursor, {
            source: 'questions',
            selector: mode,
            filters,
            nativePageSize: limit,
          })
        : undefined;
    if (cursor && cursor.offset > 2147483647) return invalidCursor();
    using call = getParliamentHttp().beginCall(ctx);
    if (mode === 'detail') {
      if (!questionId) throw ctx.fail('invalid_mode_arguments', 'Detail mode requires questionId.');
      const response = await getQuestions().detail(call, questionId);
      const payload = response
        ? {
            mode,
            questionId,
            filters,
            found: true,
            source: response.source,
            record: QuestionRecordSchema.parse({
              ...response.data.value,
              questionId: String(response.data.value.id),
              links: response.data.links,
              source: response.source,
              detailLevel: 'complete',
            }),
          }
        : {
            mode,
            questionId,
            filters,
            found: false,
            guidance:
              'No question matched this questionId. Repeat ukparl_search_questions in search mode to find a Questions API ID; a UIN alone is not a questionId.',
          };
      return deliverPayload(payload, {
        tool: 'ukparl_search_questions',
        selection,
        contentCursor: input.contentCursor,
        retained: (selected) => ({
          ...(selected.source ? { source: selected.source } : {}),
          identity: { questionId },
        }),
        enrichmentFor: () => enrichment,
        applyEnrichment: (values) => ctx.enrich(values),
      });
    }
    if (!cursor) return invalidCursor();
    const response = await getQuestions().search(call, filters, cursor.offset, limit);
    if (
      response.data.results.length > limit ||
      (response.data.results.length === 0 && cursor.offset < response.data.totalResults)
    )
      throw validationError(
        'Question search page does not agree with its requested size or reported total.',
      );
    const items = response.data.results.map((row) =>
      QuestionRecordSchema.parse({
        ...row.value,
        questionId: String(row.value.id),
        links: row.links,
        source: response.source,
        detailLevel: 'summary',
        followUp: `Call ukparl_search_questions with mode=detail and questionId=${row.value.id} for complete question text, answer HTML and attachment metadata.`,
      }),
    );
    const repage = (count: number) => ({
      mode,
      filters,
      source: response.source,
      items: items.slice(0, count),
      page: {
        returned: count,
        total: response.data.totalResults,
        hasMore: cursor.offset + count < response.data.totalResults,
        ...(cursor.offset + count < response.data.totalResults
          ? { nextCursor: advanceCollectionCursor(cursor, count) }
          : {}),
      },
      ...(items.length === 0
        ? {
            guidance:
              'No questions matched. Repeat ukparl_search_questions with broader text, fewer filters or a wider date range; an empty result does not establish that no question was tabled. Call ukparl_lookup_reference with topic=answering_bodies to verify department filters.',
          }
        : {}),
    });
    return deliverPayload(repage(items.length), {
      tool: 'ukparl_search_questions',
      selection,
      contentCursor: input.contentCursor,
      collection: { count: items.length, repage },
      retained: (selected) => ({
        source: selected.source,
        page: selected.page,
        ...(selected.items[0] ? { identity: { questionId: selected.items[0].questionId } } : {}),
      }),
      enrichmentFor: (selected) => ({
        ...enrichment,
        total: selected.page.total,
        truncated: selected.page.hasMore,
        shown: selected.page.returned,
        cap: limit,
        notice: `${notice}${selected.page.returned === 0 ? ' No questions matched; broaden the search or reduce filters.' : ''}`,
      }),
      applyEnrichment: (values) => ctx.enrich(values),
    });
  },
  format: (result) => formatData(result),
});
