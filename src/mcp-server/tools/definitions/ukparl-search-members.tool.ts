/**
 * @fileoverview Find current and historical Westminster members without implicit membership filters.
 * @module mcp-server/tools/definitions/ukparl-search-members.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, validationError } from '@cyanheads/mcp-ts-core/errors';
import { MemberLinkSchema, MemberSchema } from '@/services/members/member-models.js';
import { getMembers } from '@/services/members/members-service.js';
import { pageFor, readCollectionCursor } from '@/services/parliament-http/parliament-cursors.js';
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
} from '@/services/parliament-http/parliament-models.js';

const QuerySchema = z
  .object({
    name: z.string().optional().describe('Applied name substring.'),
    constituency: z
      .string()
      .optional()
      .describe('Applied source location text; not exact constituency equality.'),
    partyId: z
      .string()
      .optional()
      .describe('Applied party identifier, including historical identifiers.'),
    house: z.string().optional().describe('Applied latest-House filter.'),
    currentOnly: z
      .boolean()
      .describe('True requests current members; false leaves membership status unrestricted.'),
    asOf: z.string().optional().describe('Historical membership date, when requested.'),
  })
  .describe('Normalized member-search filters.');
const AppliedSchema = z.object({
  mode: z.enum(['search', 'historical']).describe('Selected modern or historical search.'),
  source: z.literal('members').describe('Official Members API.'),
  limit: z.number().int().describe('Effective maximum whole rows.'),
  filters: z
    .literal('/query')
    .describe('Complete normalized filters are reconstructable in the payload at /query.'),
});
const HitSchema = MemberSchema.extend({
  memberId: z.string().describe('Members API identifier for ukparl_get_member.'),
  links: z.array(MemberLinkSchema).nullish().describe('Published source relationship links.'),
  source: SourceSchema.describe('Actual search provenance.'),
  detailLevel: z
    .literal('summary')
    .describe('Search metadata without optional biographies or histories.'),
}).describe('Complete member search summary.');

/** Search Members API metadata; historical requests reject filters their source cannot apply. */
export const ukparlSearchMembers = tool('ukparl_search_members', {
  description:
    'Find MPs and peers by name, location or constituency, party, House, and current or historical membership. currentOnly=false includes current and former members. asOf selects historical membership and accepts name only, without House, party or location filters. Search results preserve latest profile fields; retrieve sections with ukparl_get_member. Follow opaque cursors with unchanged filters and use contentCursor for oversized records.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    name: optionalText(z.string().trim().min(1)).describe(
      'Name substring; omission searches all names.',
    ),
    constituency: optionalText(z.string().trim().min(1)).describe(
      'Source location or constituency text, not exact equality.',
    ),
    partyId: optionalText(IdSchema).describe(
      'Party ID; active reference parties do not exhaust historical IDs.',
    ),
    house: optionalText(HouseSchema).describe('Filter most recent House; unavailable with asOf.'),
    currentOnly: z
      .boolean()
      .default(false)
      .describe('True restricts to current members; false includes former and current.'),
    asOf: optionalText(DateSchema).describe(
      'Historical membership on YYYY-MM-DD; only name and pagination may accompany it.',
    ),
    cursor: optionalText(z.string().min(1)).describe(
      'Opaque collection cursor for the same filters.',
    ),
    limit: LimitSchema.describe(
      'Requested whole members; default 10, cap 20; safe over-cap integers are clamped.',
    ),
    contentCursor: optionalText(z.string().min(1)).describe(
      'Same-selection lossless content continuation.',
    ),
  }),
  output: z.object({
    ...DeliveryShape,
    mode: z
      .enum(['search', 'historical'])
      .optional()
      .describe('Modern or dated historical search.'),
    query: QuerySchema.optional().describe(
      'Complete normalized filters and membership-date semantics.',
    ),
    items: z.array(HitSchema).optional().describe('Whole summary member records.'),
    page: PageSchema.optional().describe('Collection continuation by actually emitted records.'),
    source: SourceSchema.optional().describe('Actual official search request.'),
    totalCount: z.number().int().optional().describe('Source total before paging.'),
    guidance: z.string().optional().describe('Empty-result recovery guidance.'),
  }),
  enrichment: {
    applied: AppliedSchema.describe('Effective source and workload; full filters stay in /query.'),
    notice: z.string().describe('Licence, historical scope and workload notices.'),
    requestedLimit: z.number().int().optional().describe('Original request when capped.'),
    truncated: z.boolean().optional().describe('Further whole member results remain.'),
    shown: z.number().int().optional().describe('Actual whole members emitted.'),
    cap: z.number().int().optional().describe('Effective member workload cap.'),
  },
  enrichmentTrailer: {
    applied: { render: enrichmentField('applied') },
    notice: { render: enrichmentField('notice') },
    requestedLimit: { render: enrichmentField('requestedLimit') },
    truncated: { render: enrichmentField('truncated') },
    shown: { render: enrichmentField('shown') },
    cap: { render: enrichmentField('cap') },
  },
  errors: [
    {
      reason: 'queue_full',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'The selected Parliament origin has two active requests and 32 queued requests.',
      recovery: 'Wait briefly, then repeat ukparl_search_members with the same filters.',
      retryable: false,
    },
    {
      reason: 'http_invalid_params',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'The official API returned HTTP 400 for this request.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_search_members with valid arguments.',
      retryable: false,
    },
    {
      reason: 'http_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 401.',
      recovery:
        'Repeat ukparl_search_members later; if HTTP 401 persists, report the unavailable public API access.',
      retryable: false,
    },
    {
      reason: 'http_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 402 or 403.',
      recovery:
        'Repeat ukparl_search_members later; if access remains forbidden, report the blocked public API request.',
      retryable: false,
    },
    {
      reason: 'http_conflict',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'The official API returned HTTP 409, 423 or 424.',
      recovery:
        'Restart ukparl_search_members with the original selection and no cursor or contentCursor after the source conflict clears.',
      retryable: false,
    },
    {
      reason: 'http_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'The official API returned HTTP 429 after bounded retry handling.',
      recovery:
        'Wait for the returned retryAfter interval, then repeat ukparl_search_members with the same selection.',
      retryable: true,
    },
    {
      reason: 'http_invalid_request',
      code: JsonRpcErrorCode.InvalidRequest,
      thrownBy: 'service',
      when: 'The official API returned an unexpected redirect or another unsupported HTTP client response.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_search_members; report a persistent redirect or unsupported response.',
      retryable: false,
    },
    {
      reason: 'invalid_mode_arguments',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'Historical search is combined with unsupported filters.',
      recovery:
        'Repeat ukparl_search_members with asOf and optional name only, or remove asOf to use modern filters.',
    },
    {
      reason: 'invalid_cursor',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'A collection or content cursor is invalid or belongs to different filters.',
      recovery:
        'Repeat ukparl_search_members with the same filters and no cursor or contentCursor to restart.',
    },
    {
      reason: 'source_changed',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'Selected source records changed during content retrieval.',
      recovery:
        'Repeat ukparl_search_members with original filters and no contentCursor, then follow the new content cursors.',
    },
  ],
  async handler(input, ctx) {
    const limit = Math.min(20, input.limit);
    const mode = input.asOf ? ('historical' as const) : ('search' as const);
    const query = {
      name: input.name,
      constituency: input.constituency,
      partyId: input.partyId,
      house: input.house,
      currentOnly: input.currentOnly,
      asOf: input.asOf,
    };
    const applied = { mode, source: 'members' as const, limit, filters: '/query' as const };
    const notice = `${LICENCE_NOTICE} ${input.asOf ? 'Historical membership search; latest profile fields are source metadata and may contain null values.' : 'No implicit membership-date restriction; currentOnly=false includes current and former members.'}${input.limit > 20 ? ` Requested limit ${input.limit} is capped at 20.` : ''}`;
    const enrichment = {
      applied,
      notice,
      ...(input.limit > 20 ? { requestedLimit: input.limit } : {}),
    };
    ctx.enrich(enrichment);
    if (input.asOf) {
      const conflicts: string[] = (['constituency', 'partyId', 'house'] as const).filter(
        (field) => input[field],
      );
      if (input.currentOnly) conflicts.push('currentOnly=true');
      if (conflicts.length)
        throw ctx.fail(
          'invalid_mode_arguments',
          `asOf cannot be combined with ${conflicts.join(', ')}; remove the conflicting filter or asOf.`,
        );
    }
    const cursor = readCollectionCursor(input.cursor, {
      source: 'members',
      selector: mode,
      filters: query,
      nativePageSize: limit,
    });
    using call = getParliamentHttp().beginCall(ctx);
    const result = await getMembers().search(call, query, cursor.offset, limit);
    const items = (result.data.items ?? []).map((item) => {
      if (!item.value) throw validationError('Members search supplied a null member record.');
      return {
        ...item.value,
        memberId: String(item.value.id),
        links: item.links,
        source: result.source,
        detailLevel: 'summary' as const,
      };
    });
    if (items.length === 0 && cursor.offset < result.data.totalResults)
      throw validationError(
        'Members search supplied no records before its reported collection end.',
      );
    const repage = (count: number) => ({
      mode,
      query,
      totalCount: result.data.totalResults,
      ...(result.data.totalResults === 0
        ? {
            guidance:
              'No members matched. Repeat ukparl_search_members with broader name or location text, fewer filters, or currentOnly=false.',
          }
        : {}),
      items: items.slice(0, count),
      source: result.source,
      page: pageFor(cursor, count, result.data.totalResults),
    });
    return deliverPayload(repage(items.length), {
      tool: 'ukparl_search_members',
      selection: { query, limit, cursor: input.cursor },
      contentCursor: input.contentCursor,
      collection: { count: items.length, repage },
      enrichmentFor: (selected) => ({
        ...enrichment,
        truncated: selected.page.hasMore,
        shown: selected.page.returned,
        cap: limit,
        notice: `${notice}${selected.page.returned === 0 ? ' No members matched; broaden the name or reduce filters in ukparl_search_members.' : ''}`,
      }),
      applyEnrichment: (values) => ctx.enrich(values),
      retained: (selected) => ({ source: selected.source, page: selected.page }),
    });
  },
  format: (result) => formatData(result),
});
