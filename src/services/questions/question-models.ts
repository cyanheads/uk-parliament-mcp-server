/**
 * @fileoverview Explicit written-question records and source wrappers.
 * @module services/questions/question-models
 */
import { z } from '@cyanheads/mcp-ts-core';
import { SourceSchema } from '../parliament-http/parliament-models.js';

const MemberSchema = z.object({
  id: z.number().int().positive().optional().describe('Members API identifier.'),
  listAs: z.string().nullish().describe('Source sorting name.'),
  name: z.string().nullish().describe('Member display name.'),
  party: z.string().nullish().describe('Recorded party name.'),
  partyColour: z.string().nullish().describe('Recorded party colour.'),
  partyAbbreviation: z.string().nullish().describe('Recorded party abbreviation.'),
  memberFrom: z.string().nullish().describe('Constituency or member origin.'),
  thumbnailUrl: z.string().nullish().describe('Published member thumbnail link.'),
});
const AttachmentSchema = z.object({
  url: z.string().nullish().describe('Published attachment link; not downloaded.'),
  title: z.string().nullish().describe('Attachment title.'),
  fileType: z.string().nullish().describe('Published file type.'),
  fileSizeBytes: z.number().int().nonnegative().optional().describe('Published size in bytes.'),
});
/** Complete source question, with absence preserved rather than inferred. */
export const QuestionSchema = z.object({
  id: z.number().int().positive().describe('Questions API numeric record ID, distinct from UIN.'),
  askingMemberId: z.number().int().positive().optional().describe('Asking Members API ID.'),
  askingMember: MemberSchema.nullish().describe('Expanded asking member reference.'),
  house: z.enum(['Bicameral', 'Commons', 'Lords']).optional().describe('Source House.'),
  memberHasInterest: z
    .boolean()
    .optional()
    .describe('Recorded interest flag; omitted means unknown.'),
  dateTabled: z.string().optional().describe('Source tabling date.'),
  dateForAnswer: z.string().optional().describe('Source requested answer date.'),
  uin: z
    .string()
    .nullish()
    .describe('UIN; requires its date for unique lookup and is not questionId.'),
  questionText: z
    .string()
    .nullish()
    .describe('Question text; search is a preview, detail is complete.'),
  answeringBodyId: z.number().int().optional().describe('Source answering-body reference ID.'),
  answeringBodyName: z.string().nullish().describe('Source answering-body name.'),
  isWithdrawn: z.boolean().optional().describe('Source withdrawal flag.'),
  isNamedDay: z.boolean().optional().describe('Source named-day flag.'),
  groupedQuestions: z
    .array(z.string().describe('Related question UIN.'))
    .nullish()
    .describe('Source grouped UINs, not Questions API IDs.'),
  answerIsHolding: z.boolean().nullish().describe('Source holding-answer flag.'),
  answerIsCorrection: z.boolean().nullish().describe('Source corrected-answer flag.'),
  answeringMemberId: z.number().int().nullish().describe('Answering Members API ID.'),
  answeringMember: MemberSchema.nullish().describe('Expanded answering member.'),
  correctingMemberId: z.number().int().nullish().describe('Correcting Members API ID.'),
  correctingMember: MemberSchema.nullish().describe('Expanded correcting member.'),
  dateAnswered: z.string().nullish().describe('Source answer date.'),
  answerText: z
    .string()
    .nullish()
    .describe('Search answer preview or complete detail HTML, preserved verbatim.'),
  originalAnswerText: z.string().nullish().describe('Original answer content, preserved verbatim.'),
  comparableAnswerText: z.string().nullish().describe('Source comparable answer content.'),
  dateAnswerCorrected: z.string().nullish().describe('Correction date.'),
  dateHoldingAnswer: z.string().nullish().describe('Holding answer date.'),
  attachmentCount: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Published attachment count; does not mean files were fetched.'),
  heading: z.string().nullish().describe('Source question heading.'),
  attachments: z
    .array(AttachmentSchema.describe('Published attachment metadata.'))
    .nullish()
    .describe('Every attachment supplied by the selected response.'),
  groupedQuestionsDates: z
    .array(
      z
        .object({
          questionUin: z.string().nullish().describe('Related question UIN.'),
          dateTabled: z.string().optional().describe('Related question tabling date.'),
        })
        .describe('Date-qualified grouped question reference.'),
    )
    .nullish()
    .describe('Grouped question UIN and date relationships.'),
});
/** Source relationship links, preserved without interpreting relative routes as API paths. */
export const QuestionLinkSchema = z.object({
  rel: z.string().nullish().describe('Source relation.'),
  href: z.string().nullish().describe('Source link target.'),
  method: z.string().nullish().describe('Source link method.'),
});
/** Validated singular response wrapper. */
export const QuestionItemSchema = z.object({
  value: QuestionSchema,
  links: z.array(QuestionLinkSchema).nullish(),
});
/** Validated search response; a missing collection is not silently treated as empty. */
export const QuestionSearchSchema = z.object({
  totalResults: z.number().int().nonnegative(),
  results: z.array(QuestionItemSchema),
});
/** Public flattened question record avoids redundant wrapper nesting. */
export const QuestionRecordSchema = QuestionSchema.extend({
  questionId: z.string().describe('Decimal Questions API ID for detail mode.'),
  links: z
    .array(QuestionLinkSchema.describe('Source relationship link.'))
    .nullish()
    .describe('Source relationship links.'),
  source: SourceSchema.describe('Actual selected request provenance.'),
  detailLevel: z
    .enum(['summary', 'complete'])
    .describe('Summary previews or complete selected question.'),
  followUp: z
    .string()
    .optional()
    .describe('Same-tool instruction for complete question and answer retrieval.'),
});
