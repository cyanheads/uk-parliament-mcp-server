/**
 * @fileoverview Explicit Committees API schemas and lossless typed source-path normalization.
 * @module services/committees/committee-models
 */
import { z } from '@cyanheads/mcp-ts-core';

interface CommitteeDetailsRaw {
  banner?: BannerRaw | null | undefined;
  category?: CommitteeCategoryRaw | null | undefined;
  committeeTypes?: CommitteeTypeRaw[] | null | undefined;
  contact?: ContactInformationRaw | null | undefined;
  contentLinks?: ContentLinkRaw[] | null | undefined;
  dateCommonsAppointed?: string | null | undefined;
  dateLordsAppointed?: string | null | undefined;
  endDate?: string | null | undefined;
  house?: HouseRaw | null | undefined;
  id: number;
  isLeadCommittee?: boolean | null | undefined;
  leadHouse?: LeadHouseRaw | null | undefined;
  name?: string | null | undefined;
  nameHistory?: CommitteeNameRaw[] | null | undefined;
  parentCommittee?: CommitteeSummaryRaw | null | undefined;
  previousCommittees?: CommitteeSummaryRaw[] | null | undefined;
  purpose?: string | null | undefined;
  scrutinisingDepartments?: ScrutinisingDepartmentRaw[] | null | undefined;
  showOnWebsite?: boolean | null | undefined;
  startDate?: string | null | undefined;
  subCommittees?: CommitteeSummaryRaw[] | null | undefined;
  websiteLegacyRedirectEnabled?: boolean | null | undefined;
  websiteLegacyUrl?: string | null | undefined;
}
interface CommitteeMemberRaw {
  id: number;
  isLayMember?: boolean | null | undefined;
  memberInfo?: MemberInfoRaw | null | undefined;
  name?: string | null | undefined;
  personId?: number | null | undefined;
  photoUrl?: string | null | undefined;
  roles?: CommitteeMemberRoleRaw[] | null | undefined;
}
interface CommitteeBusinessDetailsRaw {
  banner?: BannerRaw | null | undefined;
  closeDate?: string | null | undefined;
  closedSubmissionPeriods?: SubmissionPeriodSummaryRaw[] | null | undefined;
  contact?: ContactInformationRaw | null | undefined;
  hcNumbers?: HouseNumberRaw[] | null | undefined;
  id: number;
  latestReport?: PublicationSummaryRaw | null | undefined;
  nextOralEvidenceSession?: ActivitySummaryRaw | null | undefined;
  openDate?: string | null | undefined;
  openSubmissionPeriods?: SubmissionPeriodSummaryRaw[] | null | undefined;
  relatedInformation?: LinksRaw[] | null | undefined;
  scope?: string | null | undefined;
  title?: string | null | undefined;
  type?: CommitteeBusinessTypeRaw | null | undefined;
}
interface PublicationRaw {
  additionalContentUrl?: string | null | undefined;
  additionalContentUrl2?: string | null | undefined;
  businesses?: CommitteeBusinessSummaryRaw[] | null | undefined;
  committee?: CommitteeSummaryRaw | null | undefined;
  description?: string | null | undefined;
  documents?: DocumentRaw[] | null | undefined;
  governmentResponses?: GovernmentResponseRaw | null | undefined;
  hcNumber?: HouseNumberRaw | null | undefined;
  hlPaper?: HouseNumberRaw | null | undefined;
  id: number;
  publicationEndDate?: string | null | undefined;
  publicationStartDate?: string | null | undefined;
  respondingDepartment?: DepartmentRaw | null | undefined;
  responseToPublicationId?: number | null | undefined;
  type?: PublicationTypeRaw | null | undefined;
}
interface ContactInformationRaw {
  address?: string | null | undefined;
  contactDisclaimer?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
}
interface CommitteeSummaryRaw {
  category?: CommitteeCategoryRaw | null | undefined;
  committeeTypes?: CommitteeTypeRaw[] | null | undefined;
  contact?: ContactInformationRaw | null | undefined;
  dateCommonsAppointed?: string | null | undefined;
  dateLordsAppointed?: string | null | undefined;
  endDate?: string | null | undefined;
  house?: HouseRaw | null | undefined;
  id: number;
  isLeadCommittee?: boolean | null | undefined;
  leadHouse?: LeadHouseRaw | null | undefined;
  name?: string | null | undefined;
  nameHistory?: CommitteeNameRaw[] | null | undefined;
  parentCommittee?: CommitteeSummaryRaw | null | undefined;
  scrutinisingDepartments?: ScrutinisingDepartmentRaw[] | null | undefined;
  showOnWebsite?: boolean | null | undefined;
  startDate?: string | null | undefined;
  subCommittees?: CommitteeSummaryRaw[] | null | undefined;
  websiteLegacyRedirectEnabled?: boolean | null | undefined;
  websiteLegacyUrl?: string | null | undefined;
}
type HouseRaw = string;
const HouseRawSchema = z.string();
interface LeadHouseRaw {
  isCommons?: boolean | null | undefined;
  isLords?: boolean | null | undefined;
}
interface CommitteeCategoryRaw {
  id: number;
  name?: string | null | undefined;
}
interface CommitteeTypeRaw {
  committeeCategory?: CommitteeCategoryRaw | null | undefined;
  id: number;
  name?: string | null | undefined;
}
interface ScrutinisingDepartmentRaw {
  departmentId?: number | null | undefined;
  name?: string | null | undefined;
}
interface CommitteeNameRaw {
  committeeId?: number | null | undefined;
  endDate?: string | null | undefined;
  id: number;
  name?: string | null | undefined;
  startDate?: string | null | undefined;
}
interface BannerRaw {
  desktopBanner?: FileRaw | null | undefined;
  mobileBanner?: FileRaw | null | undefined;
}
interface ContentLinkRaw {
  description?: string | null | undefined;
  displayOrder?: number | null | undefined;
  title?: string | null | undefined;
  url?: string | null | undefined;
}
interface MemberInfoRaw {
  addressAs?: string | null | undefined;
  displayAs?: string | null | undefined;
  fullTitle?: string | null | undefined;
  house?: HouseRaw | null | undefined;
  isChair?: boolean | null | undefined;
  isCurrent?: boolean | null | undefined;
  listAs?: string | null | undefined;
  memberFrom?: string | null | undefined;
  mnisId: number;
  party?: string | null | undefined;
  partyColour?: string | null | undefined;
}
interface CommitteeMemberRoleRaw {
  alternate?: boolean | null | undefined;
  coOpted?: boolean | null | undefined;
  endDate?: string | null | undefined;
  exOfficio?: boolean | null | undefined;
  role?: RoleRaw | null | undefined;
  startDate?: string | null | undefined;
}
interface CommitteeBusinessTypeRaw {
  description?: string | null | undefined;
  id: number;
  isInquiry?: boolean | null | undefined;
  name?: string | null | undefined;
}
interface PublicationSummaryRaw {
  additionalContentUrl?: string | null | undefined;
  additionalContentUrl2?: string | null | undefined;
  description?: string | null | undefined;
  documents?: DocumentRaw[] | null | undefined;
  governmentResponses?: GovernmentResponseRaw | null | undefined;
  hcNumber?: HouseNumberRaw | null | undefined;
  hlPaper?: HouseNumberRaw | null | undefined;
  id: number;
  publicationEndDate?: string | null | undefined;
  publicationStartDate?: string | null | undefined;
  respondingDepartment?: DepartmentRaw | null | undefined;
  responseToPublicationId?: number | null | undefined;
  type?: PublicationTypeRaw | null | undefined;
}
interface SubmissionPeriodSummaryRaw {
  allowSubmissionsPastEndDate?: boolean | null | undefined;
  endDate?: string | null | undefined;
  id: number;
  isPromoted?: boolean | null | undefined;
  startDate?: string | null | undefined;
  statusMessage?: string | null | undefined;
  submissionType?: SubmissionTypeRaw | null | undefined;
}
interface ActivitySummaryRaw {
  activityType?: string | null | undefined;
  attendees?: ActivityPersonRaw[] | null | undefined;
  endDate?: string | null | undefined;
  eventId?: number | null | undefined;
  id: number;
  isPrivate?: boolean | null | undefined;
  name?: string | null | undefined;
  startDate?: string | null | undefined;
}
interface LinksRaw {
  description?: string | null | undefined;
  url?: string | null | undefined;
}
interface HouseNumberRaw {
  number?: string | null | undefined;
  sessionDescription?: string | null | undefined;
  sessionId?: number | null | undefined;
}
interface GovernmentResponseRaw {
  publication?: PublicationSummaryRaw[] | null | undefined;
  responseDeadline?: string | null | undefined;
  responseExcepted?: boolean | null | undefined;
}
interface DocumentRaw {
  documentId: number;
  files?: DocumentFileRaw[] | null | undefined;
}
interface PublicationTypeRaw {
  canBeResponse?: boolean | null | undefined;
  description?: string | null | undefined;
  governmentCanRespond?: boolean | null | undefined;
  iconKey?: string | null | undefined;
  id: number;
  name?: string | null | undefined;
  pluralVersion?: string | null | undefined;
}
interface DepartmentRaw {
  address?: AddressRaw | null | undefined;
  email?: string | null | undefined;
  id: number;
  name?: string | null | undefined;
  otherAddress?: string | null | undefined;
  phone?: string | null | undefined;
  url?: string | null | undefined;
}
interface CommitteeBusinessSummaryRaw {
  closeDate?: string | null | undefined;
  closedSubmissionPeriods?: SubmissionPeriodSummaryRaw[] | null | undefined;
  contact?: ContactInformationRaw | null | undefined;
  id: number;
  latestReport?: PublicationSummaryRaw | null | undefined;
  nextOralEvidenceSession?: ActivitySummaryRaw | null | undefined;
  openDate?: string | null | undefined;
  openSubmissionPeriods?: SubmissionPeriodSummaryRaw[] | null | undefined;
  title?: string | null | undefined;
  type?: CommitteeBusinessTypeRaw | null | undefined;
}
interface FileRaw {
  fileData?: string | null | undefined;
  fileName?: string | null | undefined;
}
interface RoleRaw {
  id: number;
  isChair?: boolean | null | undefined;
  name?: string | null | undefined;
  roleType?: RoleTypeRaw | null | undefined;
}
type SubmissionTypeRaw = string;
const SubmissionTypeRawSchema = z.string();
interface ActivityPersonRaw {
  additionalContext?: string | null | undefined;
  displayOrder?: number | null | undefined;
  id: number;
  memberInfo?: MemberInfoRaw | null | undefined;
  name?: string | null | undefined;
  organisations?: OrganisationRaw[] | null | undefined;
  personId?: number | null | undefined;
  photoUrl?: string | null | undefined;
  submitterType?: SubmitterTypeRaw | null | undefined;
}
interface DocumentFileRaw {
  documentPurpose?: DocumentPurposeRaw | null | undefined;
  fileDataFormat?: FileDataFormatRaw | null | undefined;
  fileName?: string | null | undefined;
  fileSize?: number | null | undefined;
  format?: string | null | undefined;
  url?: string | null | undefined;
}
interface AddressRaw {
  addressLine1?: string | null | undefined;
  addressLine2?: string | null | undefined;
  addressLine3?: string | null | undefined;
  addressLine4?: string | null | undefined;
  addressLine5?: string | null | undefined;
  postcode?: string | null | undefined;
}
interface RoleTypeRaw {
  id: number;
  name?: string | null | undefined;
}
interface OrganisationRaw {
  cisId?: number | null | undefined;
  idmsId?: string | null | undefined;
  name?: string | null | undefined;
  role?: string | null | undefined;
}
type SubmitterTypeRaw = string;
const SubmitterTypeRawSchema = z.string();
type FileDataFormatRaw = string;
const FileDataFormatRawSchema = z.string();
/** Measured on evidence 165562: 14,454 on its docx, Pdf and Html entries; the Html rendition is 21,953 bytes. */
const FILE_SIZE_DESCRIPTION =
  "Source-reported size in bytes of the uploaded original, repeated on each rendition of the same document, so it can differ from a Pdf or Html rendition's own size; null when unknown.";
interface DocumentPurposeRaw {
  description?: string | null | undefined;
  id: number;
  label?: string | null | undefined;
  name?: string | null | undefined;
  sortOrder?: number | null | undefined;
}
/** Complete CommitteeDetails source metadata; undocumented extra fields are ignored. */
export const CommitteeDetailsRawSchema: z.ZodType<CommitteeDetailsRaw> = z.lazy(() =>
  z.object({
    contact: ContactInformationRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    id: z.number().int().describe('The ID of the committee.'),
    name: z.string().nullish().describe('The current name of the committee.'),
    parentCommittee: CommitteeSummaryRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    subCommittees: z
      .array(CommitteeSummaryRawSchema)
      .nullish()
      .describe('Sub-committees of this committee.'),
    house: HouseRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    leadHouse: LeadHouseRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    category: CommitteeCategoryRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    committeeTypes: z.array(CommitteeTypeRawSchema).nullish().describe('List of Committee types.'),
    showOnWebsite: z
      .boolean()
      .nullish()
      .describe('Indicates whether this committee should be shown on the website.'),
    websiteLegacyUrl: z
      .string()
      .nullish()
      .describe('The legacy website URL for the committee, if one exists.'),
    websiteLegacyRedirectEnabled: z
      .boolean()
      .nullish()
      .describe(
        'Indicates whether automatic redirect to the legacy website has been enabled for the committee.',
      ),
    startDate: z.string().nullish().describe('The start date of the committee.'),
    endDate: z.string().nullish().describe('The end date of the committee.'),
    dateCommonsAppointed: z
      .string()
      .nullish()
      .describe('The date the committee was appointed by the House of Commons.'),
    dateLordsAppointed: z
      .string()
      .nullish()
      .describe('The date the committee was appointed by the House of Lords.'),
    scrutinisingDepartments: z
      .array(ScrutinisingDepartmentRawSchema)
      .nullish()
      .describe('All the departments the committee scrutinizes.'),
    isLeadCommittee: z
      .boolean()
      .nullish()
      .describe(
        'Indicates whether this is the lead committee, if linked to an event with multiple committees.',
      ),
    nameHistory: z
      .array(CommitteeNameRawSchema)
      .nullish()
      .describe('Previous names of this committee.'),
    banner: BannerRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    contentLinks: z
      .array(ContentLinkRawSchema)
      .nullish()
      .describe('Gets or sets the social media accounts of this committee.'),
    purpose: z.string().nullish().describe('Gets or sets the purpose of the committee.'),
    previousCommittees: z
      .array(CommitteeSummaryRawSchema)
      .nullish()
      .describe('Gets or sets the previous committees associated with this committee.'),
  }),
);
/** Complete CommitteeMember source metadata; undocumented extra fields are ignored. */
export const CommitteeMemberRawSchema: z.ZodType<CommitteeMemberRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('Gets or sets the unique identifier for the person.'),
    personId: z.number().int().nullish().describe('Gets or sets the optional person ID.'),
    name: z.string().nullish().describe('Gets or sets the name of the person.'),
    photoUrl: z.string().nullish().describe("Gets or sets the URL of the person's photo."),
    memberInfo: MemberInfoRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    isLayMember: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the member is a lay member.'),
    roles: z
      .array(CommitteeMemberRoleRawSchema)
      .nullish()
      .describe('Gets or sets the roles assigned to the committee member.'),
  }),
);
/** Complete CommitteeBusinessDetails source metadata; undocumented extra fields are ignored. */
export const CommitteeBusinessDetailsRawSchema: z.ZodType<CommitteeBusinessDetailsRaw> = z.lazy(
  () =>
    z.object({
      id: z.number().int().describe('Id of committee business.'),
      title: z.string().nullish().describe('Title of committee business.'),
      type: CommitteeBusinessTypeRawSchema.nullish().describe(
        'Published source value; null or omission preserves absence.',
      ),
      openDate: z.string().nullish().describe('Date the business started.'),
      closeDate: z.string().nullish().describe('Date the business ended.'),
      latestReport: PublicationSummaryRawSchema.nullish().describe(
        'Published source value; null or omission preserves absence.',
      ),
      openSubmissionPeriods: z
        .array(SubmissionPeriodSummaryRawSchema)
        .nullish()
        .describe('Currently open submission periods.'),
      closedSubmissionPeriods: z
        .array(SubmissionPeriodSummaryRawSchema)
        .nullish()
        .describe('Closed submission periods.'),
      nextOralEvidenceSession: ActivitySummaryRawSchema.nullish().describe(
        'Published source value; null or omission preserves absence.',
      ),
      contact: ContactInformationRawSchema.nullish().describe(
        'Published source value; null or omission preserves absence.',
      ),
      scope: z.string().nullish().describe('Gets or sets the scope of the committee business.'),
      relatedInformation: z
        .array(LinksRawSchema)
        .nullish()
        .describe('Gets or sets related information for the committee business.'),
      banner: BannerRawSchema.nullish().describe(
        'Published source value; null or omission preserves absence.',
      ),
      hcNumbers: z
        .array(HouseNumberRawSchema)
        .nullish()
        .describe('Gets or sets the HC Numbers for the committee business.'),
    }),
);
/** Complete Publication source metadata; undocumented extra fields are ignored. */
export const PublicationRawSchema: z.ZodType<PublicationRaw> = z.lazy(() =>
  z.object({
    description: z.string().nullish().describe('Description of publication.'),
    id: z.number().int().describe('The ID of the publication.'),
    publicationStartDate: z
      .string()
      .nullish()
      .describe('Date when publication can be published from.'),
    governmentResponses: GovernmentResponseRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    publicationEndDate: z
      .string()
      .nullish()
      .describe('Date when publication can be published until.'),
    documents: z
      .array(DocumentRawSchema)
      .nullish()
      .describe('Documents associated with the publication.'),
    hcNumber: HouseNumberRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    hlPaper: HouseNumberRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    type: PublicationTypeRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    responseToPublicationId: z
      .number()
      .int()
      .nullish()
      .describe("If publication is in response to another publication, that publication's ID."),
    additionalContentUrl: z
      .string()
      .nullish()
      .describe('URL to additional content related to the publication.'),
    additionalContentUrl2: z
      .string()
      .nullish()
      .describe('Second URL for additional content related to the publication.'),
    respondingDepartment: DepartmentRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    businesses: z
      .array(CommitteeBusinessSummaryRawSchema)
      .nullish()
      .describe('Gets or sets the committee business associated with the publication.'),
    committee: CommitteeSummaryRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
  }),
);
/** Complete ContactInformation source metadata; undocumented extra fields are ignored. */
const ContactInformationRawSchema: z.ZodType<ContactInformationRaw> = z.lazy(() =>
  z.object({
    email: z.string().nullish().describe('Current contact email.'),
    phone: z.string().nullish().describe('Telephone number.'),
    address: z.string().nullish().describe('Postal address.'),
    contactDisclaimer: z.string().nullish().describe('Disclaimer for contact information.'),
  }),
);
/** Complete CommitteeSummary source metadata; undocumented extra fields are ignored. */
export const CommitteeSummaryRawSchema: z.ZodType<CommitteeSummaryRaw> = z.lazy(() =>
  z.object({
    contact: ContactInformationRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    id: z.number().int().describe('The ID of the committee.'),
    name: z.string().nullish().describe('The current name of the committee.'),
    parentCommittee: CommitteeSummaryRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    subCommittees: z
      .array(CommitteeSummaryRawSchema)
      .nullish()
      .describe('Sub-committees of this committee.'),
    house: HouseRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    leadHouse: LeadHouseRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    category: CommitteeCategoryRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    committeeTypes: z.array(CommitteeTypeRawSchema).nullish().describe('List of Committee types.'),
    showOnWebsite: z
      .boolean()
      .nullish()
      .describe('Indicates whether this committee should be shown on the website.'),
    websiteLegacyUrl: z
      .string()
      .nullish()
      .describe('The legacy website URL for the committee, if one exists.'),
    websiteLegacyRedirectEnabled: z
      .boolean()
      .nullish()
      .describe(
        'Indicates whether automatic redirect to the legacy website has been enabled for the committee.',
      ),
    startDate: z.string().nullish().describe('The start date of the committee.'),
    endDate: z.string().nullish().describe('The end date of the committee.'),
    dateCommonsAppointed: z
      .string()
      .nullish()
      .describe('The date the committee was appointed by the House of Commons.'),
    dateLordsAppointed: z
      .string()
      .nullish()
      .describe('The date the committee was appointed by the House of Lords.'),
    scrutinisingDepartments: z
      .array(ScrutinisingDepartmentRawSchema)
      .nullish()
      .describe('All the departments the committee scrutinizes.'),
    isLeadCommittee: z
      .boolean()
      .nullish()
      .describe(
        'Indicates whether this is the lead committee, if linked to an event with multiple committees.',
      ),
    nameHistory: z
      .array(CommitteeNameRawSchema)
      .nullish()
      .describe('Previous names of this committee.'),
  }),
);
/** Complete LeadHouse source metadata; undocumented extra fields are ignored. */
const LeadHouseRawSchema: z.ZodType<LeadHouseRaw> = z.lazy(() =>
  z.object({
    isCommons: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the lead house is the House of Commons.'),
    isLords: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the lead house is the House of Lords.'),
  }),
);
/** Complete CommitteeCategory source metadata; undocumented extra fields are ignored. */
const CommitteeCategoryRawSchema: z.ZodType<CommitteeCategoryRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('Gets or sets the unique identifier for the committee category.'),
    name: z.string().nullish().describe('Gets or sets the name of the committee category.'),
  }),
);
/** Complete CommitteeType source metadata; undocumented extra fields are ignored. */
const CommitteeTypeRawSchema: z.ZodType<CommitteeTypeRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('Gets or sets the unique identifier for the committee type.'),
    name: z.string().nullish().describe('Gets or sets the name of the committee type.'),
    committeeCategory: CommitteeCategoryRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
  }),
);
/** Complete ScrutinisingDepartment source metadata; undocumented extra fields are ignored. */
const ScrutinisingDepartmentRawSchema: z.ZodType<ScrutinisingDepartmentRaw> = z.lazy(() =>
  z.object({
    departmentId: z
      .number()
      .int()
      .nullish()
      .describe('The Id of the department which this committee scrutinises.'),
    name: z
      .string()
      .nullish()
      .describe('The name of the department which this committee scrutinises.'),
  }),
);
/** Complete CommitteeName source metadata; undocumented extra fields are ignored. */
const CommitteeNameRawSchema: z.ZodType<CommitteeNameRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('Gets or sets the unique identifier for the committee name.'),
    committeeId: z
      .number()
      .int()
      .nullish()
      .describe('Gets or sets the unique identifier for the committee.'),
    name: z.string().nullish().describe('Gets or sets the name of the committee.'),
    startDate: z.string().nullish().describe('Gets or sets the start date of the committee.'),
    endDate: z
      .string()
      .nullish()
      .describe('Gets or sets the end date of the committee, if applicable.'),
  }),
);
/** Complete Banner source metadata; undocumented extra fields are ignored. */
const BannerRawSchema: z.ZodType<BannerRaw> = z.lazy(() =>
  z.object({
    desktopBanner: FileRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    mobileBanner: FileRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
  }),
);
/** Complete ContentLink source metadata; undocumented extra fields are ignored. */
const ContentLinkRawSchema: z.ZodType<ContentLinkRaw> = z.lazy(() =>
  z.object({
    title: z.string().nullish().describe('Title of the content link.'),
    url: z.string().nullish().describe('URL of the content link.'),
    description: z.string().nullish().describe('Description of the content link.'),
    displayOrder: z.number().int().nullish().describe('Order to display the content link.'),
  }),
);
/** Complete MemberInfo source metadata; undocumented extra fields are ignored. */
const MemberInfoRawSchema: z.ZodType<MemberInfoRaw> = z.lazy(() =>
  z.object({
    memberFrom: z.string().nullish().describe('Gets or sets the location the member represents.'),
    party: z.string().nullish().describe('Gets or sets the political party of the member.'),
    partyColour: z
      .string()
      .nullish()
      .describe("Gets or sets the color associated with the member's party."),
    mnisId: z
      .number()
      .int()
      .describe('Gets or sets the unique identifier for the member in the MNIS system.'),
    isChair: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the member is a chairperson.'),
    listAs: z.string().nullish().describe('Gets or sets the name of the member as listed.'),
    displayAs: z
      .string()
      .nullish()
      .describe('Gets or sets the name of the member for display purposes.'),
    fullTitle: z.string().nullish().describe('Gets or sets the full title of the member.'),
    addressAs: z.string().nullish().describe('Gets or sets the name to address the member as.'),
    house: HouseRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    isCurrent: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the member is currently active.'),
  }),
);
/** Complete CommitteeMemberRole source metadata; undocumented extra fields are ignored. */
const CommitteeMemberRoleRawSchema: z.ZodType<CommitteeMemberRoleRaw> = z.lazy(() =>
  z.object({
    startDate: z
      .string()
      .nullish()
      .describe("Gets or sets the start date of the committee member's role."),
    endDate: z
      .string()
      .nullish()
      .describe(
        "Gets or sets the end date of the committee member's role. Null if the role is ongoing.",
      ),
    role: RoleRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    exOfficio: z
      .boolean()
      .nullish()
      .describe('Indicates whether the committee member holds an ex officio position.'),
    alternate: z
      .boolean()
      .nullish()
      .describe('Indicates whether the committee member is an alternate.'),
    coOpted: z.boolean().nullish().describe('Indicates whether the committee member is co-opted.'),
  }),
);
/** Complete CommitteeBusinessType source metadata; undocumented extra fields are ignored. */
const CommitteeBusinessTypeRawSchema: z.ZodType<CommitteeBusinessTypeRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('Gets or sets the unique identifier for the business type.'),
    name: z.string().nullish().describe('Gets or sets the name of the business type.'),
    isInquiry: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the business is an inquiry.'),
    description: z
      .string()
      .nullish()
      .describe('Gets or sets the description of the business type.'),
  }),
);
/** Complete PublicationSummary source metadata; undocumented extra fields are ignored. */
const PublicationSummaryRawSchema: z.ZodType<PublicationSummaryRaw> = z.lazy(() =>
  z.object({
    description: z.string().nullish().describe('Description of publication.'),
    id: z.number().int().describe('The ID of the publication.'),
    publicationStartDate: z
      .string()
      .nullish()
      .describe('Date when publication can be published from.'),
    governmentResponses: GovernmentResponseRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    publicationEndDate: z
      .string()
      .nullish()
      .describe('Date when publication can be published until.'),
    documents: z
      .array(DocumentRawSchema)
      .nullish()
      .describe('Documents associated with the publication.'),
    hcNumber: HouseNumberRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    hlPaper: HouseNumberRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    type: PublicationTypeRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    responseToPublicationId: z
      .number()
      .int()
      .nullish()
      .describe("If publication is in response to another publication, that publication's ID."),
    additionalContentUrl: z
      .string()
      .nullish()
      .describe('URL to additional content related to the publication.'),
    additionalContentUrl2: z
      .string()
      .nullish()
      .describe('Second URL for additional content related to the publication.'),
    respondingDepartment: DepartmentRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
  }),
);
/** Complete SubmissionPeriodSummary source metadata; undocumented extra fields are ignored. */
const SubmissionPeriodSummaryRawSchema: z.ZodType<SubmissionPeriodSummaryRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('Id of the submission period.'),
    startDate: z.string().nullish().describe('Submission period start date.'),
    endDate: z.string().nullish().describe('Submission period end date.'),
    submissionType: SubmissionTypeRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    isPromoted: z
      .boolean()
      .nullish()
      .describe('Whether the submission period should be promoted or not.'),
    statusMessage: z
      .string()
      .nullish()
      .describe('The status message of the submission period (if applicable).'),
    allowSubmissionsPastEndDate: z
      .boolean()
      .nullish()
      .describe(
        'Whether submissions are allowed past the deadline if the form is accessed via direct link.',
      ),
  }),
);
/** Complete ActivitySummary source metadata; undocumented extra fields are ignored. */
const ActivitySummaryRawSchema: z.ZodType<ActivitySummaryRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('The id of the activity.'),
    name: z.string().nullish().describe('The name of the activity.'),
    startDate: z.string().nullish().describe('The datetime the activity starts.'),
    endDate: z.string().nullish().describe('The datetime the activity ends.'),
    eventId: z
      .number()
      .int()
      .nullish()
      .describe('The id of the event this activity is attached to.'),
    isPrivate: z.boolean().nullish().describe('Whether an activity is private or public.'),
    activityType: z.string().nullish().describe('Type of activity.'),
    attendees: z
      .array(ActivityPersonRawSchema)
      .nullish()
      .describe('A list of attendees of the activity.'),
  }),
);
/** Complete Links source metadata; undocumented extra fields are ignored. */
const LinksRawSchema: z.ZodType<LinksRaw> = z.lazy(() =>
  z.object({
    url: z.string().nullish().describe('Gets or sets the URL of the link.'),
    description: z.string().nullish().describe('Gets or sets the description of the link.'),
  }),
);
/** Complete HouseNumber source metadata; undocumented extra fields are ignored. */
const HouseNumberRawSchema: z.ZodType<HouseNumberRaw> = z.lazy(() =>
  z.object({
    number: z.string().nullish().describe('Gets or sets the house number.'),
    sessionId: z
      .number()
      .int()
      .nullish()
      .describe('Gets or sets the session ID associated with the house number.'),
    sessionDescription: z
      .string()
      .nullish()
      .describe('Gets or sets the description of the session associated with the house number.'),
  }),
);
/** Complete GovernmentResponse source metadata; undocumented extra fields are ignored. */
const GovernmentResponseRawSchema: z.ZodType<GovernmentResponseRaw> = z.lazy(() =>
  z.object({
    publication: z
      .array(PublicationSummaryRawSchema)
      .nullish()
      .describe('Gets or sets the publication summaries associated with the government response.'),
    responseDeadline: z
      .string()
      .nullish()
      .describe('Gets or sets the deadline for the government response.'),
    responseExcepted: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the response is expected.'),
  }),
);
/** Complete Document source metadata; undocumented extra fields are ignored. */
const DocumentRawSchema: z.ZodType<DocumentRaw> = z.lazy(() =>
  z.object({
    documentId: z.number().int().describe('Gets or sets the unique identifier for the document.'),
    files: z
      .array(DocumentFileRawSchema)
      .nullish()
      .describe('Gets or sets the collection of files associated with the document.'),
  }),
);
/** Complete PublicationType source metadata; undocumented extra fields are ignored. */
const PublicationTypeRawSchema: z.ZodType<PublicationTypeRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('The id of the publication type.'),
    name: z.string().nullish().describe('The name of the publication type.'),
    description: z.string().nullish().describe('The description of the publication type.'),
    governmentCanRespond: z
      .boolean()
      .nullish()
      .describe('Indicates that the government can respond to this type of publication.'),
    canBeResponse: z
      .boolean()
      .nullish()
      .describe('Indicates that publications of this type can be responses to other publications.'),
    iconKey: z
      .string()
      .nullish()
      .describe('Icon type to be rendered on the website for this type of publication.'),
    pluralVersion: z.string().nullish().describe('Plural form of the publication type name.'),
  }),
);
/** Complete Department source metadata; undocumented extra fields are ignored. */
const DepartmentRawSchema: z.ZodType<DepartmentRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('Gets or sets the unique identifier for the department.'),
    name: z.string().nullish().describe('Gets or sets the name of the department.'),
    address: AddressRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    otherAddress: z
      .string()
      .nullish()
      .describe('Gets or sets an alternative address for the department.'),
    phone: z.string().nullish().describe('Gets or sets the phone number of the department.'),
    email: z.string().nullish().describe('Gets or sets the email address of the department.'),
    url: z.string().nullish().describe('Gets or sets the website URL of the department.'),
  }),
);
/** Complete CommitteeBusinessSummary source metadata; undocumented extra fields are ignored. */
export const CommitteeBusinessSummaryRawSchema: z.ZodType<CommitteeBusinessSummaryRaw> = z.lazy(
  () =>
    z.object({
      id: z.number().int().describe('Id of committee business.'),
      title: z.string().nullish().describe('Title of committee business.'),
      type: CommitteeBusinessTypeRawSchema.nullish().describe(
        'Published source value; null or omission preserves absence.',
      ),
      openDate: z.string().nullish().describe('Date the business started.'),
      closeDate: z.string().nullish().describe('Date the business ended.'),
      latestReport: PublicationSummaryRawSchema.nullish().describe(
        'Published source value; null or omission preserves absence.',
      ),
      openSubmissionPeriods: z
        .array(SubmissionPeriodSummaryRawSchema)
        .nullish()
        .describe('Currently open submission periods.'),
      closedSubmissionPeriods: z
        .array(SubmissionPeriodSummaryRawSchema)
        .nullish()
        .describe('Closed submission periods.'),
      nextOralEvidenceSession: ActivitySummaryRawSchema.nullish().describe(
        'Published source value; null or omission preserves absence.',
      ),
      contact: ContactInformationRawSchema.nullish().describe(
        'Published source value; null or omission preserves absence.',
      ),
    }),
);
/** Complete File source metadata; undocumented extra fields are ignored. */
const FileRawSchema: z.ZodType<FileRaw> = z.lazy(() =>
  z.object({
    fileName: z.string().nullish().describe('Gets or sets the name of the file.'),
    fileData: z.string().nullish().describe('Gets or sets the binary data of the file.'),
  }),
);
/** Complete Role source metadata; undocumented extra fields are ignored. */
const RoleRawSchema: z.ZodType<RoleRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('The id of the role.'),
    name: z.string().nullish().describe('The name of the role.'),
    roleType: RoleTypeRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    isChair: z.boolean().nullish().describe('Indicates whether the role is a chair.'),
  }),
);
/** Complete ActivityPerson source metadata; undocumented extra fields are ignored. */
const ActivityPersonRawSchema: z.ZodType<ActivityPersonRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('Gets or sets the unique identifier for the person.'),
    personId: z.number().int().nullish().describe('Gets or sets the optional person ID.'),
    name: z.string().nullish().describe('Gets or sets the name of the person.'),
    photoUrl: z.string().nullish().describe("Gets or sets the URL of the person's photo."),
    memberInfo: MemberInfoRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    organisations: z
      .array(OrganisationRawSchema)
      .nullish()
      .describe('Gets or sets the organizations associated with the submitter.'),
    submitterType: SubmitterTypeRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    additionalContext: z
      .string()
      .nullish()
      .describe('Gets or sets additional context information about the submitter.'),
    displayOrder: z
      .number()
      .int()
      .nullish()
      .describe('Gets or sets the display order of the person in the activity.'),
  }),
);
/** Complete DocumentFile source metadata; undocumented extra fields are ignored. */
const DocumentFileRawSchema: z.ZodType<DocumentFileRaw> = z.lazy(() =>
  z.object({
    fileName: z.string().nullish().describe('Gets or sets the name of the file.'),
    fileSize: z.number().int().nullish().describe(FILE_SIZE_DESCRIPTION),
    fileDataFormat: FileDataFormatRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    url: z.string().nullish().describe('Gets or sets the URL where the file can be accessed.'),
    documentPurpose: DocumentPurposeRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    format: z.string().nullish().describe('Gets or sets the format of the file.'),
  }),
);
/** Complete Address source metadata; undocumented extra fields are ignored. */
const AddressRawSchema: z.ZodType<AddressRaw> = z.lazy(() =>
  z.object({
    addressLine1: z.string().nullish().describe('Gets or sets the first line of the address.'),
    addressLine2: z.string().nullish().describe('Gets or sets the second line of the address.'),
    addressLine3: z.string().nullish().describe('Gets or sets the third line of the address.'),
    addressLine4: z.string().nullish().describe('Gets or sets the fourth line of the address.'),
    addressLine5: z.string().nullish().describe('Gets or sets the fifth line of the address.'),
    postcode: z.string().nullish().describe('Gets or sets the postcode of the address.'),
  }),
);
/** Complete RoleType source metadata; undocumented extra fields are ignored. */
const RoleTypeRawSchema: z.ZodType<RoleTypeRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('The id of the role type.'),
    name: z.string().nullish().describe('The name of the role type.'),
  }),
);
/** Complete Organisation source metadata; undocumented extra fields are ignored. */
const OrganisationRawSchema: z.ZodType<OrganisationRaw> = z.lazy(() =>
  z.object({
    name: z.string().nullish().describe('Gets or sets the name of the organization.'),
    role: z.string().nullish().describe('Gets or sets the role of the organization.'),
    idmsId: z.string().nullish().describe('Gets or sets the IDMS identifier for the organization.'),
    cisId: z
      .number()
      .int()
      .nullish()
      .describe('Gets or sets the CIS identifier for the organization.'),
  }),
);
/** Complete DocumentPurpose source metadata; undocumented extra fields are ignored. */
const DocumentPurposeRawSchema: z.ZodType<DocumentPurposeRaw> = z.lazy(() =>
  z.object({
    id: z.number().int().describe('Gets or sets the unique identifier for the document purpose.'),
    name: z.string().nullish().describe('Gets or sets the name of the document purpose.'),
    description: z
      .string()
      .nullish()
      .describe('Gets or sets the description of the document purpose.'),
    label: z.string().nullish().describe('Gets or sets the label of the document purpose.'),
    sortOrder: z
      .number()
      .int()
      .nullish()
      .describe('Gets or sets the sort order for the document purpose.'),
  }),
);
/** Discriminator and record pointer that open every flattened entity node. */
const nodeHeader = <const K extends string>(kind: K) => ({
  kind: z.literal(kind).describe('Source entity type.'),
  sourcePath: z.string().describe('JSON pointer to this entity in the record.'),
});
/** Pointer to the entity at a single-valued source relationship. */
const pathTo = (relation: string) => z.string().nullish().describe(`sourcePath of ${relation}.`);
/** Pointers to the entities at a list-valued source relationship, in source order. */
const pathsTo = (relation: string, item = 'child sourcePath') =>
  z
    .array(z.string().describe(`Ordered ${item}.`))
    .nullish()
    .describe(`sourcePaths of ${relation}.`);
const CommitteeDetailsNodeSchema = z
  .object({
    ...nodeHeader('CommitteeDetails'),
    contactPath: pathTo('contact'),
    id: z.number().int().describe('The ID of the committee.'),
    name: z.string().nullish().describe('The current name of the committee.'),
    parentCommitteePath: pathTo('parentCommittee'),
    subCommitteesPaths: pathsTo('subCommittees'),
    house: HouseRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    leadHousePath: pathTo('leadHouse'),
    categoryPath: pathTo('category'),
    committeeTypesPaths: pathsTo('committeeTypes'),
    showOnWebsite: z
      .boolean()
      .nullish()
      .describe('Indicates whether this committee should be shown on the website.'),
    websiteLegacyUrl: z
      .string()
      .nullish()
      .describe('The legacy website URL for the committee, if one exists.'),
    websiteLegacyRedirectEnabled: z
      .boolean()
      .nullish()
      .describe(
        'Indicates whether automatic redirect to the legacy website has been enabled for the committee.',
      ),
    startDate: z.string().nullish().describe('The start date of the committee.'),
    endDate: z.string().nullish().describe('The end date of the committee.'),
    dateCommonsAppointed: z
      .string()
      .nullish()
      .describe('The date the committee was appointed by the House of Commons.'),
    dateLordsAppointed: z
      .string()
      .nullish()
      .describe('The date the committee was appointed by the House of Lords.'),
    scrutinisingDepartmentsPaths: pathsTo('scrutinisingDepartments'),
    isLeadCommittee: z
      .boolean()
      .nullish()
      .describe(
        'Indicates whether this is the lead committee, if linked to an event with multiple committees.',
      ),
    nameHistoryPaths: pathsTo('nameHistory'),
    bannerPath: pathTo('banner'),
    contentLinksPaths: pathsTo('contentLinks'),
    purpose: z.string().nullish().describe('Gets or sets the purpose of the committee.'),
    previousCommitteesPaths: pathsTo('previousCommittees'),
  })
  .describe('Complete CommitteeDetails entity.');
const CommitteeMemberNodeSchema = z
  .object({
    ...nodeHeader('CommitteeMember'),
    id: z.number().int().describe('Gets or sets the unique identifier for the person.'),
    personId: z.number().int().nullish().describe('Gets or sets the optional person ID.'),
    name: z.string().nullish().describe('Gets or sets the name of the person.'),
    photoUrl: z.string().nullish().describe("Gets or sets the URL of the person's photo."),
    memberInfoPath: pathTo('memberInfo'),
    isLayMember: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the member is a lay member.'),
    rolesPaths: pathsTo('roles'),
  })
  .describe('Complete CommitteeMember entity.');
const CommitteeBusinessDetailsNodeSchema = z
  .object({
    ...nodeHeader('CommitteeBusinessDetails'),
    id: z.number().int().describe('Id of committee business.'),
    title: z.string().nullish().describe('Title of committee business.'),
    typePath: pathTo('type'),
    openDate: z.string().nullish().describe('Date the business started.'),
    closeDate: z.string().nullish().describe('Date the business ended.'),
    latestReportPath: pathTo('latestReport'),
    openSubmissionPeriodsPaths: pathsTo('openSubmissionPeriods'),
    closedSubmissionPeriodsPaths: pathsTo('closedSubmissionPeriods'),
    nextOralEvidenceSessionPath: pathTo('nextOralEvidenceSession'),
    contactPath: pathTo('contact'),
    scope: z.string().nullish().describe('Gets or sets the scope of the committee business.'),
    relatedInformationPaths: pathsTo('relatedInformation'),
    bannerPath: pathTo('banner'),
    hcNumbersPaths: pathsTo('hcNumbers'),
  })
  .describe('Complete CommitteeBusinessDetails entity.');
const PublicationNodeSchema = z
  .object({
    ...nodeHeader('Publication'),
    description: z.string().nullish().describe('Description of publication.'),
    id: z.number().int().describe('The ID of the publication.'),
    publicationStartDate: z
      .string()
      .nullish()
      .describe('Date when publication can be published from.'),
    governmentResponsesPath: pathTo('governmentResponses'),
    publicationEndDate: z
      .string()
      .nullish()
      .describe('Date when publication can be published until.'),
    documentsPaths: pathsTo('documents'),
    hcNumberPath: pathTo('hcNumber'),
    hlPaperPath: pathTo('hlPaper'),
    typePath: pathTo('type'),
    responseToPublicationId: z
      .number()
      .int()
      .nullish()
      .describe("If publication is in response to another publication, that publication's ID."),
    additionalContentUrl: z
      .string()
      .nullish()
      .describe('URL to additional content related to the publication.'),
    additionalContentUrl2: z
      .string()
      .nullish()
      .describe('Second URL for additional content related to the publication.'),
    respondingDepartmentPath: pathTo('respondingDepartment'),
    businessesPaths: pathsTo('businesses'),
    committeePath: z
      .string()
      .nullish()
      .describe(
        'sourcePath of committee. mode=publications items omit it with the committee entity; mode=publication returns it.',
      ),
  })
  .describe('Complete Publication entity.');
const ContactInformationNodeSchema = z
  .object({
    ...nodeHeader('ContactInformation'),
    email: z.string().nullish().describe('Current contact email.'),
    phone: z.string().nullish().describe('Telephone number.'),
    address: z.string().nullish().describe('Postal address.'),
    contactDisclaimer: z.string().nullish().describe('Disclaimer for contact information.'),
  })
  .describe('Complete ContactInformation entity.');
const CommitteeSummaryNodeSchema = z
  .object({
    ...nodeHeader('CommitteeSummary'),
    contactPath: pathTo('contact'),
    id: z.number().int().describe('The ID of the committee.'),
    name: z.string().nullish().describe('The current name of the committee.'),
    parentCommitteePath: pathTo('parentCommittee'),
    subCommitteesPaths: pathsTo('subCommittees'),
    house: HouseRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    leadHousePath: pathTo('leadHouse'),
    categoryPath: pathTo('category'),
    committeeTypesPaths: pathsTo('committeeTypes'),
    showOnWebsite: z
      .boolean()
      .nullish()
      .describe('Indicates whether this committee should be shown on the website.'),
    websiteLegacyUrl: z
      .string()
      .nullish()
      .describe('The legacy website URL for the committee, if one exists.'),
    websiteLegacyRedirectEnabled: z
      .boolean()
      .nullish()
      .describe(
        'Indicates whether automatic redirect to the legacy website has been enabled for the committee.',
      ),
    startDate: z.string().nullish().describe('The start date of the committee.'),
    endDate: z.string().nullish().describe('The end date of the committee.'),
    dateCommonsAppointed: z
      .string()
      .nullish()
      .describe('The date the committee was appointed by the House of Commons.'),
    dateLordsAppointed: z
      .string()
      .nullish()
      .describe('The date the committee was appointed by the House of Lords.'),
    scrutinisingDepartmentsPaths: pathsTo('scrutinisingDepartments'),
    isLeadCommittee: z
      .boolean()
      .nullish()
      .describe(
        'Indicates whether this is the lead committee, if linked to an event with multiple committees.',
      ),
    nameHistoryPaths: pathsTo('nameHistory'),
  })
  .describe('Complete CommitteeSummary entity.');
const LeadHouseNodeSchema = z
  .object({
    ...nodeHeader('LeadHouse'),
    isCommons: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the lead house is the House of Commons.'),
    isLords: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the lead house is the House of Lords.'),
  })
  .describe('Complete LeadHouse entity.');
const CommitteeCategoryNodeSchema = z
  .object({
    ...nodeHeader('CommitteeCategory'),
    id: z.number().int().describe('Gets or sets the unique identifier for the committee category.'),
    name: z.string().nullish().describe('Gets or sets the name of the committee category.'),
  })
  .describe('Complete CommitteeCategory entity.');
const CommitteeTypeNodeSchema = z
  .object({
    ...nodeHeader('CommitteeType'),
    id: z.number().int().describe('Gets or sets the unique identifier for the committee type.'),
    name: z.string().nullish().describe('Gets or sets the name of the committee type.'),
    committeeCategoryPath: pathTo('committeeCategory'),
  })
  .describe('Complete CommitteeType entity.');
const ScrutinisingDepartmentNodeSchema = z
  .object({
    ...nodeHeader('ScrutinisingDepartment'),
    departmentId: z
      .number()
      .int()
      .nullish()
      .describe('The Id of the department which this committee scrutinises.'),
    name: z
      .string()
      .nullish()
      .describe('The name of the department which this committee scrutinises.'),
  })
  .describe('Complete ScrutinisingDepartment entity.');
const CommitteeNameNodeSchema = z
  .object({
    ...nodeHeader('CommitteeName'),
    id: z.number().int().describe('Gets or sets the unique identifier for the committee name.'),
    committeeId: z
      .number()
      .int()
      .nullish()
      .describe('Gets or sets the unique identifier for the committee.'),
    name: z.string().nullish().describe('Gets or sets the name of the committee.'),
    startDate: z.string().nullish().describe('Gets or sets the start date of the committee.'),
    endDate: z
      .string()
      .nullish()
      .describe('Gets or sets the end date of the committee, if applicable.'),
  })
  .describe('Complete CommitteeName entity.');
const BannerNodeSchema = z
  .object({
    ...nodeHeader('Banner'),
    desktopBannerPath: pathTo('desktopBanner'),
    mobileBannerPath: pathTo('mobileBanner'),
  })
  .describe('Complete Banner entity.');
const ContentLinkNodeSchema = z
  .object({
    ...nodeHeader('ContentLink'),
    title: z.string().nullish().describe('Title of the content link.'),
    url: z.string().nullish().describe('URL of the content link.'),
    description: z.string().nullish().describe('Description of the content link.'),
    displayOrder: z.number().int().nullish().describe('Order to display the content link.'),
  })
  .describe('Complete ContentLink entity.');
const MemberInfoNodeSchema = z
  .object({
    ...nodeHeader('MemberInfo'),
    memberFrom: z.string().nullish().describe('Gets or sets the location the member represents.'),
    party: z.string().nullish().describe('Gets or sets the political party of the member.'),
    partyColour: z
      .string()
      .nullish()
      .describe("Gets or sets the color associated with the member's party."),
    mnisId: z
      .number()
      .int()
      .describe('Gets or sets the unique identifier for the member in the MNIS system.'),
    isChair: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the member is a chairperson.'),
    listAs: z.string().nullish().describe('Gets or sets the name of the member as listed.'),
    displayAs: z
      .string()
      .nullish()
      .describe('Gets or sets the name of the member for display purposes.'),
    fullTitle: z.string().nullish().describe('Gets or sets the full title of the member.'),
    addressAs: z.string().nullish().describe('Gets or sets the name to address the member as.'),
    house: HouseRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    isCurrent: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the member is currently active.'),
  })
  .describe('Complete MemberInfo entity.');
const CommitteeMemberRoleNodeSchema = z
  .object({
    ...nodeHeader('CommitteeMemberRole'),
    startDate: z
      .string()
      .nullish()
      .describe("Gets or sets the start date of the committee member's role."),
    endDate: z
      .string()
      .nullish()
      .describe(
        "Gets or sets the end date of the committee member's role. Null if the role is ongoing.",
      ),
    rolePath: pathTo('role'),
    exOfficio: z
      .boolean()
      .nullish()
      .describe('Indicates whether the committee member holds an ex officio position.'),
    alternate: z
      .boolean()
      .nullish()
      .describe('Indicates whether the committee member is an alternate.'),
    coOpted: z.boolean().nullish().describe('Indicates whether the committee member is co-opted.'),
  })
  .describe('Complete CommitteeMemberRole entity.');
const CommitteeBusinessTypeNodeSchema = z
  .object({
    ...nodeHeader('CommitteeBusinessType'),
    id: z.number().int().describe('Gets or sets the unique identifier for the business type.'),
    name: z.string().nullish().describe('Gets or sets the name of the business type.'),
    isInquiry: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the business is an inquiry.'),
    description: z
      .string()
      .nullish()
      .describe('Gets or sets the description of the business type.'),
  })
  .describe('Complete CommitteeBusinessType entity.');
const PublicationSummaryNodeSchema = z
  .object({
    ...nodeHeader('PublicationSummary'),
    description: z.string().nullish().describe('Description of publication.'),
    id: z.number().int().describe('The ID of the publication.'),
    publicationStartDate: z
      .string()
      .nullish()
      .describe('Date when publication can be published from.'),
    governmentResponsesPath: pathTo('governmentResponses'),
    publicationEndDate: z
      .string()
      .nullish()
      .describe('Date when publication can be published until.'),
    documentsPaths: pathsTo('documents'),
    hcNumberPath: pathTo('hcNumber'),
    hlPaperPath: pathTo('hlPaper'),
    typePath: pathTo('type'),
    responseToPublicationId: z
      .number()
      .int()
      .nullish()
      .describe("If publication is in response to another publication, that publication's ID."),
    additionalContentUrl: z
      .string()
      .nullish()
      .describe('URL to additional content related to the publication.'),
    additionalContentUrl2: z
      .string()
      .nullish()
      .describe('Second URL for additional content related to the publication.'),
    respondingDepartmentPath: pathTo('respondingDepartment'),
  })
  .describe('Complete PublicationSummary entity.');
const SubmissionPeriodSummaryNodeSchema = z
  .object({
    ...nodeHeader('SubmissionPeriodSummary'),
    id: z.number().int().describe('Id of the submission period.'),
    startDate: z.string().nullish().describe('Submission period start date.'),
    endDate: z.string().nullish().describe('Submission period end date.'),
    submissionType: SubmissionTypeRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    isPromoted: z
      .boolean()
      .nullish()
      .describe('Whether the submission period should be promoted or not.'),
    statusMessage: z
      .string()
      .nullish()
      .describe('The status message of the submission period (if applicable).'),
    allowSubmissionsPastEndDate: z
      .boolean()
      .nullish()
      .describe(
        'Whether submissions are allowed past the deadline if the form is accessed via direct link.',
      ),
  })
  .describe('Complete SubmissionPeriodSummary entity.');
const ActivitySummaryNodeSchema = z
  .object({
    ...nodeHeader('ActivitySummary'),
    id: z.number().int().describe('The id of the activity.'),
    name: z.string().nullish().describe('The name of the activity.'),
    startDate: z.string().nullish().describe('The datetime the activity starts.'),
    endDate: z.string().nullish().describe('The datetime the activity ends.'),
    eventId: z
      .number()
      .int()
      .nullish()
      .describe('The id of the event this activity is attached to.'),
    isPrivate: z.boolean().nullish().describe('Whether an activity is private or public.'),
    activityType: z.string().nullish().describe('Type of activity.'),
    attendeesPaths: pathsTo('attendees'),
  })
  .describe('Complete ActivitySummary entity.');
const LinksNodeSchema = z
  .object({
    ...nodeHeader('Links'),
    url: z.string().nullish().describe('Gets or sets the URL of the link.'),
    description: z.string().nullish().describe('Gets or sets the description of the link.'),
  })
  .describe('Complete Links entity.');
const HouseNumberNodeSchema = z
  .object({
    ...nodeHeader('HouseNumber'),
    number: z.string().nullish().describe('Gets or sets the house number.'),
    sessionId: z
      .number()
      .int()
      .nullish()
      .describe('Gets or sets the session ID associated with the house number.'),
    sessionDescription: z
      .string()
      .nullish()
      .describe('Gets or sets the description of the session associated with the house number.'),
  })
  .describe('Complete HouseNumber entity.');
const GovernmentResponseNodeSchema = z
  .object({
    ...nodeHeader('GovernmentResponse'),
    publicationPaths: pathsTo('publication'),
    responseDeadline: z
      .string()
      .nullish()
      .describe('Gets or sets the deadline for the government response.'),
    responseExcepted: z
      .boolean()
      .nullish()
      .describe('Gets or sets a value indicating whether the response is expected.'),
  })
  .describe('Complete GovernmentResponse entity.');
const DocumentNodeSchema = z
  .object({
    ...nodeHeader('Document'),
    documentId: z.number().int().describe('Gets or sets the unique identifier for the document.'),
    filesPaths: pathsTo('files'),
  })
  .describe('Complete Document entity.');
const PublicationTypeNodeSchema = z
  .object({
    ...nodeHeader('PublicationType'),
    id: z.number().int().describe('The id of the publication type.'),
    name: z.string().nullish().describe('The name of the publication type.'),
    description: z.string().nullish().describe('The description of the publication type.'),
    governmentCanRespond: z
      .boolean()
      .nullish()
      .describe('Indicates that the government can respond to this type of publication.'),
    canBeResponse: z
      .boolean()
      .nullish()
      .describe('Indicates that publications of this type can be responses to other publications.'),
    iconKey: z
      .string()
      .nullish()
      .describe('Icon type to be rendered on the website for this type of publication.'),
    pluralVersion: z.string().nullish().describe('Plural form of the publication type name.'),
  })
  .describe('Complete PublicationType entity.');
const DepartmentNodeSchema = z
  .object({
    ...nodeHeader('Department'),
    id: z.number().int().describe('Gets or sets the unique identifier for the department.'),
    name: z.string().nullish().describe('Gets or sets the name of the department.'),
    addressPath: pathTo('address'),
    otherAddress: z
      .string()
      .nullish()
      .describe('Gets or sets an alternative address for the department.'),
    phone: z.string().nullish().describe('Gets or sets the phone number of the department.'),
    email: z.string().nullish().describe('Gets or sets the email address of the department.'),
    url: z.string().nullish().describe('Gets or sets the website URL of the department.'),
  })
  .describe('Complete Department entity.');
const CommitteeBusinessSummaryNodeSchema = z
  .object({
    ...nodeHeader('CommitteeBusinessSummary'),
    id: z.number().int().describe('Id of committee business.'),
    title: z.string().nullish().describe('Title of committee business.'),
    typePath: pathTo('type'),
    openDate: z.string().nullish().describe('Date the business started.'),
    closeDate: z.string().nullish().describe('Date the business ended.'),
    latestReportPath: pathTo('latestReport'),
    openSubmissionPeriodsPaths: pathsTo('openSubmissionPeriods'),
    closedSubmissionPeriodsPaths: pathsTo('closedSubmissionPeriods'),
    nextOralEvidenceSessionPath: pathTo('nextOralEvidenceSession'),
    contactPath: pathTo('contact'),
  })
  .describe('Complete CommitteeBusinessSummary entity.');
const FileNodeSchema = z
  .object({
    ...nodeHeader('File'),
    fileName: z.string().nullish().describe('Gets or sets the name of the file.'),
    fileData: z.string().nullish().describe('Gets or sets the binary data of the file.'),
  })
  .describe('Complete File entity.');
const RoleNodeSchema = z
  .object({
    ...nodeHeader('Role'),
    id: z.number().int().describe('The id of the role.'),
    name: z.string().nullish().describe('The name of the role.'),
    roleTypePath: pathTo('roleType'),
    isChair: z.boolean().nullish().describe('Indicates whether the role is a chair.'),
  })
  .describe('Complete Role entity.');
const ActivityPersonNodeSchema = z
  .object({
    ...nodeHeader('ActivityPerson'),
    id: z.number().int().describe('Gets or sets the unique identifier for the person.'),
    personId: z.number().int().nullish().describe('Gets or sets the optional person ID.'),
    name: z.string().nullish().describe('Gets or sets the name of the person.'),
    photoUrl: z.string().nullish().describe("Gets or sets the URL of the person's photo."),
    memberInfoPath: pathTo('memberInfo'),
    organisationsPaths: pathsTo('organisations'),
    submitterType: SubmitterTypeRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    additionalContext: z
      .string()
      .nullish()
      .describe('Gets or sets additional context information about the submitter.'),
    displayOrder: z
      .number()
      .int()
      .nullish()
      .describe('Gets or sets the display order of the person in the activity.'),
  })
  .describe('Complete ActivityPerson entity.');
const DocumentFileNodeSchema = z
  .object({
    ...nodeHeader('DocumentFile'),
    fileName: z.string().nullish().describe('Gets or sets the name of the file.'),
    fileSize: z.number().int().nullish().describe(FILE_SIZE_DESCRIPTION),
    fileDataFormat: FileDataFormatRawSchema.nullish().describe(
      'Published source value; null or omission preserves absence.',
    ),
    url: z.string().nullish().describe('Gets or sets the URL where the file can be accessed.'),
    apiRoute: z
      .string()
      .optional()
      .describe(
        'Relative Committees API route returning this file as a base64 JSON envelope, not a public page; absent when fileDataFormat is null. mode=evidence_document reads an evidence Html route.',
      ),
    documentPurposePath: pathTo('documentPurpose'),
    format: z.string().nullish().describe('Gets or sets the format of the file.'),
  })
  .describe('Complete DocumentFile entity.');
const AddressNodeSchema = z
  .object({
    ...nodeHeader('Address'),
    addressLine1: z.string().nullish().describe('Gets or sets the first line of the address.'),
    addressLine2: z.string().nullish().describe('Gets or sets the second line of the address.'),
    addressLine3: z.string().nullish().describe('Gets or sets the third line of the address.'),
    addressLine4: z.string().nullish().describe('Gets or sets the fourth line of the address.'),
    addressLine5: z.string().nullish().describe('Gets or sets the fifth line of the address.'),
    postcode: z.string().nullish().describe('Gets or sets the postcode of the address.'),
  })
  .describe('Complete Address entity.');
const RoleTypeNodeSchema = z
  .object({
    ...nodeHeader('RoleType'),
    id: z.number().int().describe('The id of the role type.'),
    name: z.string().nullish().describe('The name of the role type.'),
  })
  .describe('Complete RoleType entity.');
const OrganisationNodeSchema = z
  .object({
    ...nodeHeader('Organisation'),
    name: z.string().nullish().describe('Gets or sets the name of the organization.'),
    role: z.string().nullish().describe('Gets or sets the role of the organization.'),
    idmsId: z.string().nullish().describe('Gets or sets the IDMS identifier for the organization.'),
    cisId: z
      .number()
      .int()
      .nullish()
      .describe('Gets or sets the CIS identifier for the organization.'),
  })
  .describe('Complete Organisation entity.');
const DocumentPurposeNodeSchema = z
  .object({
    ...nodeHeader('DocumentPurpose'),
    id: z.number().int().describe('Gets or sets the unique identifier for the document purpose.'),
    name: z.string().nullish().describe('Gets or sets the name of the document purpose.'),
    description: z
      .string()
      .nullish()
      .describe('Gets or sets the description of the document purpose.'),
    label: z.string().nullish().describe('Gets or sets the label of the document purpose.'),
    sortOrder: z
      .number()
      .int()
      .nullish()
      .describe('Gets or sets the sort order for the document purpose.'),
  })
  .describe('Complete DocumentPurpose entity.');
const SubmitterRawSchema = z.object({
  id: z.number().int().describe('Committee submitter identifier, distinct from MNIS.'),
  personId: z.number().int().nullish().describe('Source person identifier.'),
  name: z.string().nullish().describe('Published witness name.'),
  photoUrl: z.string().nullish().describe('Published witness photo URL.'),
  memberInfo: MemberInfoRawSchema.nullish().describe('Published parliamentary member metadata.'),
  organisations: z
    .array(OrganisationRawSchema)
    .nullish()
    .describe('Ordered witness organisations.'),
  submitterType: SubmitterTypeRawSchema.nullish().describe('Source submitter type.'),
  additionalContext: z.string().nullish().describe('Source witness context, including HTML.'),
});
const EvidenceRawSchema = z.object({
  id: z.number().int().describe('Evidence ID within the written or oral namespace.'),
  publicationDate: z.string().nullish().describe('Source publication date.'),
  witnesses: z.array(SubmitterRawSchema).nullish().describe('Ordered evidence witnesses.'),
  document: DocumentRawSchema.nullish().describe('Complete supplied document metadata.'),
  committees: z.array(CommitteeSummaryRawSchema).nullish().describe('Associated committees.'),
  legacyHtmlUrl: z.string().nullish().describe('Supplied legacy HTML URL.'),
  legacyPdfUrl: z.string().nullish().describe('Supplied legacy PDF URL.'),
});
/** Written evidence schema follows the official source contract, including absent/null values. */
export const WrittenEvidenceRawSchema = EvidenceRawSchema.extend({
  submissionId: z.string().nullish().describe('Source submission UUID.'),
  internalReference: z.string().nullish().describe('Source submission reference.'),
  committeeBusiness: CommitteeBusinessSummaryRawSchema.nullish().describe('Associated business.'),
  hcNumber: HouseNumberRawSchema.nullish().describe('Commons paper metadata.'),
  anonymous: z.boolean().nullish().describe('Source anonymity state.'),
  anonymousWitnessText: z.string().nullish().describe('Published anonymous witness text.'),
});
/** Oral evidence schema retains activity identity, meeting dates and all associated businesses. */
export const OralEvidenceRawSchema = EvidenceRawSchema.extend({
  activityId: z.number().int().nullish().describe('Source activity identifier.'),
  meetingDate: z.string().nullish().describe('Source meeting date.'),
  activityStartDate: z.string().nullish().describe('Source activity start datetime.'),
  committeeBusinesses: z
    .array(CommitteeBusinessSummaryRawSchema)
    .nullish()
    .describe('Associated businesses in source order.'),
  hcNumbers: z.array(HouseNumberRawSchema).nullish().describe('Commons papers in source order.'),
});
const EvidenceRelationships = {
  witnessesPaths: pathsTo('witnesses', 'witness pointer'),
  documentPath: pathTo('document'),
  committeesPaths: pathsTo('committees', 'committee pointer'),
};
const WrittenEvidenceNodeSchema = WrittenEvidenceRawSchema.omit({
  witnesses: true,
  document: true,
  committees: true,
  committeeBusiness: true,
  hcNumber: true,
})
  .extend({
    ...nodeHeader('WrittenEvidence'),
    ...EvidenceRelationships,
    committeesPaths: EvidenceRelationships.committeesPaths.describe(
      'sourcePaths of committees. mode=evidence items omit them with the committee entities; mode=evidence_detail returns them.',
    ),
    committeeBusinessPath: z
      .string()
      .nullish()
      .describe(
        'sourcePath of committeeBusiness. mode=evidence items omit it with the business entity; mode=evidence_detail or mode=inquiry returns it.',
      ),
    hcNumberPath: pathTo('hcNumber'),
  })
  .describe('Complete WrittenEvidence entity.');
const OralEvidenceNodeSchema = OralEvidenceRawSchema.omit({
  witnesses: true,
  document: true,
  committees: true,
  committeeBusinesses: true,
  hcNumbers: true,
})
  .extend({
    ...nodeHeader('OralEvidence'),
    ...EvidenceRelationships,
    committeeBusinessesPaths: pathsTo('committeeBusinesses', 'business pointer'),
    hcNumbersPaths: pathsTo('hcNumbers', 'paper pointer'),
  })
  .describe('Complete OralEvidence entity.');
const SubmitterNodeSchema = SubmitterRawSchema.omit({
  memberInfo: true,
  organisations: true,
})
  .extend({
    ...nodeHeader('Submitter'),
    memberInfoPath: pathTo('memberInfo'),
    organisationsPaths: pathsTo('organisations', 'organisation pointer'),
  })
  .describe('Complete Submitter entity.');
/** Every typed entity needed to reconstruct a whole committee, membership, business, publication or evidence. */
const CommitteeEntitySchema = z.discriminatedUnion('kind', [
  WrittenEvidenceNodeSchema,
  OralEvidenceNodeSchema,
  SubmitterNodeSchema,
  CommitteeDetailsNodeSchema,
  CommitteeMemberNodeSchema,
  CommitteeBusinessDetailsNodeSchema,
  PublicationNodeSchema,
  ContactInformationNodeSchema,
  CommitteeSummaryNodeSchema,
  LeadHouseNodeSchema,
  CommitteeCategoryNodeSchema,
  CommitteeTypeNodeSchema,
  ScrutinisingDepartmentNodeSchema,
  CommitteeNameNodeSchema,
  BannerNodeSchema,
  ContentLinkNodeSchema,
  MemberInfoNodeSchema,
  CommitteeMemberRoleNodeSchema,
  CommitteeBusinessTypeNodeSchema,
  PublicationSummaryNodeSchema,
  SubmissionPeriodSummaryNodeSchema,
  ActivitySummaryNodeSchema,
  LinksNodeSchema,
  HouseNumberNodeSchema,
  GovernmentResponseNodeSchema,
  DocumentNodeSchema,
  PublicationTypeNodeSchema,
  DepartmentNodeSchema,
  CommitteeBusinessSummaryNodeSchema,
  FileNodeSchema,
  RoleNodeSchema,
  ActivityPersonNodeSchema,
  DocumentFileNodeSchema,
  AddressNodeSchema,
  RoleTypeNodeSchema,
  OrganisationNodeSchema,
  DocumentPurposeNodeSchema,
]);
type CommitteeEntity = z.infer<typeof CommitteeEntitySchema>;
/**
 * Whole selected record; entity pointers preserve all recursive source relationships and ordering.
 * `record` and `items[]` reference its single `$defs` entry.
 */
export const CommitteeRecordSchema = z
  .object({
    recordId: z.string().describe('Selected source ID; namespace is identified by recordType.'),
    recordType: z
      .enum([
        'committee',
        'membership',
        'business',
        'publication',
        'written_evidence',
        'oral_evidence',
      ])
      .describe('Selected source record namespace.'),
    memberId: z
      .string()
      .optional()
      .describe('Members API join ID from memberInfo.mnisId only, never personId.'),
    rootPath: z.literal('').describe('Root entity source pointer.'),
    entities: z
      .array(
        CommitteeEntitySchema.describe('Complete typed entity with source pointer relationships.'),
      )
      .describe(
        'All source entities in preorder. A *Path or *Paths field holds the sourcePath of each entity at that source field; reconstruct references by sourcePath. Null or absent fields mirror the source.',
      ),
  })
  .meta({ id: 'CommitteeRecord' });
function visitCommitteeDetails(
  value: CommitteeDetailsRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = CommitteeDetailsNodeSchema.parse({
    ...value,
    kind: 'CommitteeDetails',
    sourcePath,
    contactPath: value.contact == null ? value.contact : `${sourcePath}/contact`,
    parentCommitteePath:
      value.parentCommittee == null ? value.parentCommittee : `${sourcePath}/parentCommittee`,
    subCommitteesPaths:
      value.subCommittees == null
        ? value.subCommittees
        : value.subCommittees.map((_, index) => `${sourcePath}/subCommittees/${index}`),
    leadHousePath: value.leadHouse == null ? value.leadHouse : `${sourcePath}/leadHouse`,
    categoryPath: value.category == null ? value.category : `${sourcePath}/category`,
    committeeTypesPaths:
      value.committeeTypes == null
        ? value.committeeTypes
        : value.committeeTypes.map((_, index) => `${sourcePath}/committeeTypes/${index}`),
    scrutinisingDepartmentsPaths:
      value.scrutinisingDepartments == null
        ? value.scrutinisingDepartments
        : value.scrutinisingDepartments.map(
            (_, index) => `${sourcePath}/scrutinisingDepartments/${index}`,
          ),
    nameHistoryPaths:
      value.nameHistory == null
        ? value.nameHistory
        : value.nameHistory.map((_, index) => `${sourcePath}/nameHistory/${index}`),
    bannerPath: value.banner == null ? value.banner : `${sourcePath}/banner`,
    contentLinksPaths:
      value.contentLinks == null
        ? value.contentLinks
        : value.contentLinks.map((_, index) => `${sourcePath}/contentLinks/${index}`),
    previousCommitteesPaths:
      value.previousCommittees == null
        ? value.previousCommittees
        : value.previousCommittees.map((_, index) => `${sourcePath}/previousCommittees/${index}`),
  });
  entities.push(node);
  if (value.contact != null)
    visitContactInformation(value.contact, `${sourcePath}/contact`, entities);
  if (value.parentCommittee != null)
    visitCommitteeSummary(value.parentCommittee, `${sourcePath}/parentCommittee`, entities);
  value.subCommittees?.forEach((item, index) => {
    visitCommitteeSummary(item, `${sourcePath}/subCommittees/${index}`, entities);
  });
  if (value.leadHouse != null) visitLeadHouse(value.leadHouse, `${sourcePath}/leadHouse`, entities);
  if (value.category != null)
    visitCommitteeCategory(value.category, `${sourcePath}/category`, entities);
  value.committeeTypes?.forEach((item, index) => {
    visitCommitteeType(item, `${sourcePath}/committeeTypes/${index}`, entities);
  });
  value.scrutinisingDepartments?.forEach((item, index) => {
    visitScrutinisingDepartment(item, `${sourcePath}/scrutinisingDepartments/${index}`, entities);
  });
  value.nameHistory?.forEach((item, index) => {
    visitCommitteeName(item, `${sourcePath}/nameHistory/${index}`, entities);
  });
  if (value.banner != null) visitBanner(value.banner, `${sourcePath}/banner`, entities);
  value.contentLinks?.forEach((item, index) => {
    visitContentLink(item, `${sourcePath}/contentLinks/${index}`, entities);
  });
  value.previousCommittees?.forEach((item, index) => {
    visitCommitteeSummary(item, `${sourcePath}/previousCommittees/${index}`, entities);
  });
}
function visitCommitteeMember(
  value: CommitteeMemberRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = CommitteeMemberNodeSchema.parse({
    ...value,
    kind: 'CommitteeMember',
    sourcePath,
    memberInfoPath: value.memberInfo == null ? value.memberInfo : `${sourcePath}/memberInfo`,
    rolesPaths:
      value.roles == null
        ? value.roles
        : value.roles.map((_, index) => `${sourcePath}/roles/${index}`),
  });
  entities.push(node);
  if (value.memberInfo != null)
    visitMemberInfo(value.memberInfo, `${sourcePath}/memberInfo`, entities);
  value.roles?.forEach((item, index) => {
    visitCommitteeMemberRole(item, `${sourcePath}/roles/${index}`, entities);
  });
}
function visitCommitteeBusinessDetails(
  value: CommitteeBusinessDetailsRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = CommitteeBusinessDetailsNodeSchema.parse({
    ...value,
    kind: 'CommitteeBusinessDetails',
    sourcePath,
    typePath: value.type == null ? value.type : `${sourcePath}/type`,
    latestReportPath:
      value.latestReport == null ? value.latestReport : `${sourcePath}/latestReport`,
    openSubmissionPeriodsPaths:
      value.openSubmissionPeriods == null
        ? value.openSubmissionPeriods
        : value.openSubmissionPeriods.map(
            (_, index) => `${sourcePath}/openSubmissionPeriods/${index}`,
          ),
    closedSubmissionPeriodsPaths:
      value.closedSubmissionPeriods == null
        ? value.closedSubmissionPeriods
        : value.closedSubmissionPeriods.map(
            (_, index) => `${sourcePath}/closedSubmissionPeriods/${index}`,
          ),
    nextOralEvidenceSessionPath:
      value.nextOralEvidenceSession == null
        ? value.nextOralEvidenceSession
        : `${sourcePath}/nextOralEvidenceSession`,
    contactPath: value.contact == null ? value.contact : `${sourcePath}/contact`,
    relatedInformationPaths:
      value.relatedInformation == null
        ? value.relatedInformation
        : value.relatedInformation.map((_, index) => `${sourcePath}/relatedInformation/${index}`),
    bannerPath: value.banner == null ? value.banner : `${sourcePath}/banner`,
    hcNumbersPaths:
      value.hcNumbers == null
        ? value.hcNumbers
        : value.hcNumbers.map((_, index) => `${sourcePath}/hcNumbers/${index}`),
  });
  entities.push(node);
  if (value.type != null) visitCommitteeBusinessType(value.type, `${sourcePath}/type`, entities);
  if (value.latestReport != null)
    visitPublicationSummary(value.latestReport, `${sourcePath}/latestReport`, entities);
  value.openSubmissionPeriods?.forEach((item, index) => {
    visitSubmissionPeriodSummary(item, `${sourcePath}/openSubmissionPeriods/${index}`, entities);
  });
  value.closedSubmissionPeriods?.forEach((item, index) => {
    visitSubmissionPeriodSummary(item, `${sourcePath}/closedSubmissionPeriods/${index}`, entities);
  });
  if (value.nextOralEvidenceSession != null)
    visitActivitySummary(
      value.nextOralEvidenceSession,
      `${sourcePath}/nextOralEvidenceSession`,
      entities,
    );
  if (value.contact != null)
    visitContactInformation(value.contact, `${sourcePath}/contact`, entities);
  value.relatedInformation?.forEach((item, index) => {
    visitLinks(item, `${sourcePath}/relatedInformation/${index}`, entities);
  });
  if (value.banner != null) visitBanner(value.banner, `${sourcePath}/banner`, entities);
  value.hcNumbers?.forEach((item, index) => {
    visitHouseNumber(item, `${sourcePath}/hcNumbers/${index}`, entities);
  });
}
function visitPublication(
  value: PublicationRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = PublicationNodeSchema.parse({
    ...value,
    kind: 'Publication',
    sourcePath,
    governmentResponsesPath:
      value.governmentResponses == null
        ? value.governmentResponses
        : `${sourcePath}/governmentResponses`,
    documentsPaths:
      value.documents == null
        ? value.documents
        : value.documents.map((_, index) => `${sourcePath}/documents/${index}`),
    hcNumberPath: value.hcNumber == null ? value.hcNumber : `${sourcePath}/hcNumber`,
    hlPaperPath: value.hlPaper == null ? value.hlPaper : `${sourcePath}/hlPaper`,
    typePath: value.type == null ? value.type : `${sourcePath}/type`,
    respondingDepartmentPath:
      value.respondingDepartment == null
        ? value.respondingDepartment
        : `${sourcePath}/respondingDepartment`,
    businessesPaths:
      value.businesses == null
        ? value.businesses
        : value.businesses.map((_, index) => `${sourcePath}/businesses/${index}`),
    committeePath: value.committee == null ? value.committee : `${sourcePath}/committee`,
  });
  entities.push(node);
  if (value.governmentResponses != null)
    visitGovernmentResponse(
      value.governmentResponses,
      `${sourcePath}/governmentResponses`,
      entities,
    );
  value.documents?.forEach((item, index) => {
    visitDocument(
      item,
      `${sourcePath}/documents/${index}`,
      entities,
      publicationDocumentRoute(value.id, item.documentId),
    );
  });
  if (value.hcNumber != null) visitHouseNumber(value.hcNumber, `${sourcePath}/hcNumber`, entities);
  if (value.hlPaper != null) visitHouseNumber(value.hlPaper, `${sourcePath}/hlPaper`, entities);
  if (value.type != null) visitPublicationType(value.type, `${sourcePath}/type`, entities);
  if (value.respondingDepartment != null)
    visitDepartment(value.respondingDepartment, `${sourcePath}/respondingDepartment`, entities);
  value.businesses?.forEach((item, index) => {
    visitCommitteeBusinessSummary(item, `${sourcePath}/businesses/${index}`, entities);
  });
  if (value.committee != null)
    visitCommitteeSummary(value.committee, `${sourcePath}/committee`, entities);
}
function visitContactInformation(
  value: ContactInformationRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = ContactInformationNodeSchema.parse({
    ...value,
    kind: 'ContactInformation',
    sourcePath,
  });
  entities.push(node);
}
function visitCommitteeSummary(
  value: CommitteeSummaryRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = CommitteeSummaryNodeSchema.parse({
    ...value,
    kind: 'CommitteeSummary',
    sourcePath,
    contactPath: value.contact == null ? value.contact : `${sourcePath}/contact`,
    parentCommitteePath:
      value.parentCommittee == null ? value.parentCommittee : `${sourcePath}/parentCommittee`,
    subCommitteesPaths:
      value.subCommittees == null
        ? value.subCommittees
        : value.subCommittees.map((_, index) => `${sourcePath}/subCommittees/${index}`),
    leadHousePath: value.leadHouse == null ? value.leadHouse : `${sourcePath}/leadHouse`,
    categoryPath: value.category == null ? value.category : `${sourcePath}/category`,
    committeeTypesPaths:
      value.committeeTypes == null
        ? value.committeeTypes
        : value.committeeTypes.map((_, index) => `${sourcePath}/committeeTypes/${index}`),
    scrutinisingDepartmentsPaths:
      value.scrutinisingDepartments == null
        ? value.scrutinisingDepartments
        : value.scrutinisingDepartments.map(
            (_, index) => `${sourcePath}/scrutinisingDepartments/${index}`,
          ),
    nameHistoryPaths:
      value.nameHistory == null
        ? value.nameHistory
        : value.nameHistory.map((_, index) => `${sourcePath}/nameHistory/${index}`),
  });
  entities.push(node);
  if (value.contact != null)
    visitContactInformation(value.contact, `${sourcePath}/contact`, entities);
  if (value.parentCommittee != null)
    visitCommitteeSummary(value.parentCommittee, `${sourcePath}/parentCommittee`, entities);
  value.subCommittees?.forEach((item, index) => {
    visitCommitteeSummary(item, `${sourcePath}/subCommittees/${index}`, entities);
  });
  if (value.leadHouse != null) visitLeadHouse(value.leadHouse, `${sourcePath}/leadHouse`, entities);
  if (value.category != null)
    visitCommitteeCategory(value.category, `${sourcePath}/category`, entities);
  value.committeeTypes?.forEach((item, index) => {
    visitCommitteeType(item, `${sourcePath}/committeeTypes/${index}`, entities);
  });
  value.scrutinisingDepartments?.forEach((item, index) => {
    visitScrutinisingDepartment(item, `${sourcePath}/scrutinisingDepartments/${index}`, entities);
  });
  value.nameHistory?.forEach((item, index) => {
    visitCommitteeName(item, `${sourcePath}/nameHistory/${index}`, entities);
  });
}
function visitLeadHouse(
  value: LeadHouseRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = LeadHouseNodeSchema.parse({ ...value, kind: 'LeadHouse', sourcePath });
  entities.push(node);
}
function visitCommitteeCategory(
  value: CommitteeCategoryRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = CommitteeCategoryNodeSchema.parse({
    ...value,
    kind: 'CommitteeCategory',
    sourcePath,
  });
  entities.push(node);
}
function visitCommitteeType(
  value: CommitteeTypeRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = CommitteeTypeNodeSchema.parse({
    ...value,
    kind: 'CommitteeType',
    sourcePath,
    committeeCategoryPath:
      value.committeeCategory == null ? value.committeeCategory : `${sourcePath}/committeeCategory`,
  });
  entities.push(node);
  if (value.committeeCategory != null)
    visitCommitteeCategory(value.committeeCategory, `${sourcePath}/committeeCategory`, entities);
}
function visitScrutinisingDepartment(
  value: ScrutinisingDepartmentRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = ScrutinisingDepartmentNodeSchema.parse({
    ...value,
    kind: 'ScrutinisingDepartment',
    sourcePath,
  });
  entities.push(node);
}
function visitCommitteeName(
  value: CommitteeNameRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = CommitteeNameNodeSchema.parse({ ...value, kind: 'CommitteeName', sourcePath });
  entities.push(node);
}
function visitBanner(value: BannerRaw, sourcePath: string, entities: CommitteeEntity[]): void {
  const node = BannerNodeSchema.parse({
    ...value,
    kind: 'Banner',
    sourcePath,
    desktopBannerPath:
      value.desktopBanner == null ? value.desktopBanner : `${sourcePath}/desktopBanner`,
    mobileBannerPath:
      value.mobileBanner == null ? value.mobileBanner : `${sourcePath}/mobileBanner`,
  });
  entities.push(node);
  if (value.desktopBanner != null)
    visitFile(value.desktopBanner, `${sourcePath}/desktopBanner`, entities);
  if (value.mobileBanner != null)
    visitFile(value.mobileBanner, `${sourcePath}/mobileBanner`, entities);
}
function visitContentLink(
  value: ContentLinkRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = ContentLinkNodeSchema.parse({ ...value, kind: 'ContentLink', sourcePath });
  entities.push(node);
}
function visitMemberInfo(
  value: MemberInfoRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = MemberInfoNodeSchema.parse({ ...value, kind: 'MemberInfo', sourcePath });
  entities.push(node);
}
function visitCommitteeMemberRole(
  value: CommitteeMemberRoleRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = CommitteeMemberRoleNodeSchema.parse({
    ...value,
    kind: 'CommitteeMemberRole',
    sourcePath,
    rolePath: value.role == null ? value.role : `${sourcePath}/role`,
  });
  entities.push(node);
  if (value.role != null) visitRole(value.role, `${sourcePath}/role`, entities);
}
function visitCommitteeBusinessType(
  value: CommitteeBusinessTypeRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = CommitteeBusinessTypeNodeSchema.parse({
    ...value,
    kind: 'CommitteeBusinessType',
    sourcePath,
  });
  entities.push(node);
}
function visitPublicationSummary(
  value: PublicationSummaryRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = PublicationSummaryNodeSchema.parse({
    ...value,
    kind: 'PublicationSummary',
    sourcePath,
    governmentResponsesPath:
      value.governmentResponses == null
        ? value.governmentResponses
        : `${sourcePath}/governmentResponses`,
    documentsPaths:
      value.documents == null
        ? value.documents
        : value.documents.map((_, index) => `${sourcePath}/documents/${index}`),
    hcNumberPath: value.hcNumber == null ? value.hcNumber : `${sourcePath}/hcNumber`,
    hlPaperPath: value.hlPaper == null ? value.hlPaper : `${sourcePath}/hlPaper`,
    typePath: value.type == null ? value.type : `${sourcePath}/type`,
    respondingDepartmentPath:
      value.respondingDepartment == null
        ? value.respondingDepartment
        : `${sourcePath}/respondingDepartment`,
  });
  entities.push(node);
  if (value.governmentResponses != null)
    visitGovernmentResponse(
      value.governmentResponses,
      `${sourcePath}/governmentResponses`,
      entities,
    );
  value.documents?.forEach((item, index) => {
    visitDocument(
      item,
      `${sourcePath}/documents/${index}`,
      entities,
      publicationDocumentRoute(value.id, item.documentId),
    );
  });
  if (value.hcNumber != null) visitHouseNumber(value.hcNumber, `${sourcePath}/hcNumber`, entities);
  if (value.hlPaper != null) visitHouseNumber(value.hlPaper, `${sourcePath}/hlPaper`, entities);
  if (value.type != null) visitPublicationType(value.type, `${sourcePath}/type`, entities);
  if (value.respondingDepartment != null)
    visitDepartment(value.respondingDepartment, `${sourcePath}/respondingDepartment`, entities);
}
function visitSubmissionPeriodSummary(
  value: SubmissionPeriodSummaryRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = SubmissionPeriodSummaryNodeSchema.parse({
    ...value,
    kind: 'SubmissionPeriodSummary',
    sourcePath,
  });
  entities.push(node);
}
function visitActivitySummary(
  value: ActivitySummaryRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = ActivitySummaryNodeSchema.parse({
    ...value,
    kind: 'ActivitySummary',
    sourcePath,
    attendeesPaths:
      value.attendees == null
        ? value.attendees
        : value.attendees.map((_, index) => `${sourcePath}/attendees/${index}`),
  });
  entities.push(node);
  value.attendees?.forEach((item, index) => {
    visitActivityPerson(item, `${sourcePath}/attendees/${index}`, entities);
  });
}
function visitLinks(value: LinksRaw, sourcePath: string, entities: CommitteeEntity[]): void {
  const node = LinksNodeSchema.parse({ ...value, kind: 'Links', sourcePath });
  entities.push(node);
}
function visitHouseNumber(
  value: HouseNumberRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = HouseNumberNodeSchema.parse({ ...value, kind: 'HouseNumber', sourcePath });
  entities.push(node);
}
function visitGovernmentResponse(
  value: GovernmentResponseRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = GovernmentResponseNodeSchema.parse({
    ...value,
    kind: 'GovernmentResponse',
    sourcePath,
    publicationPaths:
      value.publication == null
        ? value.publication
        : value.publication.map((_, index) => `${sourcePath}/publication/${index}`),
  });
  entities.push(node);
  value.publication?.forEach((item, index) => {
    visitPublicationSummary(item, `${sourcePath}/publication/${index}`, entities);
  });
}
/** Committees API document route prefix; a file's fileDataFormat completes it. */
function publicationDocumentRoute(publicationId: number, documentId: number): string {
  return `/api/Publications/${publicationId}/Document/${documentId}`;
}
/** Evidence files are addressed by the evidence ID, not the document ID. */
function evidenceDocumentRoute(
  route: 'WrittenEvidence' | 'OralEvidence',
  evidenceId: number,
): string {
  return `/api/${route}/${evidenceId}/Document`;
}
function visitDocument(
  value: DocumentRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
  documentRoute: string,
): void {
  const node = DocumentNodeSchema.parse({
    ...value,
    kind: 'Document',
    sourcePath,
    filesPaths:
      value.files == null
        ? value.files
        : value.files.map((_, index) => `${sourcePath}/files/${index}`),
  });
  entities.push(node);
  value.files?.forEach((item, index) => {
    visitDocumentFile(item, `${sourcePath}/files/${index}`, entities, documentRoute);
  });
}
function visitPublicationType(
  value: PublicationTypeRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = PublicationTypeNodeSchema.parse({ ...value, kind: 'PublicationType', sourcePath });
  entities.push(node);
}
function visitDepartment(
  value: DepartmentRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = DepartmentNodeSchema.parse({
    ...value,
    kind: 'Department',
    sourcePath,
    addressPath: value.address == null ? value.address : `${sourcePath}/address`,
  });
  entities.push(node);
  if (value.address != null) visitAddress(value.address, `${sourcePath}/address`, entities);
}
function visitCommitteeBusinessSummary(
  value: CommitteeBusinessSummaryRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = CommitteeBusinessSummaryNodeSchema.parse({
    ...value,
    kind: 'CommitteeBusinessSummary',
    sourcePath,
    typePath: value.type == null ? value.type : `${sourcePath}/type`,
    latestReportPath:
      value.latestReport == null ? value.latestReport : `${sourcePath}/latestReport`,
    openSubmissionPeriodsPaths:
      value.openSubmissionPeriods == null
        ? value.openSubmissionPeriods
        : value.openSubmissionPeriods.map(
            (_, index) => `${sourcePath}/openSubmissionPeriods/${index}`,
          ),
    closedSubmissionPeriodsPaths:
      value.closedSubmissionPeriods == null
        ? value.closedSubmissionPeriods
        : value.closedSubmissionPeriods.map(
            (_, index) => `${sourcePath}/closedSubmissionPeriods/${index}`,
          ),
    nextOralEvidenceSessionPath:
      value.nextOralEvidenceSession == null
        ? value.nextOralEvidenceSession
        : `${sourcePath}/nextOralEvidenceSession`,
    contactPath: value.contact == null ? value.contact : `${sourcePath}/contact`,
  });
  entities.push(node);
  if (value.type != null) visitCommitteeBusinessType(value.type, `${sourcePath}/type`, entities);
  if (value.latestReport != null)
    visitPublicationSummary(value.latestReport, `${sourcePath}/latestReport`, entities);
  value.openSubmissionPeriods?.forEach((item, index) => {
    visitSubmissionPeriodSummary(item, `${sourcePath}/openSubmissionPeriods/${index}`, entities);
  });
  value.closedSubmissionPeriods?.forEach((item, index) => {
    visitSubmissionPeriodSummary(item, `${sourcePath}/closedSubmissionPeriods/${index}`, entities);
  });
  if (value.nextOralEvidenceSession != null)
    visitActivitySummary(
      value.nextOralEvidenceSession,
      `${sourcePath}/nextOralEvidenceSession`,
      entities,
    );
  if (value.contact != null)
    visitContactInformation(value.contact, `${sourcePath}/contact`, entities);
}
function visitFile(value: FileRaw, sourcePath: string, entities: CommitteeEntity[]): void {
  const node = FileNodeSchema.parse({ ...value, kind: 'File', sourcePath });
  entities.push(node);
}
function visitRole(value: RoleRaw, sourcePath: string, entities: CommitteeEntity[]): void {
  const node = RoleNodeSchema.parse({
    ...value,
    kind: 'Role',
    sourcePath,
    roleTypePath: value.roleType == null ? value.roleType : `${sourcePath}/roleType`,
  });
  entities.push(node);
  if (value.roleType != null) visitRoleType(value.roleType, `${sourcePath}/roleType`, entities);
}
function visitActivityPerson(
  value: ActivityPersonRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = ActivityPersonNodeSchema.parse({
    ...value,
    kind: 'ActivityPerson',
    sourcePath,
    memberInfoPath: value.memberInfo == null ? value.memberInfo : `${sourcePath}/memberInfo`,
    organisationsPaths:
      value.organisations == null
        ? value.organisations
        : value.organisations.map((_, index) => `${sourcePath}/organisations/${index}`),
  });
  entities.push(node);
  if (value.memberInfo != null)
    visitMemberInfo(value.memberInfo, `${sourcePath}/memberInfo`, entities);
  value.organisations?.forEach((item, index) => {
    visitOrganisation(item, `${sourcePath}/organisations/${index}`, entities);
  });
}
function visitDocumentFile(
  value: DocumentFileRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
  documentRoute: string,
): void {
  const node = DocumentFileNodeSchema.parse({
    ...value,
    kind: 'DocumentFile',
    sourcePath,
    ...(value.fileDataFormat == null
      ? {}
      : { apiRoute: `${documentRoute}/${encodeURIComponent(value.fileDataFormat)}` }),
    documentPurposePath:
      value.documentPurpose == null ? value.documentPurpose : `${sourcePath}/documentPurpose`,
  });
  entities.push(node);
  if (value.documentPurpose != null)
    visitDocumentPurpose(value.documentPurpose, `${sourcePath}/documentPurpose`, entities);
}
function visitAddress(value: AddressRaw, sourcePath: string, entities: CommitteeEntity[]): void {
  const node = AddressNodeSchema.parse({ ...value, kind: 'Address', sourcePath });
  entities.push(node);
}
function visitRoleType(value: RoleTypeRaw, sourcePath: string, entities: CommitteeEntity[]): void {
  const node = RoleTypeNodeSchema.parse({ ...value, kind: 'RoleType', sourcePath });
  entities.push(node);
}
function visitOrganisation(
  value: OrganisationRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = OrganisationNodeSchema.parse({ ...value, kind: 'Organisation', sourcePath });
  entities.push(node);
}
function visitDocumentPurpose(
  value: DocumentPurposeRaw,
  sourcePath: string,
  entities: CommitteeEntity[],
): void {
  const node = DocumentPurposeNodeSchema.parse({ ...value, kind: 'DocumentPurpose', sourcePath });
  entities.push(node);
}
/** Normalize a complete committee without dropping recursive source metadata. */
export function normalizeCommitteeDetails(
  value: CommitteeDetailsRaw,
): z.infer<typeof CommitteeRecordSchema> {
  const entities: CommitteeEntity[] = [];
  visitCommitteeDetails(value, '', entities);
  return { recordId: String(value.id), recordType: 'committee', rootPath: '', entities };
}
/** Normalize a complete committee without dropping recursive source metadata. */
export function normalizeCommitteeSummary(
  value: CommitteeSummaryRaw,
): z.infer<typeof CommitteeRecordSchema> {
  const entities: CommitteeEntity[] = [];
  visitCommitteeSummary(value, '', entities);
  return { recordId: String(value.id), recordType: 'committee', rootPath: '', entities };
}
/** Normalize a complete membership without dropping recursive source metadata. */
export function normalizeCommitteeMember(
  value: CommitteeMemberRaw,
): z.infer<typeof CommitteeRecordSchema> {
  const entities: CommitteeEntity[] = [];
  visitCommitteeMember(value, '', entities);
  return {
    recordId: String(value.id),
    recordType: 'membership',
    rootPath: '',
    entities,
    ...(value.memberInfo ? { memberId: String(value.memberInfo.mnisId) } : {}),
  };
}
/** Normalize a complete business without dropping recursive source metadata. */
export function normalizeCommitteeBusinessDetails(
  value: CommitteeBusinessDetailsRaw,
): z.infer<typeof CommitteeRecordSchema> {
  const entities: CommitteeEntity[] = [];
  visitCommitteeBusinessDetails(value, '', entities);
  return { recordId: String(value.id), recordType: 'business', rootPath: '', entities };
}
/** Normalize a complete business without dropping recursive source metadata. */
export function normalizeCommitteeBusinessSummary(
  value: CommitteeBusinessSummaryRaw,
): z.infer<typeof CommitteeRecordSchema> {
  const entities: CommitteeEntity[] = [];
  visitCommitteeBusinessSummary(value, '', entities);
  return { recordId: String(value.id), recordType: 'business', rootPath: '', entities };
}
/** Normalize a complete publication without dropping recursive source metadata. */
export function normalizePublication(value: PublicationRaw): z.infer<typeof CommitteeRecordSchema> {
  const entities: CommitteeEntity[] = [];
  visitPublication(value, '', entities);
  return { recordId: String(value.id), recordType: 'publication', rootPath: '', entities };
}

function evidenceRelationships(value: z.infer<typeof EvidenceRawSchema>) {
  return {
    sourcePath: '',
    documentPath: value.document == null ? value.document : '/document',
    witnessesPaths:
      value.witnesses == null
        ? value.witnesses
        : value.witnesses.map((_, index) => `/witnesses/${index}`),
    committeesPaths:
      value.committees == null
        ? value.committees
        : value.committees.map((_, index) => `/committees/${index}`),
  };
}
function visitEvidenceRelationships(
  value: z.infer<typeof EvidenceRawSchema>,
  entities: CommitteeEntity[],
  documentRoute: string,
): void {
  value.witnesses?.forEach((witness, index) => {
    const sourcePath = `/witnesses/${index}`;
    entities.push(
      SubmitterNodeSchema.parse({
        ...witness,
        kind: 'Submitter',
        sourcePath,
        memberInfoPath:
          witness.memberInfo == null ? witness.memberInfo : `${sourcePath}/memberInfo`,
        organisationsPaths:
          witness.organisations == null
            ? witness.organisations
            : witness.organisations.map(
                (_, organisationIndex) => `${sourcePath}/organisations/${organisationIndex}`,
              ),
      }),
    );
    if (witness.memberInfo != null)
      visitMemberInfo(witness.memberInfo, `${sourcePath}/memberInfo`, entities);
    witness.organisations?.forEach((organisation, organisationIndex) => {
      visitOrganisation(organisation, `${sourcePath}/organisations/${organisationIndex}`, entities);
    });
  });
  if (value.document != null) visitDocument(value.document, '/document', entities, documentRoute);
  value.committees?.forEach((committee, index) => {
    visitCommitteeSummary(committee, `/committees/${index}`, entities);
  });
}
/** Normalize written submissions through the same recursive committee graph machinery. */
export function normalizeWrittenEvidence(
  value: z.infer<typeof WrittenEvidenceRawSchema>,
): z.infer<typeof CommitteeRecordSchema> {
  const entities: CommitteeEntity[] = [
    WrittenEvidenceNodeSchema.parse({
      ...value,
      ...evidenceRelationships(value),
      kind: 'WrittenEvidence',
      committeeBusinessPath:
        value.committeeBusiness == null ? value.committeeBusiness : '/committeeBusiness',
      hcNumberPath: value.hcNumber == null ? value.hcNumber : '/hcNumber',
    }),
  ];
  visitEvidenceRelationships(value, entities, evidenceDocumentRoute('WrittenEvidence', value.id));
  if (value.committeeBusiness != null)
    visitCommitteeBusinessSummary(value.committeeBusiness, '/committeeBusiness', entities);
  if (value.hcNumber != null) visitHouseNumber(value.hcNumber, '/hcNumber', entities);
  return { recordId: String(value.id), recordType: 'written_evidence', rootPath: '', entities };
}
/** Normalize oral sessions, retaining each related business and its recursive metadata. */
export function normalizeOralEvidence(
  value: z.infer<typeof OralEvidenceRawSchema>,
): z.infer<typeof CommitteeRecordSchema> {
  const entities: CommitteeEntity[] = [
    OralEvidenceNodeSchema.parse({
      ...value,
      ...evidenceRelationships(value),
      kind: 'OralEvidence',
      committeeBusinessesPaths:
        value.committeeBusinesses == null
          ? value.committeeBusinesses
          : value.committeeBusinesses.map((_, index) => `/committeeBusinesses/${index}`),
      hcNumbersPaths:
        value.hcNumbers == null
          ? value.hcNumbers
          : value.hcNumbers.map((_, index) => `/hcNumbers/${index}`),
    }),
  ];
  visitEvidenceRelationships(value, entities, evidenceDocumentRoute('OralEvidence', value.id));
  value.committeeBusinesses?.forEach((business, index) => {
    visitCommitteeBusinessSummary(business, `/committeeBusinesses/${index}`, entities);
  });
  value.hcNumbers?.forEach((paper, index) => {
    visitHouseNumber(paper, `/hcNumbers/${index}`, entities);
  });
  return { recordId: String(value.id), recordType: 'oral_evidence', rootPath: '', entities };
}
