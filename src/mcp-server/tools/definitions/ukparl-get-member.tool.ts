/**
 * @fileoverview Selected member profiles, whole histories, official contacts and native vote pages.
 * @module mcp-server/tools/definitions/ukparl-get-member.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, validationError } from '@cyanheads/mcp-ts-core/errors';
import {
  BiographyCategorySchema,
  BiographyPeriodSchema,
  CommitteeMemberSchema,
  ContactSchema,
  MemberLinkSchema,
  MemberSchema,
  VoteSchema,
} from '@/services/members/member-models.js';
import {
  FlatCommitteeSchema,
  FlatInterestCategorySchema,
  flattenCommitteeSeat,
  flattenInterestCategory,
} from '@/services/members/member-normalization.js';
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
  IdSchema,
  LICENCE_NOTICE,
  LimitSchema,
  optionalText,
  PageSchema,
  type Source,
  SourceSchema,
} from '@/services/parliament-http/parliament-models.js';

const SectionSchema = z
  .enum(['profile', 'roles', 'committee_seats', 'contact', 'interests', 'voting'])
  .describe('Member subsection.');
const ItemSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('role').describe('Whole biography period.'),
        value: BiographyPeriodSchema,
      })
      .describe('Selected role period.'),
    z
      .object({
        kind: z.literal('contact').describe('Official contact record.'),
        value: ContactSchema,
      })
      .describe('Selected official contact.'),
    z
      .object({
        kind: z.literal('interest_category').describe('Whole recursive interest category.'),
        value: FlatInterestCategorySchema,
      })
      .describe('Selected interest category.'),
    z
      .object({
        kind: z.literal('vote').describe('Recorded vote.'),
        divisionId: z
          .string()
          .describe('Division ID to pair with the explicit House in ukparl_search_divisions.'),
        value: VoteSchema,
        links: z.array(MemberLinkSchema).nullish().describe('Published vote relationships.'),
      })
      .describe('Recorded division and member vote.'),
    z
      .object({
        kind: z.literal('committee_seat').describe('Whole committee seat.'),
        committeeId: z.string().describe('Committee ID for ukparl_get_committee.'),
        value: FlatCommitteeSchema,
        relatedCommittees: z
          .array(FlatCommitteeSchema)
          .describe('Every related committee with explicit source paths.'),
        member: CommitteeMemberSchema.omit({ committees: true }).describe(
          'Source person and explicit MNIS member join metadata.',
        ),
      })
      .describe('Committee membership with whole role periods.'),
  ])
  .describe('One whole selected source item.');
const RecordSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('profile').describe('Complete published member profile.'),
      value: MemberSchema,
      links: z
        .array(MemberLinkSchema)
        .nullish()
        .describe('Published member profile relationships.'),
    })
    .describe('Complete member profile value and source links.'),
  z
    .object({
      kind: z.literal('role_categories').describe('Biography category outline.'),
      categories: z
        .array(
          z
            .object({
              category: BiographyCategorySchema,
              count: z
                .number()
                .int()
                .nonnegative()
                .nullable()
                .describe('Exact whole-period count, or null when source category is unavailable.'),
              available: z.boolean().describe('Whether the source supplied this collection.'),
            })
            .describe('Biography category availability and exact count.'),
        )
        .describe('Every supported biography category.'),
    })
    .describe('Category outline; select one category for whole periods.'),
]);
const AppliedSchema = z.object({
  memberId: z.string().describe('Selected Members API ID.'),
  section: SectionSchema.describe('Selected subsection.'),
  category: BiographyCategorySchema.optional().describe('Selected biography category.'),
  house: z.string().optional().describe('Explicit chamber for interests or voting.'),
  limit: z
    .number()
    .int()
    .describe('Effective whole-item limit; voting always requests a native 20-row page.'),
  source: z.string().describe('Selected official source namespace.'),
});
const MembershipContextSchema = CommitteeMemberSchema.omit({ committees: true })
  .extend({
    committeesState: z
      .enum(['missing', 'null', 'present'])
      .describe('Whether the source supplied a committee membership collection.'),
  })
  .describe('Source person metadata and membership-collection availability.');
interface Payload {
  found: boolean;
  guidance?: string;
  items?: z.infer<typeof ItemSchema>[];
  links?: z.infer<typeof MemberLinkSchema>[] | null | undefined;
  memberId: string;
  membershipContexts?: z.infer<typeof MembershipContextSchema>[];
  nativePage?: number;
  nativePageSize?: number;
  page?: z.infer<typeof PageSchema>;
  record?: z.infer<typeof RecordSchema>;
  section: z.infer<typeof SectionSchema>;
  source?: Source;
  totalCount?: number;
}

/** Retrieve exactly one member subsection with complete, independently paged source data. */
export const ukparlGetMember = tool('ukparl_get_member', {
  description:
    'Retrieve a member profile, roles, committee seats, official contact information, registered interests or recorded voting history. Roles without category lists available biography categories; select category to page whole periods. Interests and voting require an explicit House. Committee person IDs differ from member IDs. Voting uses native 20-row pages and reports recorded lobby and teller facts, without lifetime participation metrics. Follow collection cursors with unchanged selectors; use contentCursor to reconstruct oversized records.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    memberId: IdSchema.describe('Members API decimal identifier from ukparl_search_members.'),
    section: SectionSchema.default('profile').describe(
      'Selected member subsection; default profile.',
    ),
    category: optionalText(BiographyCategorySchema).describe(
      'Roles only: select one complete biography collection.',
    ),
    house: optionalText(HouseSchema).describe(
      'Required for interests and voting; forbidden for other sections.',
    ),
    cursor: optionalText(z.string().min(1)).describe(
      'Opaque whole-item collection continuation with unchanged selectors.',
    ),
    limit: LimitSchema.default(20).describe(
      'Requested whole rows; default 20, cap 50 for local histories. Voting uses native 20-row pages independently of limit.',
    ),
    contentCursor: optionalText(z.string().min(1)).describe(
      'Opaque same-selection lossless content continuation.',
    ),
  }),
  output: z.object({
    ...DeliveryShape,
    found: z.boolean().optional().describe('Whether the parent member exists.'),
    section: SectionSchema.optional().describe('Selected member subsection.'),
    memberId: z.string().optional().describe('Canonical Members API identifier.'),
    record: RecordSchema.optional().describe(
      'Whole member profile or explicit role category outline.',
    ),
    items: z.array(ItemSchema).optional().describe('Whole selected source records tagged by kind.'),
    page: PageSchema.optional().describe('Continuation by actual emitted items.'),
    source: SourceSchema.optional().describe('Actual selected source request.'),
    totalCount: z
      .number()
      .int()
      .optional()
      .describe('Complete selected collection count when known.'),
    membershipContexts: z
      .array(MembershipContextSchema)
      .optional()
      .describe(
        'Source person metadata, including people with unavailable or empty membership collections.',
      ),
    links: z.array(MemberLinkSchema).nullish().describe('Selected source relationship links.'),
    guidance: z
      .string()
      .optional()
      .describe('Absence, uncertainty or same-server follow-up guidance.'),
    nativePage: z
      .number()
      .int()
      .optional()
      .describe('Actual requested source voting page, starting at one.'),
    nativePageSize: z
      .number()
      .int()
      .optional()
      .describe('Native voting page size, independent of caller limit.'),
  }),
  enrichment: {
    applied: AppliedSchema.describe('Normalized selectors, source and effective workload.'),
    notice: z.string().describe('Licence, coverage and workload notices.'),
    requestedLimit: z
      .number()
      .int()
      .optional()
      .describe('Caller limit when a cap or native-page rule applies.'),
    truncated: z.boolean().optional().describe('Further whole collection items remain.'),
    shown: z
      .number()
      .int()
      .optional()
      .describe('Actual whole items emitted in this collection page.'),
    cap: z.number().int().optional().describe('Effective whole-item workload cap.'),
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
      recovery: 'Wait briefly, then repeat ukparl_get_member with the same selectors.',
      retryable: false,
    },
    {
      reason: 'http_invalid_params',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'The official API returned HTTP 400 for this request.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_get_member with valid arguments.',
      retryable: false,
    },
    {
      reason: 'http_unauthorized',
      code: JsonRpcErrorCode.Unauthorized,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 401.',
      recovery:
        'Repeat ukparl_get_member later; if HTTP 401 persists, report the unavailable public API access.',
      retryable: false,
    },
    {
      reason: 'http_forbidden',
      code: JsonRpcErrorCode.Forbidden,
      thrownBy: 'service',
      when: 'The official public API returned HTTP 402 or 403.',
      recovery:
        'Repeat ukparl_get_member later; if access remains forbidden, report the blocked public API request.',
      retryable: false,
    },
    {
      reason: 'http_conflict',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'The official API returned HTTP 409, 423 or 424.',
      recovery:
        'Restart ukparl_get_member with the original selection and no cursor or contentCursor after the source conflict clears.',
      retryable: false,
    },
    {
      reason: 'http_rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      thrownBy: 'service',
      when: 'The official API returned HTTP 429 after bounded retry handling.',
      recovery:
        'Wait for the returned retryAfter interval, then repeat ukparl_get_member with the same selection.',
      retryable: true,
    },
    {
      reason: 'http_invalid_request',
      code: JsonRpcErrorCode.InvalidRequest,
      thrownBy: 'service',
      when: 'The official API returned an unexpected redirect or another unsupported HTTP client response.',
      recovery:
        'Check the selected identifiers and filters, then repeat ukparl_get_member; report a persistent redirect or unsupported response.',
      retryable: false,
    },
    {
      reason: 'invalid_mode_arguments',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A section lacks its House or uses incompatible category, House or collection cursor fields.',
      recovery:
        'Repeat ukparl_get_member with house for interests or voting, category only for roles, and no collection cursor for profile or the role-category outline.',
    },
    {
      reason: 'invalid_cursor',
      code: JsonRpcErrorCode.InvalidParams,
      thrownBy: 'service',
      when: 'A collection or content cursor is malformed or belongs to another selection.',
      recovery:
        'Repeat ukparl_get_member with the same memberId, section, category and house and no cursor or contentCursor to restart.',
    },
    {
      reason: 'source_changed',
      code: JsonRpcErrorCode.Conflict,
      thrownBy: 'service',
      when: 'Selected source data changed during recursive content retrieval.',
      recovery:
        'Repeat ukparl_get_member with original selectors and no contentCursor, then follow the new content cursors.',
    },
  ],
  async handler(input, ctx) {
    const voting = input.section === 'voting';
    const limit = voting ? 20 : Math.min(input.limit, 50);
    const source = input.section === 'committee_seats' ? 'committees' : 'members';
    const applied = {
      memberId: input.memberId,
      section: input.section,
      category: input.category,
      house: input.house,
      limit,
      source,
    };
    const notice = `${LICENCE_NOTICE}${voting ? ' Voting history preserves recorded lobby and teller facts. Native page size is 20; caller limit does not change the upstream page.' : input.section === 'interests' ? ' Registered interests reflect the selected source; historical register completeness is not guaranteed.' : input.section === 'contact' ? ' Published official contacts retain source descriptions and caveats; personal data is excluded from the Open Parliament Licence.' : ''}${!voting && input.limit > 50 ? ` Requested limit ${input.limit} is capped at 50.` : ''}`;
    const changedLimit = voting || input.limit > 50;
    const enrichment = {
      applied,
      notice,
      ...(changedLimit ? { requestedLimit: input.limit } : {}),
    };
    ctx.enrich(enrichment);
    const needsHouse = input.section === 'interests' || voting;
    const collection =
      input.section !== 'profile' && !(input.section === 'roles' && !input.category);
    if (
      (needsHouse && !input.house) ||
      (!needsHouse && input.house) ||
      (input.category && input.section !== 'roles') ||
      (!collection && input.cursor)
    )
      throw ctx.fail('invalid_mode_arguments', 'Use selectors supported by this member section.');
    const selection = {
      memberId: input.memberId,
      section: input.section,
      category: input.category,
      house: input.house,
      limit,
      cursor: input.cursor,
    };
    const filters = { memberId: input.memberId, category: input.category, house: input.house };
    const parsed = readCollectionCursor(input.cursor, {
      source,
      selector: input.section,
      filters,
      nativePageSize: limit,
    });
    const cursor = voting
      ? {
          ...parsed,
          nativePage: Math.floor(parsed.offset / 20) + 1,
          intraPageOffset: parsed.offset % 20,
        }
      : parsed;
    using call = getParliamentHttp().beginCall(ctx);
    const service = getMembers();
    const profile = await service.profile(call, input.memberId);
    let payload: Payload = {
      found: false,
      memberId: input.memberId,
      section: input.section,
      guidance:
        'No member was returned. Resolve the identifier with ukparl_search_members and repeat ukparl_get_member.',
    };
    let rows: z.infer<typeof ItemSchema>[] | undefined;
    let total: number | undefined;
    let availableRowCount: number | undefined;
    if (profile?.data.value) {
      payload = {
        found: true,
        memberId: input.memberId,
        section: input.section,
        source: profile.source,
      };
      if (input.section === 'profile')
        payload.record = { kind: 'profile', value: profile.data.value, links: profile.data.links };
      else if (input.section === 'roles') {
        const result = await service.biography(call, input.memberId);
        payload.source = result.source;
        payload.links = result.data.links;
        if (!result.data.value)
          payload.guidance =
            'The Members API supplied no biography value; no empty history is inferred.';
        else if (!input.category)
          payload.record = {
            kind: 'role_categories',
            categories: BiographyCategorySchema.options.map((category) => ({
              category,
              available: result.data.value?.[category] != null,
              count: result.data.value?.[category]?.length ?? null,
            })),
          };
        else {
          const values = result.data.value[input.category];
          if (values == null)
            payload.guidance =
              'The source did not supply this biography category; its history is unknown.';
          else {
            total = values.length;
            rows = values
              .slice(cursor.offset, cursor.offset + limit)
              .map((value) => ({ kind: 'role', value }));
          }
        }
      } else if (input.section === 'contact') {
        const result = await service.contacts(call, input.memberId);
        payload.source = result.source;
        payload.links = result.data.links;
        if (result.data.value == null)
          payload.guidance =
            'The source supplied no contact collection; no contact details are inferred.';
        else {
          total = result.data.value.length;
          rows = result.data.value
            .slice(cursor.offset, cursor.offset + limit)
            .map((value) => ({ kind: 'contact', value }));
        }
      } else if (input.section === 'interests' && input.house) {
        const result = await service.interests(call, input.memberId, input.house);
        payload.source = result.source;
        payload.links = result.data.links;
        if (result.data.value == null)
          payload.guidance =
            'The source supplied no interest collection; absence of declarations is not inferred.';
        else {
          total = result.data.value.length;
          rows = result.data.value
            .slice(cursor.offset, cursor.offset + limit)
            .map((value) => ({ kind: 'interest_category', value: flattenInterestCategory(value) }));
        }
      } else if (voting && input.house) {
        const nativePage = Math.floor(cursor.offset / 20) + 1;
        const result = await service.voting(call, input.memberId, input.house, nativePage);
        payload.source = result.source;
        payload.links = result.data.links;
        payload.nativePage = nativePage;
        payload.nativePageSize = 20;
        payload.guidance =
          'Use divisionId with this explicit House in ukparl_search_divisions mode=detail or voters. Neither lobby flag alone establishes abstention.';
        total = result.data.totalResults;
        rows = (result.data.items ?? []).slice(cursor.offset % 20).map((item) => {
          if (!item.value) throw validationError('Members voting supplied a null vote record.');
          return {
            kind: 'vote',
            divisionId: String(item.value.id),
            value: item.value,
            links: item.links,
          };
        });
        if (rows.length === 0 && cursor.offset < total)
          throw validationError(
            'Members voting supplied no records before its reported collection end.',
          );
      } else if (input.section === 'committee_seats') {
        const result = await service.committeeSeats(call, input.memberId);
        payload.source = result.source;
        if (
          result.data.some(
            (member) => member.memberInfo && member.memberInfo.mnisId !== Number(input.memberId),
          )
        )
          throw validationError(
            'Committee memberships supplied an inconsistent MNIS member identifier.',
          );
        payload.membershipContexts = result.data.map(({ committees, ...member }) => ({
          ...member,
          committeesState:
            committees === undefined ? 'missing' : committees === null ? 'null' : 'present',
        }));
        const seats = result.data.flatMap(({ committees, ...member }) =>
          (committees ?? []).map((value) => ({
            kind: 'committee_seat' as const,
            committeeId: String(value.id),
            ...flattenCommitteeSeat(value),
            member,
          })),
        );
        availableRowCount = seats.length;
        if (result.data.every((member) => member.committees != null)) total = seats.length;
        rows = seats.slice(cursor.offset, cursor.offset + limit);
        payload.guidance = `All website-visible current and former committee memberships were requested. member.memberInfo.mnisId is the member join key; personId is source-specific.${total === undefined ? ' A source membership collection was unavailable; its seat count is unknown.' : ''}`;
      }
    }
    const collectionLength = availableRowCount ?? total;
    const repage = (count: number): Payload => ({
      ...payload,
      ...(total !== undefined ? { totalCount: total } : {}),
      ...(rows
        ? {
            items: rows.slice(0, count),
            page: {
              returned: count,
              ...(total !== undefined ? { total } : {}),
              hasMore: collectionLength !== undefined && cursor.offset + count < collectionLength,
              ...(collectionLength !== undefined && cursor.offset + count < collectionLength
                ? { nextCursor: advanceCollectionCursor(cursor, count) }
                : {}),
            },
          }
        : {}),
    });
    return deliverPayload(repage(rows?.length ?? 0), {
      tool: 'ukparl_get_member',
      selection,
      contentCursor: input.contentCursor,
      ...(rows ? { collection: { count: rows.length, repage } } : {}),
      enrichmentFor: (selected) => ({
        ...enrichment,
        ...(selected.page
          ? {
              truncated: selected.page.hasMore,
              shown: selected.page.returned,
              cap: limit,
              notice: `${notice}${selected.page.returned === 0 ? ' The selected source collection returned no rows.' : ''}`,
            }
          : {}),
      }),
      applyEnrichment: (values) => ctx.enrich(values),
      retained: (selected) => ({
        ...(selected.source ? { source: selected.source } : {}),
        identity: { memberId: input.memberId },
        ...(selected.page ? { page: selected.page } : {}),
      }),
    });
  },
  format: (result) => formatData(result),
});
