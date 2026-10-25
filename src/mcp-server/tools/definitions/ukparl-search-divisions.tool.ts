/**
 * @fileoverview Search and inspect House-scoped divisions and their recorded participation.
 * @module mcp-server/tools/definitions/ukparl-search-divisions.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  DivisionSchema,
  LobbySchema,
  PartyTotalSchema,
  VoterSchema,
} from '@/services/divisions/divisions-schemas.js';
import { getDivisionsService } from '@/services/divisions/divisions-service.js';
import {
  DeliveryShape,
  deliverPayload,
  enrichmentField,
  formatData,
} from '@/services/parliament-http/parliament-delivery.js';
import { getParliamentHttp } from '@/services/parliament-http/parliament-http-service.js';
import {
  DateSchema,
  HouseSchema,
  IdSchema,
  LICENCE_NOTICE,
  LimitSchema,
  optionalText,
  PageSchema,
  SourceSchema,
  validateDateRange,
} from '@/services/parliament-http/parliament-models.js';

const ModeSchema = z.enum(['search', 'detail', 'voters', 'party_totals']);
const SelectionSchema = z.object({
  house: HouseSchema.describe('Selected House and division ID namespace.'),
  mode: ModeSchema.describe('Selected division operation.'),
  query: optionalText(z.string().trim().min(1)).describe(
    'Division title or number search text; search mode only.',
  ),
  memberId: optionalText(IdSchema).describe(
    'Members API ID; search includes divisions where this member was a teller.',
  ),
  divisionId: optionalText(IdSchema).describe(
    'Division ID in the selected House; required outside search.',
  ),
  startDate: optionalText(DateSchema).describe(
    'Inclusive source division-date lower bound; search only.',
  ),
  endDate: optionalText(DateSchema).describe(
    'Inclusive source division-date upper bound; search only.',
  ),
  party: optionalText(z.string().trim().min(1)).describe(
    'Exact case-insensitive source party label; voters only, not a party ID.',
  ),
  lobby: optionalText(LobbySchema).describe(
    'Voters only: Commons aye/no/not_recorded or Lords content/not_content.',
  ),
  limit: LimitSchema.describe(
    'Positive safe integer; search default 5/cap 10, voters default 20/cap 50.',
  ),
});

/** Search division summaries or select complete metadata, voter rows and party totals. */
export const ukparlSearchDivisions = tool('ukparl_search_divisions', {
  description:
    'Search official Commons or Lords division summaries, or use detail, voters or party_totals with a divisionId from the same House. Search supports title/number text, member and inclusive division dates; member searches include teller participation. Detail preserves complete metadata and teller identities, with roster selectors for voters mode. Voters can filter exact source party labels and House-compatible lobbies. not_recorded means only the source list, never abstention. Party totals count listed non-tellers and tellers separately from official headline counts. Follow collection cursors with unchanged filters; reconstruct oversized content using contentCursor.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: SelectionSchema.extend({
    mode: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value),
        ModeSchema.default('search'),
      )
      .describe('Operation; defaults to search; accepts case-insensitive canonical mode names.'),
    limit: LimitSchema.unwrap()
      .optional()
      .describe(
        'Positive safe integer; search default 5/cap 10, voters default 20/cap 50; detail and party_totals do not paginate.',
      ),
    cursor: optionalText(z.string().min(1)).describe(
      'Opaque search/voters collection continuation; repeat the same filters.',
    ),
    contentCursor: optionalText(z.string().min(1)).describe(
      'Opaque same-selection lossless content continuation, separate from collection cursor.',
    ),
  }),
  output: z.object({
    ...DeliveryShape,
    mode: ModeSchema.optional().describe('Selected division operation.'),
    house: HouseSchema.optional().describe('House scoping division IDs.'),
    selection: SelectionSchema.optional().describe(
      'Complete normalized filters retained through content delivery.',
    ),
    source: SourceSchema.optional().describe('Actual selected API request provenance.'),
    found: z.boolean().optional().describe('Selected division existence; absent in search mode.'),
    record: DivisionSchema.optional().describe(
      'Complete selected division metadata, teller identities and roster selectors.',
    ),
    items: z
      .array(DivisionSchema)
      .optional()
      .describe('Explicit search summaries without full roster arrays.'),
    voters: z
      .array(VoterSchema)
      .optional()
      .describe('Whole deduplicated selected voter rows, including tellers.'),
    partyTotals: z
      .array(PartyTotalSchema)
      .optional()
      .describe('Complete roster-derived party/lobby non-teller and teller counts.'),
    page: PageSchema.optional().describe('Actual emitted whole-row collection continuation.'),
    guidance: z
      .string()
      .optional()
      .describe('Actionable recovery for a missing division or unavailable complete roster.'),
  }),
  enrichment: {
    applied: z
      .object({
        selectionPath: z
          .literal('/selection')
          .describe('Complete normalized filters are reconstructable at this payload path.'),
        house: z.enum(['commons', 'lords']).describe('Applied House.'),
        mode: ModeSchema.describe('Applied operation.'),
        source: z
          .enum(['commons_votes', 'lords_votes'])
          .describe('Selected official API; no cross-source fallback.'),
        limit: z.number().int().describe('Effective collection workload limit.'),
        returned: z
          .number()
          .int()
          .optional()
          .describe('Actual whole items emitted on the selected collection page.'),
        dateSemantics: z
          .string()
          .describe('Search boundaries apply inclusively to division dates; no implicit window.'),
      })
      .describe('Required normalized operation and actual workload metadata.'),
    notice: z.string().describe('Licence, coverage, empty-result and workload notices.'),
    requestedLimit: z
      .number()
      .int()
      .optional()
      .describe('Caller limit when clamped to the operation cap.'),
    totalCount: z
      .number()
      .int()
      .optional()
      .describe('Known selected collection total; search arrays do not supply a total.'),
    truncation: z
      .object({
        shown: z.number().int().describe('Whole items emitted.'),
        cap: z.number().int().describe('Effective workload cap.'),
      })
      .optional()
      .describe('Further collection rows remain; follow page.nextCursor.'),
  },
  enrichmentTrailer: {
    applied: { render: enrichmentField('applied') },
    notice: { render: enrichmentField('notice') },
    requestedLimit: { render: enrichmentField('requestedLimit') },
    totalCount: { render: enrichmentField('totalCount') },
    truncation: { render: enrichmentField('truncation') },
  },
  errors: [
    {
      reason: 'http_invalid_params',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'The official API returned HTTP 400 for this request.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_search_divisions with valid arguments.',
      retryable: false,
    },
    {
      reason: 'http_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 401.',
      recovery:
        'Repeat ukparl_search_divisions later; if HTTP 401 persists, report the unavailable public API access.',
      retryable: false,
    },
    {
      reason: 'http_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 402 or 403.',
      recovery:
        'Repeat ukparl_search_divisions later; if access remains forbidden, report the blocked public API request.',
      retryable: false,
    },
    {
      reason: 'http_conflict',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'The official API returned HTTP 409, 423 or 424.',
      recovery:
        'Restart ukparl_search_divisions with the original selection and no cursor or contentCursor after the source conflict clears.',
      retryable: false,
    },
    {
      reason: 'http_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'The official API returned HTTP 429 after bounded retry handling.',
      recovery:
        'Wait for the returned retryAfter interval, then repeat ukparl_search_divisions with the same selection.',
      retryable: true,
    },
    {
      reason: 'http_invalid_request',
      code: JsonRpcErrorCode.InvalidRequest,
      thrownBy: 'service',
      when: 'The official API returned an unexpected redirect or another unsupported HTTP client response.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_search_divisions; report a persistent redirect or unsupported response.',
      retryable: false,
    },
    {
      reason: 'invalid_mode',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'Filters, selected identifiers or lobby do not apply to this mode or House.',
      recovery:
        'Use search filters only with mode=search; otherwise provide divisionId and use party/lobby only in voters mode.',
      thrownBy: 'service',
    },
    {
      reason: 'invalid_date_range',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A date is invalid or the lower bound exceeds the upper bound.',
      recovery: 'Supply real ordered YYYY-MM-DD calendar dates or omit either date bound.',
      thrownBy: 'service',
    },
    {
      reason: 'invalid_cursor',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A cursor is malformed or belongs to another selection.',
      recovery: 'Repeat the same tool and filters without cursor or contentCursor to start again.',
      thrownBy: 'service',
    },
    {
      reason: 'source_changed',
      code: JsonRpcErrorCode.Conflict,
      when: 'A selected payload changed during content continuation.',
      recovery:
        'Repeat the original selection without contentCursor and follow the newly returned content cursors.',
      thrownBy: 'service',
    },
    {
      reason: 'queue_full',
      code: JsonRpcErrorCode.RateLimited,
      when: 'The selected voting source request queue is full.',
      recovery: 'Wait briefly and repeat the same division request with unchanged filters.',
      thrownBy: 'service',
    },
  ],
  async handler(input, ctx) {
    const searchFilters = [input.query, input.memberId, input.startDate, input.endDate].some(
      (value) => value !== undefined,
    );
    if (
      (input.mode === 'search' && input.divisionId !== undefined) ||
      (input.mode !== 'search' && (input.divisionId === undefined || searchFilters)) ||
      (input.mode !== 'voters' && (input.party !== undefined || input.lobby !== undefined)) ||
      ((input.mode === 'detail' || input.mode === 'party_totals') &&
        (input.cursor !== undefined || input.limit !== undefined)) ||
      (input.lobby !== undefined &&
        !(
          input.house === 'commons' ? ['aye', 'no', 'not_recorded'] : ['content', 'not_content']
        ).includes(input.lobby))
    ) {
      throw ctx.fail('invalid_mode', 'Use compatible division mode, House and filters.');
    }
    validateDateRange(input.startDate, input.endDate);
    const requested = input.limit ?? (input.mode === 'search' ? 5 : 20);
    const limit = Math.min(requested, input.mode === 'search' ? 10 : 50);
    const { contentCursor, ...selection } = input;
    using call = getParliamentHttp().beginCall(ctx);
    const result = await getDivisionsService().execute({ ...selection, limit }, call);
    return deliverPayload(result.payload, {
      selection: { ...selection, limit },
      tool: 'ukparl_search_divisions',
      contentCursor,
      collection: { count: result.count, repage: result.repage },
      retained: (selected) => ({
        ...(selected.source ? { source: selected.source } : {}),
        identity: {
          house: input.house,
          ...(selected.record
            ? { divisionId: selected.record.divisionId }
            : selected.items?.[0]
              ? { divisionId: selected.items[0].divisionId }
              : {}),
        },
        ...(selected.page ? { page: selected.page } : {}),
      }),
      enrichmentFor: (selected) => ({
        applied: {
          selectionPath: '/selection' as const,
          house: input.house,
          mode: input.mode,
          source: input.house === 'commons' ? ('commons_votes' as const) : ('lords_votes' as const),
          limit,
          ...(selected.page ? { returned: selected.page.returned } : {}),
          dateSemantics: 'Inclusive source division dates; no implicit date window.',
        },
        notice: `${LICENCE_NOTICE} Search results are summaries; use detail or voters with the returned House and divisionId.${input.house === 'commons' ? ' not_recorded is a source list, not abstention.' : ' Lords teller-recorded counts are vote totals, separate from teller identities.'}${requested > limit ? ` Requested limit ${requested} is capped at ${limit}.` : ''}${selected.page?.returned === 0 ? ' No matching rows. Broaden search filters or remove party/lobby filters.' : ''}`,
        ...(requested > limit ? { requestedLimit: requested } : {}),
        ...(selected.page?.total !== undefined ? { totalCount: selected.page.total } : {}),
        ...(selected.page?.hasMore
          ? { truncation: { shown: selected.page.returned, cap: limit } }
          : {}),
      }),
      applyEnrichment: (values) => ctx.enrich(values),
    });
  },
  format: (result) => formatData(result),
});
