---
name: uk-parliament-guide
description: Identifier chains and gates for the ukparl_* tools (Westminster bills, members, divisions, spoken Hansard, written questions and statements, committees). Use before reporting how a member or party voted, a member's party or House at a past date, a bill's votes or debates, what a minister or department said, or committee evidence and responses, and whenever an ID from one ukparl_* tool has to feed another.
license: Apache-2.0
metadata:
  author: cyanheads
  version: "1.0"
---

## Scope

The Commons, the Lords and their committees. Keyless and read-only.

Written and spoken records sit in different tools. `ukparl_search_questions` and `ukparl_search_statements` hold written questions and written ministerial statements. Oral questions, oral statements and debates are spoken contributions, so they are in `ukparl_search_hansard`.

## Identifiers

Every person joins through the Members API `memberId`. It reaches you under several field names, and the input called `memberId` plays a different role on each tool.

| Id | Where it comes from | What takes it |
|:---|:--------------------|:--------------|
| `memberId` | `ukparl_search_members`. Also a Hansard contribution's `memberId` (never its `sourceMemberId`), division voter rows and `memberVote`, a statement's `memberId`, a bill or amendment sponsor's `memberId`, a question's `askingMemberId`, `answeringMemberId` and `correctingMemberId`, a committee record's `memberId`, and the `mnisId` of any committee `MemberInfo` entity, evidence witnesses included | `ukparl_get_member`. As a filter it is the sponsor on `ukparl_search_bills` and on `ukparl_get_bill` amendments, the voter on `ukparl_search_divisions`, the speaker on `ukparl_search_hansard`, the asker on `ukparl_search_questions` and the minister on `ukparl_search_statements`. The minister who answered a question goes in `answeringMemberId` |
| `divisionId` | `ukparl_search_divisions` search, and the `divisionId` on a `ukparl_get_member` voting row, which belongs to the House that call named | detail, voters and party_totals in the same House. A division's `number` and a voting row's `divisionNumber` are per-session numbers, never a `divisionId` |
| `billStageId` | The `id` of each `ukparl_get_bill` stages item. A bill search hit's `currentStage.id` is already its current stage's `billStageId` | `ukparl_get_bill` stage, amendments and motions |
| `sessionId` | `introducedSessionId` and `includedSessionIds` on bills, `sessionId` on stages. No session list exists | `ukparl_search_bills` |
| `answeringBodyId` | `ukparl_lookup_reference` answering_bodies, or the `answeringBodyId` of any question or statement | `answeringBodyIds` on both `ukparl_search_questions` and `ukparl_search_statements`. Department IDs from topic departments filter only `ukparl_search_bills` |
| Grouped question UIN | A question's `groupedQuestions`, each dated in `groupedQuestionsDates` | `ukparl_search_questions` with `uin` and `tabledFrom`/`tabledTo` on that date, then the returned `questionId` in detail |
| Committee `recordId` | Every `ukparl_get_committee` record, named by its `recordType`: `committee` is a committeeId, `business` a businessId, `publication` a publicationId, `written_evidence` or `oral_evidence` an evidenceId of that evidenceType. A `membership` recordId feeds nothing; use that record's `memberId`. Also the `committeeId` on `ukparl_get_member` committee_seats rows | The `ukparl_get_committee` mode for that namespace |
| Publication type ID | The `id` of a `PublicationType` entity inside a publication record. No reference topic lists them | `publicationTypeIds` on `ukparl_get_committee` publications |
| Party | Division voter rows and `partyTotals` carry a source party label. `ukparl_lookup_reference` parties and a member's `latestParty` carry a party ID | The label filters `ukparl_search_divisions` voters. The ID filters only `ukparl_search_members` |

## Gates

1. **Choose the House before reading member records or votes.** Interests, voting history and every division call read one House at a time. The `house` filter on `ukparl_search_members` matches a member's latest House, so a former MP now in the Lords drops out of a Commons search: leave it off when the person may have moved. Read `ukparl_get_member` roles with category `houseMemberships` to see each House and its dates, then query every House the question covers. Members records code the House as 1 (Commons) or 2 (Lords); the tools take `commons` and `lords`.
2. **Take a past party from periods, not latest fields.** A search hit's `latestParty` and `latestHouseMembership` are the member's current values. An `asOf` search returns them, and the display name, as they stood on that date, so never report them as current: a peer who sat in the Commons then shows that Commons seat. Party over a period comes from roles category `partyAffiliations`. Party at a vote is the voter row's `party`.
3. **A missing vote shows only that no vote was recorded.** A division absent from a `memberId` search, a member absent from the voters, and a member on the Commons `not_recorded` list all mean the source holds no vote for them. Report it that way, never as abstention, opposition or absence from the chamber. Before reading a gap in someone's record as meaningful, check `houseMemberships`: they may not have sat in that House then.
4. **Quote the result from detail.** The official counts are on mode detail: `ayeCount` and `noCount` in the Commons, `authoritativeContentCount` and `authoritativeNotContentCount` in the Lords. Its `headlineCountTreatment` says how tellers count: Commons headline counts leave them out, Lords totals include teller votes. `party_totals` counts listed rows, tellers kept apart, which makes it a breakdown rather than the result. When voters or party_totals comes back with `guidance` and no rows, the source omitted that roster, and the breakdown is unknown rather than zero.
5. **Search spoken and written records before reporting silence.** Before saying a member or minister never raised, asked or answered something, search `ukparl_search_hansard` and the matching written tool over the same dates. An empty result in one of them covers only that one.
6. **Pass dates between tools as `YYYY-MM-DD`.** Date inputs accept only that form. Trim a timestamp read from a record, such as a role period, a stage sitting or a Hansard `sittingDate`, to its date. When a period's `endDate` is null, leave the upper bound off.

## Workflows

**A bill's votes and debates.** Divisions carry no bill reference, so you find a bill's votes by House and date. `ukparl_get_bill` section stages gives each stage's `house` and its `stageSittings` dates. Search `ukparl_search_divisions` in that House with `startDate` and `endDate` set to a sitting date, and keep the divisions whose title names the bill; a distinctive title word as `query` narrows the page. Add `memberId` to read one member's `memberVote`, and take the result itself from detail (gate 4). The debate is in `ukparl_search_hansard` for the same House and date with a title word as `query`. Repeat it with a returned `debateSectionId` to stay in that section. For amendments, a stage's `id` opens section amendments, which `decision` filters, and an amendment's `amendmentId`, passed as `itemId` with section amendment, returns its full text.

**A member's voting record.** `ukparl_get_member` voting pages through every recorded vote in one House with no topic or date filter. For a topic or a period, use `ukparl_search_divisions` with `memberId` plus `query` or dates, which returns each matching division with `memberVote`. Both routes are per House (gate 1), and both hand back `divisionId`s for detail and voters in that House.

**What a minister or department said in writing.** Resolve the department with `ukparl_lookup_reference` answering_bodies, not departments. Pass that ID as `answeringBodyIds` to `ukparl_search_questions` for answers and to `ukparl_search_statements` for statements. For one minister, filter statements by `memberId` and questions by `answeringMemberId`, since `memberId` on questions is the asker. To bound the dates by time in office, read `ukparl_get_member` roles category `governmentPosts`: each post's `startDate` and `endDate` become `answeredFrom`/`answeredTo` and `madeFrom`/`madeTo` (gate 6). Statements made out loud in the chamber are in `ukparl_search_hansard` (gate 5).

**Committee inquiries, evidence and responses.** Start from `ukparl_get_committee` search, or from the `committeeId` on a member's committee_seats rows. For a topic across all committees, call inquiries with `query` and no `committeeId`. A `business` record from inquiries gives the businessId that inquiry and evidence take, and that narrows a committee's publications. Written and oral evidence are separate lists, so run evidence once for each evidenceType. evidence_detail carries witnesses, dates and files; reach for evidence_document only when you need the submission or transcript text. A witness who is a member links to `ukparl_get_member` through the `mnisId` on its `MemberInfo` entity. A government response to a report is a publication of its own: in the report's publication record, the `GovernmentResponse` entity points to `PublicationSummary` entities, and each one's `id` opens with mode publication.
