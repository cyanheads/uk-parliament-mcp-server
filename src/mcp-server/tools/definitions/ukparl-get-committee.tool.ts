/**
 * @fileoverview Discover committees and retrieve memberships, business and published evidence metadata.
 * @module mcp-server/tools/definitions/ukparl-get-committee.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, validationError } from '@cyanheads/mcp-ts-core/errors';
import { CommitteeRecordSchema } from '@/services/committees/committee-models.js';
import {
  CommitteeBusinessSortSchema,
  CommitteeBusinessStatusSchema,
  CommitteeLinkSchema,
  CommitteePublicationSortSchema,
  CommitteeStatusSchema,
  getCommittees,
} from '@/services/committees/committees-service.js';
import {
  invalidCursor,
  pageFor,
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
  DateSchema,
  IdSchema,
  LICENCE_NOTICE,
  LimitSchema,
  optionalText,
  PageSchema,
  SourceSchema,
  validateDateRange,
} from '@/services/parliament-http/parliament-models.js';

const ModeSchema = z.enum([
  'search',
  'detail',
  'members',
  'inquiries',
  'inquiry',
  'publications',
  'publication',
  'evidence',
  'evidence_detail',
]);
const CommitteeHouseSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const house = value.trim().toLowerCase();
    return house === 'house of commons' ? 'commons' : house === 'house of lords' ? 'lords' : house;
  },
  z.enum(['commons', 'lords', 'joint']),
);
const SelectionShape = {
  status: optionalText(z.union([CommitteeStatusSchema, CommitteeBusinessStatusSchema])).describe(
    'Search: Current|Former|All. Inquiries: Open|Closed. Omitted uses source default.',
  ),
  acceptingEvidence: z
    .boolean()
    .optional()
    .describe(
      'Inquiries only: true selects accepting businesses; false leaves source selection unrestricted.',
    ),
  openedFrom: optionalText(DateSchema).describe('Inquiries opened on/after this ISO date.'),
  openedTo: optionalText(DateSchema).describe('Inquiries opened on/before this ISO date.'),
  sortOrder: optionalText(
    z.union([CommitteeBusinessSortSchema, CommitteePublicationSortSchema]),
  ).describe(
    'Inquiries: DateOpenedNewest|DateOpenedOldest|PublicationDateAscending|PublicationDateDescending. Publications: PublicationDateAscending|PublicationDateDescending|ResponseDateAscending|ResponseDateDescending. Omitted preserves source order.',
  ),
  publicationTypeIds: z
    .preprocess(
      (value) => (Array.isArray(value) && value.length === 0 ? undefined : value),
      z.array(IdSchema).optional(),
    )
    .describe(
      'Publications only: positive publication type IDs, serialized as repeated parameters.',
    ),
  publishedFrom: optionalText(DateSchema).describe('Publications starting on/after this ISO date.'),
  publishedTo: optionalText(DateSchema).describe('Publications starting on/before this ISO date.'),
};
const FiltersSchema = z.object({
  ...SelectionShape,
  query: z.string().optional().describe('Normalized source search terms.'),
  house: z
    .enum(['commons', 'lords', 'joint'])
    .optional()
    .describe('Selected search House; Joint remains distinct.'),
  committeeId: z.string().optional().describe('Selected committee namespace ID.'),
  businessId: z.string().optional().describe('Selected committee-business namespace ID.'),
  publicationId: z.string().optional().describe('Selected publication namespace ID.'),
  evidenceId: z.string().optional().describe('Selected evidence namespace ID.'),
  evidenceType: z.enum(['written', 'oral']).optional().describe('Selected evidence namespace.'),
  membership: z
    .enum(['all', 'current', 'former'])
    .optional()
    .describe('Membership-period selector, default all in members mode.'),
});
const AppliedSchema = z.object({
  mode: ModeSchema.describe('Selected committee operation.'),
  source: z.literal('committees').describe('Official Committees API namespace.'),
  filters: z.literal('/filters').describe('Complete normalized selection lives at /filters.'),
  showOnWebsiteOnly: z.literal(true).describe('Explicit website-visible scope on every request.'),
  membershipStatus: z
    .enum(['All', 'Current', 'Former'])
    .optional()
    .describe('Exact upstream MembershipStatus in members mode.'),
  limit: z
    .number()
    .int()
    .optional()
    .describe('Effective collection page size; absent on singular selections.'),
});
const OutputSchema = z.object({
  ...DeliveryShape,
  mode: ModeSchema.optional().describe('Selected committee operation.'),
  filters: FiltersSchema.optional().describe('Complete normalized caller selection.'),
  found: z.boolean().optional().describe('Singular lookup result; false requires guidance.'),
  record: CommitteeRecordSchema.optional().describe(
    'Complete selected source record with typed relationship pointers.',
  ),
  items: z
    .array(CommitteeRecordSchema.describe('Whole source record.'))
    .optional()
    .describe('Selected whole collection items.'),
  page: PageSchema.optional().describe('Whole-record collection continuation.'),
  source: SourceSchema.optional().describe('Actual selected official request provenance.'),
  sourcePage: z
    .object({
      itemsPerPage: z.number().int().describe('Source-reported page size.'),
      links: z
        .array(CommitteeLinkSchema)
        .nullish()
        .describe('Complete source page relationship metadata.'),
      itemsState: z
        .enum(['null', 'present'])
        .describe('Whether source items was null or an actual array.'),
    })
    .optional()
    .describe('Source collection envelope metadata.'),
  guidance: z.string().optional().describe('Recovery for empty or missing selections.'),
});

/** Discover source IDs before following memberships, scrutiny business and publication metadata. */
export const ukparlGetCommittee = tool('ukparl_get_committee', {
  title: 'Get committees and evidence',
  description:
    'Find Westminster committees with mode=search, then use committeeId for detail, members, inquiries or publications. Inquiries returns every committee business type, labelled by isInquiry; use businessId with mode=inquiry for complete business detail or to filter publications. Use publicationId with mode=publication for complete report/publication metadata and source links. Use mode=evidence with businessId and evidenceType=written|oral to list evidence; mode=evidence_detail requires evidenceId and evidenceType in the same namespace. Memberships retain all role periods; personId is distinct from Members API memberId. No document downloads or text extraction. Follow cursors with unchanged filters; contentCursor retrieves oversized records losslessly. Typed entities retain sourcePath relationships to reconstruct nested source metadata.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    ...SelectionShape,
    mode: ModeSchema.default('search').describe(
      'Search, committee detail, members, business list/detail, publication list/detail or written/oral evidence list/detail.',
    ),
    query: optionalText(z.string().trim().min(1)).describe(
      'Search terms for search, inquiries or publications; latter two require at least two characters.',
    ),
    house: optionalText(CommitteeHouseSchema).describe(
      'Commons, Lords or Joint, case-insensitive; exact House of Commons/Lords aliases also accepted. Search only.',
    ),
    committeeId: optionalText(IdSchema).describe(
      'Committee ID required for detail, members and publications; optional for inquiries to discover businesses across committees.',
    ),
    businessId: optionalText(IdSchema).describe(
      'Business ID required for inquiry and evidence; optional additional publication filter.',
    ),
    publicationId: optionalText(IdSchema).describe(
      'Publication ID required for publication detail.',
    ),
    evidenceId: optionalText(IdSchema).describe('Evidence detail ID, scoped by evidenceType.'),
    evidenceType: optionalText(z.enum(['written', 'oral'])).describe(
      'Required for evidence list/detail; written and oral IDs are distinct.',
    ),
    membership: optionalText(z.enum(['all', 'current', 'former'])).describe(
      'Members mode only, default all; filters role-period membership status.',
    ),
    cursor: optionalText(z.string().min(1)).describe(
      'Opaque collection continuation; repeat unchanged filters and effective limit.',
    ),
    limit: LimitSchema.removeDefault()
      .optional()
      .describe(
        'Collection size: search default 10 cap 20; nested default 20 cap 50. Safe over-cap values clamp. Omit for singular modes.',
      ),
    contentCursor: optionalText(z.string().min(1)).describe(
      'Opaque same-selection content continuation; reconstruct records before advancing collection cursor.',
    ),
  }),
  output: OutputSchema,
  enrichment: {
    applied: AppliedSchema.describe(
      'Effective operation, page size and explicit source visibility.',
    ),
    notice: z.string().describe('Licence, namespace, business and document-access notices.'),
    requestedLimit: z.number().int().optional().describe('Original page-size request when capped.'),
    total: z.number().int().optional().describe('Source total collection records.'),
    truncated: z.boolean().optional().describe('Further whole collection records remain.'),
    shown: z.number().int().optional().describe('Actually emitted whole collection records.'),
    cap: z.number().int().optional().describe('Maximum collection workload for this mode.'),
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
      reason: 'invalid_date_range',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'An opened or published date range ends before it starts.',
      recovery: 'Repeat ukparl_get_committee with the starting date on or before the ending date.',
    },
    {
      reason: 'http_invalid_params',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'The official API returned HTTP 400 for this request.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_get_committee with valid arguments.',
      retryable: false,
    },
    {
      reason: 'http_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 401.',
      recovery:
        'Repeat ukparl_get_committee later; if HTTP 401 persists, report the unavailable public API access.',
      retryable: false,
    },
    {
      reason: 'http_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 402 or 403.',
      recovery:
        'Repeat ukparl_get_committee later; if access remains forbidden, report the blocked public API request.',
      retryable: false,
    },
    {
      reason: 'http_conflict',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'The official API returned HTTP 409, 423 or 424.',
      recovery:
        'Restart ukparl_get_committee with the original selection and no cursor or contentCursor after the source conflict clears.',
      retryable: false,
    },
    {
      reason: 'http_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'The official API returned HTTP 429 after bounded retry handling.',
      recovery:
        'Wait for the returned retryAfter interval, then repeat ukparl_get_committee with the same selection.',
      retryable: true,
    },
    {
      reason: 'http_invalid_request',
      code: JsonRpcErrorCode.InvalidRequest,
      thrownBy: 'service',
      when: 'The official API returned an unexpected redirect or another unsupported HTTP client response.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_get_committee; report a persistent redirect or unsupported response.',
      retryable: false,
    },
    {
      reason: 'queue_full',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'Committees origin request queue is full.',
      recovery: 'Wait briefly, then repeat ukparl_get_committee with the same selection.',
    },
    {
      reason: 'invalid_mode_arguments',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'Required mode identifier is missing or another branch argument conflicts.',
      recovery:
        'Repeat ukparl_get_committee using only the fields documented for the selected mode.',
    },
    {
      reason: 'invalid_cursor',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'Collection or content cursor does not match this selection.',
      recovery:
        'Repeat the same tool with unchanged filters and no cursor or contentCursor to restart.',
    },
    {
      reason: 'source_changed',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'Selected source metadata changed during content retrieval.',
      recovery:
        'Repeat the same tool with original filters and no contentCursor, then follow the new content cursors.',
    },
  ],
  async handler(input, ctx) {
    const { mode } = input;
    const collection =
      mode === 'search' ||
      mode === 'members' ||
      mode === 'inquiries' ||
      mode === 'publications' ||
      mode === 'evidence';
    const allowed: Record<z.infer<typeof ModeSchema>, readonly string[]> = {
      search: ['query', 'house', 'status'],
      detail: ['committeeId'],
      members: ['committeeId', 'membership'],
      inquiries: [
        'committeeId',
        'query',
        'status',
        'acceptingEvidence',
        'openedFrom',
        'openedTo',
        'sortOrder',
      ],
      inquiry: ['businessId'],
      publications: [
        'committeeId',
        'businessId',
        'query',
        'sortOrder',
        'publicationTypeIds',
        'publishedFrom',
        'publishedTo',
      ],
      publication: ['publicationId'],
      evidence: ['businessId', 'evidenceType'],
      evidence_detail: ['evidenceId', 'evidenceType'],
    };
    const filters = FiltersSchema.parse({
      status: input.status,
      acceptingEvidence: input.acceptingEvidence,
      openedFrom: input.openedFrom,
      openedTo: input.openedTo,
      sortOrder: input.sortOrder,
      publicationTypeIds: input.publicationTypeIds,
      publishedFrom: input.publishedFrom,
      publishedTo: input.publishedTo,
      query: input.query,
      house: input.house,
      committeeId: input.committeeId,
      businessId: input.businessId,
      publicationId: input.publicationId,
      evidenceId: input.evidenceId,
      evidenceType: input.evidenceType,
      membership: input.membership,
    });
    const requiredField =
      mode === 'inquiry' || mode === 'evidence'
        ? 'businessId'
        : mode === 'publication'
          ? 'publicationId'
          : mode === 'evidence_detail'
            ? 'evidenceId'
            : 'committeeId';
    const requiredId = mode === 'search' ? undefined : input[requiredField];
    const discovery =
      requiredField === 'businessId'
        ? 'mode=inquiries'
        : requiredField === 'publicationId'
          ? 'mode=publications'
          : requiredField === 'evidenceId'
            ? 'mode=evidence with the same evidenceType'
            : 'mode=search';
    const missingIdMessage = `mode=${mode} requires ${requiredField}; supply ${requiredField} from ${discovery}.`;
    const conflicts: string[] = [];
    if (mode !== 'search' && mode !== 'inquiries' && requiredId === undefined)
      conflicts.push(missingIdMessage);
    if ((mode === 'evidence' || mode === 'evidence_detail') && input.evidenceType === undefined)
      conflicts.push(
        `mode=${mode} requires evidenceType=written or evidenceType=oral; select the evidence namespace.`,
      );
    for (const [field, value] of Object.entries(filters)) {
      if (value === undefined || allowed[mode].includes(field)) continue;
      const compatible = Object.entries(allowed)
        .filter(([, fields]) => fields.includes(field))
        .map(([name]) => name);
      const modes =
        compatible.length === 1
          ? compatible[0]
          : `${compatible.slice(0, -1).join(', ')} or ${compatible.at(-1)}`;
      conflicts.push(
        `${field} is unsupported for mode=${mode}; omit ${field} or select mode=${modes}.`,
      );
    }
    if (
      mode === 'search' &&
      input.status !== undefined &&
      !CommitteeStatusSchema.safeParse(input.status).success
    )
      conflicts.push(
        `status=${JSON.stringify(input.status)} is incompatible with mode=search; use Current, Former or All.`,
      );
    if (
      mode === 'inquiries' &&
      input.status !== undefined &&
      !CommitteeBusinessStatusSchema.safeParse(input.status).success
    )
      conflicts.push(
        `status=${JSON.stringify(input.status)} is incompatible with mode=inquiries; use Open or Closed.`,
      );
    if (
      mode === 'inquiries' &&
      input.sortOrder !== undefined &&
      !CommitteeBusinessSortSchema.safeParse(input.sortOrder).success
    )
      conflicts.push(
        `sortOrder=${JSON.stringify(input.sortOrder)} is incompatible with mode=inquiries; use DateOpenedNewest, DateOpenedOldest, PublicationDateAscending or PublicationDateDescending.`,
      );
    if (
      mode === 'publications' &&
      input.sortOrder !== undefined &&
      !CommitteePublicationSortSchema.safeParse(input.sortOrder).success
    )
      conflicts.push(
        `sortOrder=${JSON.stringify(input.sortOrder)} is incompatible with mode=publications; use PublicationDateAscending, PublicationDateDescending, ResponseDateAscending or ResponseDateDescending.`,
      );
    if (!collection && input.cursor !== undefined)
      conflicts.push(`cursor is unsupported for singular mode=${mode}; omit cursor.`);
    if (!collection && input.limit !== undefined)
      conflicts.push(`limit is unsupported for singular mode=${mode}; omit limit.`);
    if (
      (mode === 'inquiries' || mode === 'publications') &&
      input.query !== undefined &&
      input.query.length < 2
    )
      conflicts.push(
        `query in mode=${mode} requires at least 2 characters; supply a longer query or omit query.`,
      );
    if (conflicts.length > 0) throw ctx.fail('invalid_mode_arguments', conflicts.join(' '));
    validateDateRange(input.openedFrom, input.openedTo);
    validateDateRange(input.publishedFrom, input.publishedTo);
    if (mode === 'members') filters.membership = input.membership ?? 'all';
    const cap = mode === 'search' ? 20 : 50;
    const requestedLimit = input.limit ?? (mode === 'search' ? 10 : 20);
    const limit = Math.min(cap, requestedLimit);
    const selection = { mode, filters, ...(collection ? { limit, cursor: input.cursor } : {}) };
    const applied = AppliedSchema.parse({
      mode,
      source: 'committees',
      filters: '/filters',
      showOnWebsiteOnly: true,
      ...(collection ? { limit } : {}),
      ...(mode === 'members'
        ? {
            membershipStatus:
              filters.membership === 'current'
                ? 'Current'
                : filters.membership === 'former'
                  ? 'Former'
                  : 'All',
          }
        : {}),
    });
    const notice = `${LICENCE_NOTICE} Committee personId and membership recordId are source-specific; memberId comes only from memberInfo.mnisId. Inquiries includes every business type, including isInquiry=false. Document/file metadata and source-provided links only; a null file URL is unavailable and additionalContentUrl may provide the published report. No downloads or text extraction.${collection && requestedLimit > cap ? ` Requested limit ${requestedLimit} is capped at ${cap}.` : ''}`;
    const enrichment = {
      applied,
      notice,
      ...(collection && requestedLimit > cap ? { requestedLimit } : {}),
    };
    if (!collection) {
      using call = getParliamentHttp().beginCall(ctx);
      const service = getCommittees();
      if (!requiredId) throw ctx.fail('invalid_mode_arguments', missingIdMessage);
      const response =
        mode === 'detail'
          ? await service.detail(call, requiredId)
          : mode === 'inquiry'
            ? await service.inquiry(call, requiredId)
            : mode === 'evidence_detail' && input.evidenceType
              ? await service.evidenceDetail(call, input.evidenceType, requiredId)
              : await service.publication(call, requiredId);
      const payload = {
        mode,
        filters,
        found: response !== undefined,
        ...(response
          ? { record: response.data, source: response.source }
          : {
              guidance:
                'No website-visible source record matched. Repeat ukparl_get_committee in search, inquiries, publications or evidence mode to discover the correct namespace ID.',
            }),
      };
      return deliverPayload(payload, {
        tool: 'ukparl_get_committee',
        selection,
        contentCursor: input.contentCursor,
        retained: (selected) => ({
          ...('source' in selected ? { source: selected.source } : {}),
          identity: { recordId: requiredId },
        }),
        enrichmentFor: () => enrichment,
        applyEnrichment: (values) => ctx.enrich(values),
      });
    }
    const cursor = readCollectionCursor(input.cursor, {
      source: 'committees',
      selector: mode,
      filters,
      nativePageSize: limit,
    });
    using call = getParliamentHttp().beginCall(ctx);
    const service = getCommittees();
    const committeeId = input.committeeId;
    if (mode !== 'search' && mode !== 'evidence' && mode !== 'inquiries' && !committeeId)
      throw ctx.fail('invalid_mode_arguments', missingIdMessage);
    const response =
      mode === 'search'
        ? await service.search(
            call,
            {
              ...filters,
              status:
                input.status === undefined ? undefined : CommitteeStatusSchema.parse(input.status),
            },
            cursor.offset,
            limit,
          )
        : mode === 'members' && committeeId
          ? await service.members(
              call,
              committeeId,
              filters.membership ?? 'all',
              cursor.offset,
              limit,
            )
          : mode === 'evidence' && input.evidenceType && input.businessId
            ? await service.evidence(
                call,
                input.evidenceType,
                input.businessId,
                cursor.offset,
                limit,
              )
            : mode === 'inquiries'
              ? await service.inquiries(call, committeeId, input.query, cursor.offset, limit, {
                  ...filters,
                  status:
                    input.status === undefined
                      ? undefined
                      : CommitteeBusinessStatusSchema.parse(input.status),
                  sortOrder:
                    input.sortOrder === undefined
                      ? undefined
                      : CommitteeBusinessSortSchema.parse(input.sortOrder),
                })
              : committeeId
                ? await service.publications(
                    call,
                    committeeId,
                    input.businessId,
                    input.query,
                    cursor.offset,
                    limit,
                    {
                      ...filters,
                      sortOrder:
                        input.sortOrder === undefined
                          ? undefined
                          : CommitteePublicationSortSchema.parse(input.sortOrder),
                    },
                  )
                : invalidCursor();
    const items = response.data.items;
    if (items.length > limit || (items.length === 0 && cursor.offset < response.data.totalResults))
      throw validationError(
        'Committee collection does not agree with its requested size or source total.',
      );
    const repage = (count: number) => ({
      mode,
      filters,
      source: response.source,
      sourcePage: {
        itemsPerPage: response.data.itemsPerPage,
        links: response.data.links,
        itemsState: response.data.itemsState,
      },
      items: items.slice(0, count),
      page: pageFor(cursor, count, response.data.totalResults),
      ...(items.length === 0
        ? {
            guidance:
              'No website-visible records matched; broaden the text, change the membership selector, or discover another committee ID with mode=search.',
          }
        : {}),
    });
    return deliverPayload(repage(items.length), {
      tool: 'ukparl_get_committee',
      selection,
      contentCursor: input.contentCursor,
      collection: { count: items.length, repage },
      retained: (selected) => ({ source: selected.source, page: selected.page }),
      enrichmentFor: (selected) => ({
        ...enrichment,
        total: selected.page.total,
        truncated: selected.page.hasMore,
        shown: selected.page.returned,
        cap,
        notice: `${notice}${selected.page.returned === 0 ? ' No records matched; broaden the selection.' : ''}`,
      }),
      applyEnrichment: (values) => ctx.enrich(values),
    });
  },
  format: (result) => formatData(result),
});
