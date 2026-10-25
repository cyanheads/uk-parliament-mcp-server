/**
 * @fileoverview Validated Members API records and committee membership relationships.
 * @module services/members/member-models
 */
import { z } from '@cyanheads/mcp-ts-core';

const text = z
  .string()
  .nullish()
  .describe('Published source text; null or omitted means unavailable.');
const integer = z
  .number()
  .int()
  .nullish()
  .describe('Published integer; null or omitted means unavailable.');
const flag = z.boolean().nullish().describe('Published flag; null or omitted is unknown.');
const sourceId = z.number().int().describe('Identifier within this source record namespace.');
const chamber = z
  .union([
    z.number().int().describe('Source numeric House code; Members uses 1 Commons and 2 Lords.'),
    z.string().describe('Source chamber label, including source-specific values.'),
    z.null().describe('Source supplied no House.'),
  ])
  .optional()
  .describe('Source House; never inferred from another membership.');
/** Source link metadata; relative hrefs remain source values, never request targets. */
export const MemberLinkSchema = z
  .object({ rel: text, href: text, method: text })
  .describe('Published relationship link; href may be relative.');
/** Complete published party metadata, including sparse historical values. */
export const PartySchema = z
  .object({
    id: sourceId,
    name: text,
    abbreviation: text,
    backgroundColour: text,
    foregroundColour: text,
    isLordsMainParty: flag,
    isLordsSpiritualParty: flag,
    governmentType: integer,
    isIndependentParty: flag,
  })
  .describe('Published party metadata.');
const StatusSchema = z
  .object({
    statusIsActive: flag,
    statusDescription: text,
    statusNotes: text,
    statusId: integer,
    status: integer,
    statusStartDate: text,
  })
  .describe('Published membership status and its effective date.');
/** Member profile; latest membership is not asserted to describe a historical date. */
export const MemberSchema = z
  .object({
    id: sourceId,
    nameListAs: text,
    nameDisplayAs: text,
    nameFullTitle: text,
    nameAddressAs: text,
    latestParty: PartySchema.nullish().describe(
      'Latest source party, possibly unknown in historical results.',
    ),
    gender: text,
    latestHouseMembership: z
      .object({
        membershipFrom: text,
        membershipFromId: integer,
        house: chamber,
        membershipStartDate: text,
        membershipEndDate: text,
        membershipEndReason: text,
        membershipEndReasonNotes: text,
        membershipEndReasonId: integer,
        membershipStatus: StatusSchema.nullish().describe('Latest source membership status.'),
      })
      .nullish()
      .describe('Latest source membership, not a guaranteed as-of snapshot.'),
    thumbnailUrl: text,
  })
  .describe('Complete published member metadata.');
/** One whole biography period, retaining representation-specific constituency dates. */
export const BiographyPeriodSchema = z
  .object({
    house: chamber,
    name: text,
    id: sourceId,
    startDate: text,
    endDate: text,
    additionalInfo: text,
    additionalInfoLink: text,
    constituencyStart: text,
    constituencyEnd: text,
  })
  .describe('Whole biography period, dates and additional links.');
/** Supported biography collections. */
export const BiographyCategorySchema = z
  .enum([
    'representations',
    'electionsContested',
    'houseMemberships',
    'governmentPosts',
    'oppositionPosts',
    'otherPosts',
    'partyAffiliations',
    'committeeMemberships',
  ])
  .describe('Biography category name.');
/** Biography categories remain null/absent when upstream supplies no collection. */
export const BiographySchema = z
  .object({
    representations: z
      .array(BiographyPeriodSchema)
      .nullish()
      .describe('Published representations.'),
    electionsContested: z
      .array(BiographyPeriodSchema)
      .nullish()
      .describe('Published contested elections.'),
    houseMemberships: z
      .array(BiographyPeriodSchema)
      .nullish()
      .describe('Published House memberships.'),
    governmentPosts: z
      .array(BiographyPeriodSchema)
      .nullish()
      .describe('Published government posts.'),
    oppositionPosts: z
      .array(BiographyPeriodSchema)
      .nullish()
      .describe('Published opposition posts.'),
    otherPosts: z.array(BiographyPeriodSchema).nullish().describe('Published other posts.'),
    partyAffiliations: z
      .array(BiographyPeriodSchema)
      .nullish()
      .describe('Published party affiliations.'),
    committeeMemberships: z
      .array(BiographyPeriodSchema)
      .nullish()
      .describe('Published biography committee memberships.'),
  })
  .describe('Whole biography grouped by source category.');
/** Published contact record, including complete official descriptions and caveats. */
export const ContactSchema = z
  .object({
    type: text,
    typeDescription: text,
    typeId: integer,
    isPreferred: flag,
    isWebAddress: flag,
    notes: text,
    line1: text,
    line2: text,
    line3: text,
    line4: text,
    line5: text,
    postcode: text,
    phone: text,
    fax: text,
    email: text,
    website: text,
  })
  .describe('Official contact record including complete source notes and caveats.');
/** Recursive declarations stay attached to the parent interest. */
export const InterestSchema = z
  .object({
    id: sourceId,
    interest: text,
    createdWhen: text,
    lastAmendedWhen: text,
    deletedWhen: text,
    isCorrection: flag,
    get childInterests() {
      return z
        .array(InterestSchema)
        .nullish()
        .describe('Complete recursive child declarations attached to this interest.');
    },
  })
  .describe('One whole registered interest and its recursive children.');
/** Whole registered-interest category is the pagination atom. */
export const InterestCategorySchema = z
  .object({
    id: sourceId,
    name: text,
    sortOrder: integer,
    interests: z
      .array(InterestSchema)
      .nullish()
      .describe('Whole declarations within this category.'),
  })
  .describe('One complete registered-interest category.');
/** Recorded vote facts; absence from a lobby does not establish abstention. */
export const VoteSchema = z
  .object({
    house: chamber,
    id: sourceId,
    inAffirmativeLobby: flag,
    inNegativeLobby: flag,
    actedAsTeller: flag,
    title: text,
    date: text,
    divisionNumber: integer,
    numberInFavour: integer,
    numberAgainst: integer,
  })
  .describe('Recorded division and member lobby/teller facts.');
/** Wrapper used by singular and unpaged Members API routes. */
export function memberValueSchema<T extends z.ZodType>(value: T) {
  return z.object({
    value: value.nullish().describe('Selected source value; null means unavailable.'),
    links: z.array(MemberLinkSchema).nullish().describe('Published source relationships.'),
  });
}
/** Search wrapper; native vote skip metadata must not control continuation. */
export function memberSearchSchema<T extends z.ZodType>(value: T) {
  return z.object({
    items: z.array(memberValueSchema(value)).nullish().describe('Whole source result wrappers.'),
    totalResults: z
      .number()
      .int()
      .nonnegative()
      .describe('Reported source total; unpaged active-party totals require collection length.'),
    skip: integer,
    take: integer,
    resultContext: text,
    links: z
      .array(MemberLinkSchema)
      .nullish()
      .describe('Published relationships; never followed as request targets.'),
  });
}
const NamedSchema = z.object({ id: sourceId, name: text }).describe('Named source identifier.');
const CommitteeRoleSchema = z
  .object({
    startDate: text,
    endDate: text,
    role: NamedSchema.extend({
      roleType: NamedSchema.nullish().describe('Published role type.'),
      isChair: flag,
    })
      .nullish()
      .describe('Published role metadata.'),
    exOfficio: flag,
    alternate: flag,
    coOpted: flag,
  })
  .describe('Whole committee role period and role flags.');
const CommitteeSummarySchema = z
  .object({
    id: sourceId,
    name: text,
    house: chamber,
    startDate: text,
    endDate: text,
    contact: z
      .object({ email: text, phone: text, address: text, contactDisclaimer: text })
      .nullish()
      .describe('Committee contacts including complete source disclaimer.'),
    get parentCommittee() {
      return CommitteeSummarySchema.nullish().describe('Published parent committee metadata.');
    },
    get subCommittees() {
      return z.array(CommitteeSummarySchema).nullish().describe('Published subcommittee metadata.');
    },
    leadHouse: z
      .object({ isCommons: flag, isLords: flag })
      .nullish()
      .describe('Source lead-House flags; Joint remains distinct.'),
    category: NamedSchema.nullish().describe('Published committee category.'),
    committeeTypes: z
      .array(
        NamedSchema.extend({
          committeeCategory: NamedSchema.nullish().describe('Published type category.'),
        }).describe('Published committee type.'),
      )
      .nullish()
      .describe('All published committee types.'),
    showOnWebsite: flag,
    websiteLegacyUrl: text,
    websiteLegacyRedirectEnabled: flag,
    dateCommonsAppointed: text,
    dateLordsAppointed: text,
    scrutinisingDepartments: z
      .array(
        z
          .object({ departmentId: sourceId, name: text })
          .describe('Department scrutinised by this committee.'),
      )
      .nullish()
      .describe('All published scrutinised departments.'),
    isLeadCommittee: flag,
    nameHistory: z
      .array(
        z
          .object({ id: integer, committeeId: integer, name: text, startDate: text, endDate: text })
          .describe('Dated committee name.'),
      )
      .nullish()
      .describe('Complete published committee name history.'),
  })
  .describe('Complete committee metadata and relationships.');
/** Complete committee seat periods with committee metadata. */
export const CommitteeSeatSchema = CommitteeSummarySchema.extend({
  roles: z
    .array(CommitteeRoleSchema)
    .nullish()
    .describe('Whole member role periods on this committee.'),
}).describe('Whole committee seat and its role periods.');
/** Source person identity is distinct from the MNIS member join key. */
export const CommitteeMemberSchema = z
  .object({
    id: sourceId,
    personId: integer,
    name: text,
    photoUrl: text,
    memberInfo: z
      .object({
        memberFrom: text,
        party: text,
        partyColour: text,
        mnisId: sourceId,
        isChair: flag,
        listAs: text,
        displayAs: text,
        fullTitle: text,
        addressAs: text,
        house: chamber,
        isCurrent: flag,
      })
      .nullish()
      .describe('Member metadata; mnisId is the Members API join key.'),
    committees: z
      .array(CommitteeSeatSchema)
      .nullish()
      .describe('Whole source committee memberships.'),
  })
  .describe('Committee source person metadata and Members API join key.');
/** Complete department reference metadata. */
export const DepartmentSchema = NamedSchema.extend({ url: text, imageUrl: text }).describe(
  'Complete published department metadata.',
);
/** Answering bodies may have no associated government department. */
export const AnsweringBodySchema = NamedSchema.extend({
  shortName: text,
  target: text,
  department: DepartmentSchema.nullish().describe('Associated department; null is meaningful.'),
}).describe('Complete published answering body metadata.');
