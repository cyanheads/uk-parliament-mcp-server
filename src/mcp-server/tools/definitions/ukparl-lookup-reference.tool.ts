/**
 * @fileoverview Parliament identifier namespaces and source coverage reference.
 * @module mcp-server/tools/definitions/ukparl-lookup-reference.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, validationError } from '@cyanheads/mcp-ts-core/errors';
import { Bills } from '@/services/bills/bills-schemas.js';
import { getBillsService } from '@/services/bills/bills-service.js';
import { HANSARD_COVERAGE, HansardCoverageSchema } from '@/services/hansard/hansard-schemas.js';
import {
  AnsweringBodySchema,
  DepartmentSchema,
  MemberLinkSchema,
  PartySchema,
} from '@/services/members/member-models.js';
import { getMembers } from '@/services/members/members-service.js';
import {
  advanceCollectionCursor,
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
  HouseSchema,
  LICENCE_NOTICE,
  LimitSchema,
  optionalText,
  PageSchema,
  type Source,
  SourceSchema,
} from '@/services/parliament-http/parliament-models.js';

const TopicSchema = z.enum([
  'identifiers',
  'coverage',
  'bill_stages',
  'bill_types',
  'parties',
  'departments',
  'answering_bodies',
]);
const IdentifiersSchema = z.object({
  namespaces: z
    .array(
      z
        .object({
          namespace: z
            .string()
            .describe('Identifier namespace; never interchangeable with another row.'),
          format: z.string().describe('Accepted identifier syntax.'),
          discovery: z.string().describe('Same-server discovery route.'),
          distinction: z.string().describe('Source-specific identifier distinction.'),
        })
        .describe('One identifier namespace and its discovery route.'),
    )
    .describe('Parliament identifier namespaces.'),
  modes: z
    .array(
      z
        .object({
          tool: z.string().describe('Tool accepting these selections.'),
          selectors: z
            .array(z.string().describe('Supported mode or section.'))
            .describe('Supported mode/section names.'),
        })
        .describe('One tool and its supported selections.'),
    )
    .describe('Supported tool selections.'),
  sessionDiscovery: z
    .string()
    .describe('How to discover bill session identifiers without a current-session assumption.'),
});
const CoverageSchema = HansardCoverageSchema.extend({
  scope: z.string().describe('Institutional scope.'),
  sources: z
    .array(
      z
        .object({
          label: z.string().describe('Official source title.'),
          url: z.string().describe('Official source HTTPS URL.'),
        })
        .describe('One official source link.'),
    )
    .describe('Official evidence for archive dates and warnings.'),
  guidance: z.string().describe('How to interpret dates, empty results and timeouts.'),
});
const identifiers: z.infer<typeof IdentifiersSchema> = {
  namespaces: [
    {
      namespace: 'billId',
      format: 'Positive int32 decimal string.',
      discovery: 'ukparl_search_bills',
      distinction: 'Identifies a bill; a bill title never establishes an Act identifier.',
    },
    {
      namespace: 'billStageId',
      format: 'Positive int32 decimal string.',
      discovery: 'ukparl_get_bill section=stages',
      distinction: 'Bill-specific stage occurrence; different from a reference stageId.',
    },
    {
      namespace: 'stageId and billTypeId',
      format: 'Positive int32 decimal strings.',
      discovery: 'ukparl_lookup_reference topic=bill_stages or bill_types',
      distinction: 'Reference filters, not bill-specific stage occurrences.',
    },
    {
      namespace: 'memberId',
      format: 'Positive int32 decimal string.',
      discovery: 'ukparl_search_members',
      distinction:
        'Members API join handle only where another source explicitly supplies memberId or mnisId.',
    },
    {
      namespace: 'divisionId',
      format: 'Positive int32 decimal string plus commons or lords House.',
      discovery: 'ukparl_search_divisions mode=search',
      distinction: 'Commons and Lords division namespaces are separate.',
    },
    {
      namespace: 'questionId',
      format: 'Positive int32 decimal string.',
      discovery: 'ukparl_search_questions mode=search',
      distinction: 'A question UIN alone is not an ID; date is needed to resolve a UIN.',
    },
    {
      namespace: 'committeeId, businessId and publicationId',
      format: 'Positive int32 decimal strings.',
      discovery: 'ukparl_get_committee mode=search and its returned collections',
      distinction:
        'Committee person IDs and internal membership IDs are not Members API member IDs.',
    },
    {
      namespace: 'Hansard external contribution/debate IDs',
      format: 'Nonblank source string, including historic decimal strings.',
      discovery: 'ukparl_search_hansard',
      distinction: 'Not UUID-only; numeric debateSectionId is separate from DebateSectionExtId.',
    },
    {
      namespace: 'partyId, departmentId and answeringBodyId',
      format: 'Positive int32 decimal strings.',
      discovery: 'ukparl_lookup_reference matching topic',
      distinction:
        'Answering bodies are not departments. Active parties are not an exhaustive historical party directory.',
    },
  ],
  modes: [
    {
      tool: 'ukparl_get_bill',
      selectors: [
        'overview',
        'stages',
        'stage',
        'publications',
        'amendments',
        'amendment',
        'motions',
        'motion',
      ],
    },
    {
      tool: 'ukparl_get_member',
      selectors: ['profile', 'roles', 'committee_seats', 'contact', 'interests', 'voting'],
    },
    { tool: 'ukparl_search_divisions', selectors: ['search', 'detail', 'voters', 'party_totals'] },
    { tool: 'ukparl_search_questions', selectors: ['search', 'detail'] },
    {
      tool: 'ukparl_get_committee',
      selectors: [
        'search',
        'detail',
        'members',
        'inquiries',
        'inquiry',
        'publications',
        'publication',
      ],
    },
  ],
  sessionDiscovery:
    'Read introducedSessionId and includedSessionIds from bill search/detail and sessionId from bill stages. No session directory or semantic current-session default is supplied.',
};
const coverage: z.infer<typeof CoverageSchema> = {
  ...HANSARD_COVERAGE,
  scope:
    'Westminster: UK House of Commons and House of Lords; devolved legislatures are outside scope.',
  sources: [
    {
      label: 'Parliament historical Hansard coverage',
      url: 'https://www.parliament.uk/about/how/publications/hansard/index/',
    },
    {
      label: 'First Series, Volume 1: 22 November 1803 and missing-material notice',
      url: 'https://api.parliament.uk/historic-hansard/volumes/1/1',
    },
    {
      label: 'Hansard search website coverage warning',
      url: 'https://hansard.parliament.uk/search',
    },
  ],
  guidance:
    'No dates imply no current-only scope. Earlier or crossing ranges pass unchanged to the spoken API with coverage guidance. Empty results do not establish no debate occurred. Samples do not establish continuous historical coverage. After a timeout repeat ukparl_search_hansard with shorter date windows. Historic Hansard is not an automatic fallback.',
};

const ReferenceSchema = z
  .object({
    ...Bills.reference.shape,
    ...PartySchema.shape,
    ...DepartmentSchema.shape,
    ...AnsweringBodySchema.shape,
    id: z.string().describe('Reference decimal identifier within the selected topic.'),
    departmentId: z
      .string()
      .optional()
      .describe('Associated department decimal identifier when supplied.'),
    house: z.string().nullish().describe('Source House label, or selected active-party House.'),
    links: z.array(MemberLinkSchema).nullish().describe('Published party wrapper relationships.'),
  })
  .describe('Complete typed metadata from the selected named reference directory.');

/** Resolve complete live reference sets or static identifier and coverage guides. */
export const ukparlLookupReference = tool('ukparl_lookup_reference', {
  description:
    'Resolve Parliament filter IDs and inspect source coverage before searching. Use identifiers for ID namespaces and required selectors, coverage for Hansard date limitations, or a named reference topic for filter IDs. Follow opaque collection cursors with the same filters; use contentCursor to reconstruct an oversized selected payload.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    topic: TopicSchema.describe('Reference topic or static identifier/coverage guide.'),
    house: optionalText(HouseSchema).describe('Commons or Lords; required for active parties.'),
    nameContains: optionalText(z.string().trim().min(1)).describe(
      'Case-insensitive AND tokens over the complete named reference set.',
    ),
    cursor: optionalText(z.string().min(1)).describe(
      'Opaque collection cursor; repeat the same normalized filters.',
    ),
    limit: LimitSchema.describe(
      'Requested whole reference rows; positive safe integer, default 10, effective cap 20.',
    ),
    contentCursor: optionalText(z.string().min(1)).describe(
      'Opaque same-selection recursive content continuation.',
    ),
  }),
  output: z.object({
    ...DeliveryShape,
    topic: TopicSchema.optional().describe('Selected reference topic on a full payload.'),
    identifiers: IdentifiersSchema.optional().describe(
      'Static typed identifier namespaces and supported selections.',
    ),
    coverage: CoverageSchema.optional().describe(
      'Static typed historical coverage facts and official sources.',
    ),
    items: z
      .array(ReferenceSchema.describe('One complete typed reference row.'))
      .optional()
      .describe('Complete named reference rows in the selected page.'),
    page: PageSchema.optional().describe('Whole reference-row pagination.'),
    sources: z
      .array(SourceSchema.describe('One official reference request provenance record.'))
      .optional()
      .describe('All requests that supplied the complete reference set.'),
    nameContains: z
      .string()
      .optional()
      .describe('Complete normalized AND-token filter, retained through content continuation.'),
  }),
  enrichment: {
    totalCount: z
      .number()
      .int()
      .optional()
      .describe('Known complete selected guide or reference row count.'),
    applied: z
      .object({
        topic: TopicSchema.describe('Normalized topic.'),
        house: z.string().optional().describe('Normalized House.'),
        nameContainsLocation: z
          .literal('/nameContains')
          .optional()
          .describe('Complete normalized local filter is in the selected payload.'),
        limit: z.number().int().describe('Effective reference row limit.'),
        source: z.string().describe('Static guide or official API selection.'),
      })
      .describe('Normalized selection applied by this call.'),
    notice: z.string().optional().describe('Licence, coverage and workload notices.'),
    requestedLimit: z
      .number()
      .int()
      .optional()
      .describe('Caller limit before an effective cap was applied.'),
    truncated: z
      .boolean()
      .optional()
      .describe('Further reference rows remain after the selected page.'),
    shown: z
      .number()
      .int()
      .optional()
      .describe('Actual whole reference rows selected for delivery.'),
    cap: z.number().int().optional().describe('Effective maximum whole reference rows per call.'),
  },
  enrichmentTrailer: {
    applied: { render: enrichmentField('applied') },
    notice: { render: enrichmentField('notice') },
    totalCount: { render: enrichmentField('totalCount') },
    requestedLimit: { render: enrichmentField('requestedLimit') },
    truncated: { render: enrichmentField('truncated') },
    shown: { render: enrichmentField('shown') },
    cap: { render: enrichmentField('cap') },
  },
  errors: [
    {
      reason: 'invalid_mode_arguments',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A static topic has live filters, parties lacks House, or another topic has House.',
      recovery:
        'Call ukparl_lookup_reference with topic=identifiers, then repeat this tool with the fields required by its selected mode.',
    },
    {
      reason: 'http_invalid_params',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'The official reference API rejects request parameters.',
      recovery: 'Repeat ukparl_lookup_reference with a valid topic and its supported filters.',
      thrownBy: 'service',
    },
    {
      reason: 'http_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      when: 'The official reference API requires authorization unexpectedly.',
      recovery:
        'Retry ukparl_lookup_reference later; these public reference routes require no credentials.',
      thrownBy: 'service',
    },
    {
      reason: 'http_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      when: 'The official reference API denies access.',
      recovery: 'Retry ukparl_lookup_reference later when the public source permits access.',
      thrownBy: 'service',
    },
    {
      reason: 'http_conflict',
      code: JsonRpcErrorCode.Conflict,
      when: 'The official reference API reports a conflicting request state.',
      recovery: 'Repeat ukparl_lookup_reference with the same topic after a short wait.',
      thrownBy: 'service',
    },
    {
      reason: 'http_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      when: 'The official reference API or local origin queue is rate limited.',
      recovery: 'Wait before repeating ukparl_lookup_reference and reduce concurrent calls.',
      retryable: true,
      thrownBy: 'service',
    },
    {
      reason: 'http_invalid_request',
      code: JsonRpcErrorCode.InvalidRequest,
      when: 'The official reference API rejects the request or redirects it.',
      recovery: 'Repeat ukparl_lookup_reference later with the same supported topic and filters.',
      thrownBy: 'service',
    },
    {
      reason: 'invalid_cursor',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A content or collection cursor is malformed or bound to another selection.',
      recovery:
        'Repeat the same tool with the same filters and no cursor or contentCursor to start a new page sequence.',
      thrownBy: 'service',
    },
    {
      reason: 'source_changed',
      code: JsonRpcErrorCode.Conflict,
      when: 'The selected normalized payload changed during content continuation.',
      recovery:
        'Repeat the same tool with its original filters and no contentCursor, then follow the new content cursors.',
      thrownBy: 'service',
    },
  ],
  async handler(input, ctx) {
    const limit = Math.min(input.limit, 20);
    const isStatic = input.topic === 'identifiers' || input.topic === 'coverage';
    if (
      (isStatic && (input.house || input.nameContains || input.cursor)) ||
      (input.topic === 'parties' && !input.house) ||
      (input.topic !== 'parties' && input.house)
    )
      throw ctx.fail(
        'invalid_mode_arguments',
        'Static topics accept no House, nameContains or collection cursor. House is required only for parties and is unsupported on other topics.',
      );
    const nameContains = input.nameContains?.toLowerCase().split(/\s+/).sort().join(' ');
    const applied = {
      topic: input.topic,
      ...(input.house ? { house: input.house } : {}),
      ...(nameContains ? { nameContainsLocation: '/nameContains' as const } : {}),
      limit,
      source:
        input.topic === 'identifiers' || input.topic === 'coverage'
          ? 'static_official_source_guide'
          : 'official_reference_api',
    };
    let notice = `${LICENCE_NOTICE}${input.limit > 20 ? ` Requested limit ${input.limit} is capped at 20 reference rows.` : ''}`;
    const enrichment = {
      applied,
      ...(input.limit > 20 ? { requestedLimit: input.limit } : {}),
    };
    if (isStatic) {
      const payload =
        input.topic === 'identifiers'
          ? { topic: input.topic, identifiers }
          : { topic: input.topic, coverage };
      return deliverPayload(payload, {
        tool: 'ukparl_lookup_reference',
        selection: { topic: input.topic, limit },
        contentCursor: input.contentCursor,
        enrichmentFor: () => ({ ...enrichment, notice, totalCount: 1 }),
        applyEnrichment: (values) => ctx.enrich(values),
      });
    }
    const selection = { topic: input.topic, house: input.house, nameContains, limit };
    const cursor = readCollectionCursor(input.cursor, {
      source: 'official_reference_api',
      selector: input.topic,
      filters: selection,
      nativePageSize: limit,
    });
    using call = getParliamentHttp().beginCall(ctx);
    let items: z.infer<typeof ReferenceSchema>[];
    let sources: Source[];
    if (input.topic === 'bill_stages' || input.topic === 'bill_types') {
      const result = await getBillsService().references(input.topic, call);
      items = result.items;
      sources = result.sources;
    } else if (input.topic === 'parties') {
      if (!input.house) throw ctx.fail('invalid_mode_arguments');
      const result = await getMembers().parties(call, input.house);
      if (!result.items)
        throw validationError('Active-party source omitted its complete items collection.');
      items = result.items.map((item) => {
        if (!item.value)
          throw validationError('Active-party source returned an unavailable party value.');
        return {
          ...item.value,
          id: String(item.value.id),
          house: input.house,
          ...(item.links !== undefined ? { links: item.links } : {}),
        };
      });
      sources = [result.source];
      notice +=
        ' Active parties cover only the selected House; this is not an exhaustive historical party directory.';
    } else {
      const result =
        input.topic === 'departments'
          ? await getMembers().departments(call)
          : await getMembers().answeringBodies(call);
      items = result.data.map((item) => ({
        ...item,
        id: String(item.id),
        ...('department' in item && item.department
          ? { departmentId: String(item.department.id) }
          : {}),
      }));
      sources = [result.source];
    }
    const tokens = nameContains?.split(' ') ?? [];
    const filtered = items.filter((item) =>
      tokens.every((token) => item.name?.toLowerCase().includes(token)),
    );
    if (filtered.length === 0)
      notice +=
        ' No matches. Repeat ukparl_lookup_reference with the same topic and no nameContains filter.';
    const page = (count: number) => {
      const selected = filtered.slice(cursor.offset, cursor.offset + count);
      const hasMore = cursor.offset + selected.length < filtered.length;
      return {
        topic: input.topic,
        ...(nameContains ? { nameContains } : {}),
        items: selected,
        sources,
        page: {
          returned: selected.length,
          total: filtered.length,
          hasMore,
          ...(hasMore ? { nextCursor: advanceCollectionCursor(cursor, selected.length) } : {}),
        },
      };
    };
    const payload = page(limit);
    const source = sources[0];
    if (!source) throw validationError('Reference source returned no request provenance.');
    return deliverPayload(payload, {
      tool: 'ukparl_lookup_reference',
      selection: { ...selection, cursor: input.cursor },
      contentCursor: input.contentCursor,
      collection: { count: payload.items.length, repage: page },
      retained: (selected) => ({
        source,
        identity: { topic: selected.topic },
        page: selected.page,
      }),
      enrichmentFor: (selected) => ({
        ...enrichment,
        notice,
        totalCount: selected.page.total,
        ...(selected.page.hasMore
          ? { truncated: true, shown: selected.items.length, cap: limit }
          : {}),
      }),
      applyEnrichment: (values) => ctx.enrich(values),
    });
  },
  format: (result) => formatData(result),
});
