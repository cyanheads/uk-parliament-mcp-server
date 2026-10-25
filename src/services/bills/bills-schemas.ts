/**
 * @fileoverview Explicit Bills API records and normalized public schemas.
 * @module services/bills/bills-schemas
 */
import { z } from '@cyanheads/mcp-ts-core';
import { DeliveryShape } from '../parliament-http/parliament-delivery.js';
import { LinkSchema, PageSchema, SourceSchema } from '../parliament-http/parliament-models.js';

function models<T extends z.ZodType>(id: T, house: z.ZodType<string>) {
  const text = z.string().nullish();
  const integer = z.number().int().nullish();
  const member = z
    .object({
      memberId: id.describe('Members API identifier.'),
      name: text.describe('Published name.'),
      party: text.describe('Party name.'),
      partyColour: text.describe('Party colour.'),
      house: house.nullish().describe('Source House.'),
      memberPhoto: text.describe('Published photograph URL.'),
      memberPage: text.describe('Published member URL.'),
      memberFrom: text.describe('Constituency or membership basis.'),
      sortOrder: integer.describe('Source order.'),
      isLead: z.boolean().nullish().describe('Lead sponsor flag.'),
    })
    .describe('One published member sponsor.');
  const sitting = z
    .object({
      id: id.describe('Sitting ID.'),
      stageId: id.nullish().describe('Reference stage ID.'),
      billStageId: id.nullish().describe('Bill-specific stage ID.'),
      billId: id.nullish().describe('Bill ID.'),
      date: text.describe('Source sitting date.'),
    })
    .describe('One complete stage sitting.');
  const stage = z.object({
    id: id.describe('Bill-specific stage occurrence ID.'),
    stageId: id.nullish().describe('Reference stage ID.'),
    sessionId: id.nullish().describe('Session ID.'),
    description: text.describe('Stage description.'),
    abbreviation: text.describe('Stage abbreviation.'),
    house: house.nullish().describe('Source House including Unassigned.'),
    stageSittings: z.array(sitting).nullish().describe('All supplied stage sittings.'),
    sortOrder: integer.describe('Source stage order.'),
  });
  const committee = z.object({
    id: id.describe('Committee ID.'),
    name: text.describe('Committee name.'),
    category: text.describe('Committee category.'),
    house: house.nullish().describe('Source House.'),
    url: text.describe('Published committee URL.'),
  });
  const stageDetail = stage.extend({
    committee: committee.nullish().describe('Associated committee.'),
    nextStageBillStageId: id.nullish().describe('Next stage occurrence ID.'),
    previousStageBillStageId: id.nullish().describe('Previous stage occurrence ID.'),
    lastUpdate: text.describe('Last update timestamp.'),
    hasMotions: z.boolean().nullish().describe('Source motion availability flag.'),
  });
  const bill = z.object({
    billId: id.describe('Bill identifier.'),
    shortTitle: text.describe('Short title.'),
    formerShortTitle: text.describe('Former short title.'),
    currentHouse: house.nullish().describe('Current source House.'),
    originatingHouse: house.nullish().describe('Originating source House.'),
    lastUpdate: text.describe('Last update timestamp.'),
    billWithdrawn: text.describe('Withdrawal date.'),
    isDefeated: z.boolean().nullish().describe('Defeated flag.'),
    billTypeId: id.nullish().describe('Reference bill type ID.'),
    introducedSessionId: id.nullish().describe('Introduction session ID.'),
    includedSessionIds: z.array(id).nullish().describe('All included session IDs.'),
    isAct: z.boolean().nullish().describe('Explicit enacted flag.'),
    currentStage: stage.nullish().describe('Current stage summary, not full history.'),
  });
  const organisation = z.object({
    name: text.describe('Organisation name.'),
    url: text.describe('Organisation URL.'),
  });
  const billDetail = bill.extend({
    longTitle: text.describe('Complete long title.'),
    summary: text.describe('Complete supplied summary.'),
    sponsors: z
      .array(
        z
          .object({
            member: member.nullish().describe('Member sponsor.'),
            organisation: organisation.nullish().describe('Organisation sponsor.'),
            sortOrder: integer.describe('Sponsor order.'),
          })
          .describe('One published bill sponsor.'),
      )
      .nullish()
      .describe('All sponsors.'),
    promoters: z
      .array(
        z
          .object({
            organisationName: text.describe('Promoter name.'),
            organisationUrl: text.describe('Promoter URL.'),
          })
          .describe('One published promoter.'),
      )
      .nullish()
      .describe('All promoters.'),
    petitioningPeriod: text.describe('Petition period.'),
    petitionInformation: text.describe('Petition information.'),
    agent: z
      .object({
        name: text.describe('Agent name.'),
        address: text.describe('Agent address.'),
        phoneNo: text.describe('Agent phone.'),
        email: text.describe('Agent email.'),
        website: text.describe('Agent website.'),
      })
      .nullish()
      .describe('Published bill agent.'),
  });
  const line = z
    .object({
      text: text.describe('Complete source text or HTML.'),
      indentation: integer.describe('Source indentation.'),
      hangingIndentation: text.describe('Numbered or hanging prefix.'),
      isImage: z.boolean().nullish().describe('Image flag.'),
      imageType: text.describe('Image format.'),
    })
    .describe('One complete amendment text line.');
  const decision = z.object({
    id: id.describe('Generic source ID; amendment summaries may use zero.'),
    billId: id.nullish().describe('Parent bill ID.'),
    billStageId: id.nullish().describe('Parent stage occurrence ID.'),
    statusIndicator: text.describe('Status indicator.'),
    decision: text.describe('Source decision.'),
    decisionExplanation: text.describe('Complete decision explanation.'),
    sponsors: z.array(member).nullish().describe('All sponsors.'),
  });
  const amendment = decision.extend({
    amendmentId: id.describe('Retrieval identifier; use this rather than generic id.'),
    amendmentType: text.describe('Amendment type.'),
    clause: integer.describe('Clause number.'),
    schedule: integer.describe('Schedule number.'),
    pageNumber: integer.describe('Page number.'),
    lineNumber: integer.describe('Line number.'),
    amendmentPosition: text.describe('Source position.'),
    marshalledListText: text.describe('Marshalled identifier.'),
    dNum: text.describe('Source drafting identifier.'),
    summaryText: z.array(z.string()).nullish().describe('Complete summary lines.'),
  });
  const amendmentDetail = amendment.extend({
    amendmentLines: z.array(line).nullish().describe('All complete numbered amendment lines.'),
    explanatoryTextPrefix: text.describe('Explanatory prefix.'),
    explanatoryText: text.describe('Complete explanatory HTML.'),
    amendmentNote: text.describe('Amendment note.'),
    amendmentLocation: text.describe('Location text.'),
    mainHeader: text.describe('Main header.'),
  });
  const related = z
    .object({
      number: text.describe('Related amendment number.'),
      decision: text.describe('Related decision.'),
      sortOrder: integer.describe('Source order.'),
      text: z.array(line).nullish().describe('Complete related amendment lines.'),
      sponsors: z.array(member).nullish().describe('All related sponsors.'),
    })
    .describe('One related amendment.');
  const group = z
    .object({
      text: z.array(line).nullish().describe('Complete group text.'),
      amendments: z.array(related).nullish().describe('All related amendments.'),
      sortOrder: integer.describe('Group order.'),
    })
    .describe('One complete motion or amendment group.');
  const motionSummary = decision.extend({
    type: text.describe('Source ping-pong type.'),
    number: text.describe('Motion number.'),
    summary: text.describe('Complete summary.'),
    matchingText: text.describe('Source matching text.'),
  });
  const motion = motionSummary.extend({
    motionGroups: z.array(group).nullish().describe('All complete motion groups.'),
    amendmentGroups: z.array(group).nullish().describe('All complete amendment groups.'),
  });
  const pingpong = z
    .object({
      type: z.string().describe('Motion or Amendment source type.'),
      motion: motion.nullish().describe('Motion branch when supplied.'),
      amendment: motion.nullish().describe('Amendment branch when supplied.'),
    })
    .refine(
      (item) =>
        item.type === 'Motion'
          ? item.motion != null && item.amendment == null
          : item.type === 'Amendment' && item.amendment != null && item.motion == null,
      'Ping-pong type must identify exactly one populated branch.',
    );
  const normalizedGroup = z
    .object({
      text: z.array(line).nullish().describe('Complete group text.'),
      sortOrder: integer.describe('Source group order.'),
      amendmentIndices: z
        .array(z.number().int().nonnegative().describe('Index into relatedAmendments.'))
        .nullish()
        .describe(
          'Related amendment indices in original order; preserves null or absent collections.',
        ),
    })
    .describe('One complete group with explicit related amendment associations.');
  const normalizedMotion = motionSummary.extend({
    itemKind: z.string().describe('Original Motion or Amendment wrapper type.'),
    motionGroups: z.array(normalizedGroup).nullish().describe('Complete motion groups.'),
    amendmentGroups: z.array(normalizedGroup).nullish().describe('Complete amendment groups.'),
    relatedAmendments: z
      .array(
        related
          .extend({
            groupKind: z
              .enum(['motionGroups', 'amendmentGroups'])
              .describe('Source group collection.'),
            groupIndex: z.number().int().nonnegative().describe('Zero-based parent group index.'),
            amendmentIndex: z
              .number()
              .int()
              .nonnegative()
              .describe('Zero-based position within the original parent group.'),
          })
          .describe('One complete related amendment and its parent association.'),
      )
      .optional()
      .describe('All related amendments, retaining group membership and source order.'),
  });
  const publication = z.object({
    id: id.describe('Publication ID.'),
    title: text.describe('Publication title.'),
    house: house.nullish().describe('Source House including Unassigned.'),
    publicationType: z
      .object({
        id: id.describe('Publication type ID.'),
        name: text.describe('Type name.'),
        description: text.describe('Type description.'),
      })
      .nullish()
      .describe('Publication type.'),
    displayDate: text.describe('Source display date.'),
    links: z
      .array(
        z
          .object({
            id: id.describe('Published link ID.'),
            title: text.describe('Link title.'),
            url: text.describe('Actual published URL.'),
            contentType: text.describe('Published media type.'),
          })
          .describe('One published source link.'),
      )
      .nullish()
      .describe('Every published link.'),
    files: z
      .array(
        z
          .object({
            id: id.describe('Document ID.'),
            filename: text.describe('Filename.'),
            contentType: text.describe('Media type.'),
            contentLength: integer.describe('Published size in bytes.'),
            downloadUrl: text.describe('Actual published download URL.'),
          })
          .describe('One published document file.'),
      )
      .nullish()
      .describe('Every published document.'),
  });
  const reference = z.object({
    id: id.describe('Reference ID.'),
    name: text.describe('Reference name.'),
    description: text.describe('Reference description.'),
    house: house.nullish().describe('Reference source House.'),
    category: text.describe('Bill type category.'),
  });
  return {
    bill,
    billDetail,
    stage,
    stageDetail,
    amendment,
    amendmentDetail,
    pingpong,
    motion,
    motionSummary,
    normalizedMotion,
    publication,
    reference,
  };
}
/** Raw API schemas tolerate new properties while validating every retained field. */
export const RawBills = models(z.number().int().nonnegative().max(2147483647), z.string());
/** Public records use decimal string IDs and retain every supplied House value. */
export const Bills = models(z.string().regex(/^[0-9]+$/), z.string());
/** Normalize only declared identifier/House fields, preserving text, nulls and zero source IDs. */
export function normalizeBillValue(value: unknown, key = ''): unknown {
  if (Array.isArray(value))
    return value.map((item) =>
      normalizeBillValue(item, key === 'includedSessionIds' ? 'sessionId' : ''),
    );
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.hasOwn(value, 'type') &&
    (Object.hasOwn(value, 'motion') || Object.hasOwn(value, 'amendment'))
  ) {
    const selected = Reflect.get(value, 'motion') ?? Reflect.get(value, 'amendment');
    if (selected === null || typeof selected !== 'object')
      throw new Error('A validated ping-pong item must supply its selected branch.');
    const relatedAmendments: object[] = [];
    const normalized = Object.fromEntries(
      Object.entries(selected).map(([field, item]) => {
        if (!['motionGroups', 'amendmentGroups'].includes(field) || !Array.isArray(item))
          return [field, normalizeBillValue(item, field)];
        return [
          field,
          item.map((group: Record<string, unknown>, groupIndex: number) => {
            const { amendments, ...metadata } = group;
            const amendmentIndices = Array.isArray(amendments)
              ? amendments.map((amendment: Record<string, unknown>, amendmentIndex: number) => {
                  const index = relatedAmendments.length;
                  relatedAmendments.push({
                    ...Object.fromEntries(
                      Object.entries(amendment).map(([child, entry]) => [
                        child,
                        normalizeBillValue(entry, child),
                      ]),
                    ),
                    groupKind: field,
                    groupIndex,
                    amendmentIndex,
                  });
                  return index;
                })
              : amendments;
            return {
              ...Object.fromEntries(
                Object.entries(metadata).map(([child, entry]) => [
                  child,
                  normalizeBillValue(entry, child),
                ]),
              ),
              ...(amendments !== undefined ? { amendmentIndices } : {}),
            };
          }),
        ];
      }),
    );
    return {
      itemKind: Reflect.get(value, 'type'),
      ...normalized,
      ...(['motionGroups', 'amendmentGroups'].some((field) => Object.hasOwn(selected, field))
        ? { relatedAmendments }
        : {}),
    };
  }
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([field, item]) => [field, normalizeBillValue(item, field)]),
    );
  if (typeof value === 'number' && (key === 'id' || key.endsWith('Id'))) return String(value);
  if (typeof value === 'string' && ['house', 'currentHouse', 'originatingHouse'].includes(key))
    return value.toLowerCase();
  return value;
}
/** Common paged Bills wrapper; null items are explicitly permitted by the API contract. */
export function billsPage<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item).nullable(),
    totalResults: z.number().int().nonnegative(),
    itemsPerPage: z.number().int().nonnegative(),
  });
}
/** Bill selector names. */
export const BillSectionSchema = z.enum([
  'overview',
  'stages',
  'stage',
  'publications',
  'amendments',
  'amendment',
  'motions',
  'motion',
]);
/** Explicit statute handoff based solely on supplied publication URLs. */
export const LegislationHandoffSchema = z.object({
  status: z
    .enum(['not_enacted', 'authoritative_link', 'unavailable'])
    .describe('Verified handoff state.'),
  links: z
    .array(LinkSchema.describe('One actual authoritative statute link.'))
    .describe('Actual authoritative statute links.'),
  reason: z.string().optional().describe('Why an authoritative link is unavailable.'),
});
/** Bill summary with provenance and explicit completeness. */
export const BillHitSchema = Bills.bill
  .extend({
    source: SourceSchema.describe('Official request provenance.'),
    detailLevel: z
      .literal('summary')
      .describe('Search summary; retrieve selected detail separately.'),
  })
  .describe('One bill summary and its provenance.');
/** All typed selected Bills records. */
export const BillRecordSchema = z.union([
  Bills.billDetail.strict().describe('Complete bill overview.'),
  Bills.stageDetail.strict().describe('Complete stage occurrence.'),
  Bills.amendmentDetail.strict().describe('Complete amendment detail.'),
  Bills.normalizedMotion.strict().describe('Complete ping-pong item with its source wrapper type.'),
]);
/** All typed selected Bills collection rows. */
export const BillItemSchema = z
  .union([
    Bills.stage.strict().describe('One stage occurrence.'),
    Bills.publication.strict().describe('One complete publication.'),
    Bills.amendment.strict().describe('One amendment summary.'),
    Bills.motionSummary
      .extend({
        itemKind: z.string().describe('Original wrapper type identifying Motion or Amendment.'),
      })
      .strict()
      .describe('One ping-pong summary with its source wrapper type.'),
  ])
  .describe('One complete selected collection item.');
/** Flat portable get_bill output, including recursive delivery. */
export const GetBillOutputSchema = z.object({
  ...DeliveryShape,
  found: z.boolean().optional().describe('Whether the selected entity exists.'),
  section: BillSectionSchema.optional().describe('Selected bill section.'),
  billId: z.string().optional().describe('Parent bill ID.'),
  record: BillRecordSchema.optional().describe('Complete selected record.'),
  items: z.array(BillItemSchema).optional().describe('Whole selected collection records.'),
  page: PageSchema.optional().describe('Actual emitted collection continuation.'),
  source: SourceSchema.optional().describe('Selected request provenance.'),
  detailLevel: z.enum(['summary', 'complete']).optional().describe('Selected source completeness.'),
  legislationHandoff: LegislationHandoffSchema.optional().describe(
    'Authoritative statute handoff.',
  ),
  guidance: z.string().optional().describe('Same-server recovery for an entity miss.'),
});
