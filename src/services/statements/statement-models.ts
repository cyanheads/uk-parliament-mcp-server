/**
 * @fileoverview Written ministerial statement source wrappers and the flat public statement record.
 * @module services/statements/statement-models
 */
import { z } from '@cyanheads/mcp-ts-core';

const HouseValueSchema = z.enum(['Bicameral', 'Commons', 'Lords']);
const AttachmentSchema = z.object({
  url: z.string().nullish().describe('Published file link; not downloaded.'),
  title: z.string().nullish().describe('Attachment title.'),
  fileType: z.string().nullish().describe('Published file type.'),
  fileSizeBytes: z.number().int().nonnegative().optional().describe('Published size in bytes.'),
});
/** Source StatementsViewModel; flags the arrays already answer, member sub-fields and wrapper links are stripped. */
const RawStatementSchema = z.object({
  id: z.number().int().positive(),
  memberId: z.number().int().positive(),
  member: z.object({ name: z.string().nullish() }).nullish(),
  memberRole: z.string().nullish(),
  uin: z.string().nullish(),
  dateMade: z.string(),
  answeringBodyId: z.number().int().positive(),
  answeringBodyName: z.string().nullish(),
  title: z.string().nullish(),
  text: z.string().nullish(),
  house: HouseValueSchema,
  noticeNumber: z.number().int(),
  linkedStatements: z
    .array(
      z.object({
        linkedStatementId: z.number().int().positive(),
        linkType: z.string(),
        linkDate: z.string().nullish(),
      }),
    )
    .nullish(),
  attachments: z.array(AttachmentSchema).nullish(),
});
type RawStatement = z.infer<typeof RawStatementSchema>;
/** Validated singular wrapper; its self link only restates the ID and is not retained. */
export const StatementItemSchema = z.object({ value: RawStatementSchema });
/** Validated search response; a missing collection is not silently treated as empty. */
export const StatementSearchSchema = z.object({
  totalResults: z.number().int().nonnegative(),
  results: z.array(StatementItemSchema),
});

/**
 * Flat public statement record; request provenance lives on the payload `source`.
 * `record` and `items[]` reference its single `$defs` entry.
 */
export const StatementRecordSchema = z
  .object({
    statementId: z.string().describe('Decimal statement ID for mode=detail; not the UIN.'),
    uin: z.string().nullish().describe('Source UIN such as HLWS419; reused across sessions.'),
    house: HouseValueSchema.describe('Source House.'),
    dateMade: z.string().describe('Source date the statement was made.'),
    title: z.string().nullish().describe('Statement title.'),
    text: z
      .string()
      .nullish()
      .describe('Search: source plain-text preview. Detail: complete source HTML, verbatim.'),
    detailLevel: z.enum(['summary', 'complete']).describe('Search preview or complete detail.'),
    memberId: z.string().describe('Members API ID of the minister making the statement.'),
    memberName: z.string().nullish().describe('Minister display name.'),
    memberRole: z.string().nullish().describe('Ministerial role when made.'),
    answeringBodyId: z.string().describe('Answering-body ID.'),
    answeringBodyName: z.string().nullish().describe('Answering-body name.'),
    noticeNumber: z
      .number()
      .int()
      .optional()
      .describe('Commons order on the day; omitted for Lords, where the source records none.'),
    attachments: z
      .array(AttachmentSchema.describe('Published attachment metadata.'))
      .nullish()
      .describe('Every published attachment; metadata and links only.'),
    linkedStatements: z
      .array(
        z
          .object({
            linkType: z.string().describe('Source link type.'),
            statementId: z.string().optional().describe('Linked statementId for this tool.'),
            questionId: z
              .string()
              .optional()
              .describe(
                'CorrectedAnswer only: questionId for ukparl_search_questions mode=detail.',
              ),
            linkDate: z.string().nullish().describe('Source link date.'),
          })
          .describe('One joint or correction link.'),
      )
      .nullish()
      .describe('Joint statements and corrections; null or empty when none are recorded.'),
  })
  .meta({ id: 'StatementRecord' });
/** Public statement record. */
export type StatementRecord = z.infer<typeof StatementRecordSchema>;

/** A CorrectedAnswer link crosses into the written-question namespace; every other link names a statement. */
function toLink({
  linkedStatementId,
  linkType,
  linkDate,
}: NonNullable<RawStatement['linkedStatements']>[number]) {
  return {
    linkType,
    ...(linkType === 'CorrectedAnswer'
      ? { questionId: String(linkedStatementId) }
      : { statementId: String(linkedStatementId) }),
    linkDate,
  };
}
/** Flatten one validated source statement into the public record. */
export function toStatementRecord(
  raw: RawStatement,
  detailLevel: StatementRecord['detailLevel'],
): StatementRecord {
  return {
    statementId: String(raw.id),
    uin: raw.uin,
    house: raw.house,
    dateMade: raw.dateMade,
    title: raw.title,
    text: raw.text,
    detailLevel,
    memberId: String(raw.memberId),
    memberName: raw.member?.name,
    memberRole: raw.memberRole,
    answeringBodyId: String(raw.answeringBodyId),
    answeringBodyName: raw.answeringBodyName,
    // Lords rows carry 0 as a House sentinel, never an order on the day.
    ...(raw.house === 'Commons' ? { noticeNumber: raw.noticeNumber } : {}),
    attachments: raw.attachments,
    // A null source collection stays null rather than becoming an omitted one.
    linkedStatements: raw.linkedStatements === null ? null : raw.linkedStatements?.map(toLink),
  };
}
