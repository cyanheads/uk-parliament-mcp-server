/**
 * @fileoverview Flat public statement records normalized from validated source rows.
 * @module tests/services/statements/statement-models.test
 */
import { describe, expect, it } from 'vitest';
import {
  StatementItemSchema,
  StatementRecordSchema,
  toStatementRecord,
} from '@/services/statements/statement-models.js';
import { commonsStatement, statement } from './statements-fixtures.js';

function record(value: unknown, detailLevel: 'summary' | 'complete' = 'summary') {
  return StatementRecordSchema.parse(
    toStatementRecord(StatementItemSchema.parse({ value }).value, detailLevel),
  );
}

describe('toStatementRecord', () => {
  it('flattens a Lords statement to decimal IDs, a member name and no derivable flags', () => {
    expect(record(statement(), 'complete')).toEqual({
      statementId: '1952546',
      uin: 'HLWS419',
      house: 'Lords',
      dateMade: '2026-10-23T00:00:00',
      title: 'Synthetic Taskforce: Government Response',
      text: '<p>Complete synthetic statement 文🏛️ &amp; detail.</p>',
      detailLevel: 'complete',
      memberId: '4959',
      memberName: 'Synthetic Minister',
      memberRole: 'Parliamentary Under-Secretary of State (Synthetic)',
      answeringBodyId: '220',
      answeringBodyName: 'Department for Synthetic Affairs ',
      attachments: [
        {
          url: 'https://example.org/terms of reference.pdf',
          title: 'Terms of Reference',
          fileType: 'pdf',
          fileSizeBytes: 114424,
        },
      ],
      linkedStatements: [
        { linkType: 'JointStatement', statementId: '1952855', linkDate: '2026-10-26T00:00:00' },
        { linkType: 'CorrectedAnswer', questionId: '1912154', linkDate: '2026-06-03T00:00:00' },
      ],
    });
  });
  it('keeps the Commons order on the day and omits the Lords zero sentinel', () => {
    expect(record(commonsStatement())).toMatchObject({ house: 'Commons', noticeNumber: 3 });
    expect(record(statement())).not.toHaveProperty('noticeNumber');
  });
  it('labels every non-CorrectedAnswer link with the source statement namespace', () => {
    const value = {
      ...statement(),
      linkedStatements: [
        { linkedStatementId: 1901572, linkType: 'CorrectedStatement', linkDate: null },
        { linkedStatementId: 1901573, linkType: 'FutureLinkType' },
      ],
    };
    expect(record(value).linkedStatements).toEqual([
      { linkType: 'CorrectedStatement', statementId: '1901572', linkDate: null },
      { linkType: 'FutureLinkType', statementId: '1901573' },
    ]);
  });
  it('preserves null and omitted source values without inventing names, links or attachments', () => {
    const output = record({
      ...statement(),
      member: null,
      memberRole: null,
      uin: null,
      title: null,
      text: null,
      answeringBodyName: null,
      linkedStatements: null,
      attachments: undefined,
    });
    expect(output).toMatchObject({
      uin: null,
      title: null,
      text: null,
      memberRole: null,
      answeringBodyName: null,
      linkedStatements: null,
    });
    expect(output.memberName).toBeUndefined();
    expect(output.attachments).toBeUndefined();
    expect(JSON.parse(JSON.stringify(output))).not.toHaveProperty('memberName');
    // A null collection is unknown, not empty: it is never rewritten as [].
    expect(record({ ...statement(), attachments: null }).attachments).toBeNull();
  });
  it('rejects a source row whose modeled fields break the contract', () => {
    for (const value of [
      { ...statement(), id: 0 },
      { ...statement(), house: 'Joint' },
      { ...statement(), dateMade: undefined },
    ])
      expect(StatementItemSchema.safeParse({ value }).success).toBe(false);
  });
});
