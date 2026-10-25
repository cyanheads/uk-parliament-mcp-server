/**
 * @fileoverview Source-specific division boundaries and normalized public records.
 * @module services/divisions/divisions-schemas
 */
import { z } from '@cyanheads/mcp-ts-core';
import { SourceSchema } from '../parliament-http/parliament-models.js';

const text = z.string().nullish();
const count = z.number().int().nonnegative().nullish();
const flag = z.boolean().nullish();
const rawId = z.number().int().positive().max(2147483647);
const CommonsMember = z.object({
  MemberId: rawId,
  Name: text,
  Party: text,
  SubParty: text,
  PartyColour: text,
  PartyAbbreviation: text,
  MemberFrom: text,
  ListAs: text,
  ProxyName: text,
});
const LordsMember = z.object({
  memberId: rawId,
  name: text,
  party: text,
  partyColour: text,
  partyAbbreviation: text,
  memberFrom: text,
  listAs: text,
  partyIsMainParty: flag,
});
/** Commons PublishedDivision contract, including observed nullable counts and strings. */
export const CommonsDivisionSchema = z.object({
  DivisionId: rawId,
  Date: text,
  PublicationUpdated: text,
  Number: count,
  IsDeferred: flag,
  EVELType: text,
  EVELCountry: text,
  Title: text,
  AyeCount: count,
  NoCount: count,
  DoubleMajorityAyeCount: count,
  DoubleMajorityNoCount: count,
  AyeTellers: z.array(CommonsMember).nullish(),
  NoTellers: z.array(CommonsMember).nullish(),
  Ayes: z.array(CommonsMember).nullish(),
  Noes: z.array(CommonsMember).nullish(),
  FriendlyDescription: text,
  FriendlyTitle: text,
  NoVoteRecorded: z.array(CommonsMember).nullish(),
  RemoteVotingStart: text,
  RemoteVotingEnd: text,
});
/** Lords DivisionViewModel contract; authoritative and roster counts are distinct. */
export const LordsDivisionSchema = z.object({
  divisionId: rawId,
  date: text,
  number: count,
  notes: text,
  title: text,
  isWhipped: flag,
  isGovernmentContent: flag,
  authoritativeContentCount: count,
  authoritativeNotContentCount: count,
  divisionHadTellers: flag,
  tellerContentCount: count,
  tellerNotContentCount: count,
  memberContentCount: count,
  memberNotContentCount: count,
  sponsoringMemberId: rawId.nullish(),
  isHouse: flag,
  isInquorate: flag,
  amendmentMotionNotes: text,
  isGovernmentWin: flag,
  remoteVotingStart: text,
  remoteVotingEnd: text,
  divisionWasExclusivelyRemote: flag,
  contentTellers: z.array(LordsMember).nullish(),
  notContentTellers: z.array(LordsMember).nullish(),
  contents: z.array(LordsMember).nullish(),
  notContents: z.array(LordsMember).nullish(),
});
/** Native lobby labels; not_recorded is never an abstention claim. */
export const LobbySchema = z.enum(['aye', 'no', 'content', 'not_content', 'not_recorded']);
/** Complete normalized member fields, retained on both client surfaces. */
export const VoterSchema = z
  .object({
    memberId: z.string().describe('Members API identifier supplied by this voting source.'),
    name: text.describe('Source member name, unknown when absent or null.'),
    party: text.describe('Party at this division, without current-party inference.'),
    subParty: text.describe('Source sub-party label.'),
    partyColour: text.describe('Source party colour.'),
    partyAbbreviation: text.describe('Source party abbreviation.'),
    partyIsMainParty: flag.describe('Source main-party flag.'),
    memberFrom: text.describe('Source constituency or peerage description.'),
    constituency: text.describe('Commons constituency only; absent for Lords.'),
    listAs: text.describe('Source sortable member name.'),
    proxyName: text.describe('Source proxy name.'),
    lobby: LobbySchema.describe('Source lobby or explicitly not-recorded list.'),
    isTeller: z.boolean().describe('Member appears in this lobby teller list.'),
  })
  .describe('One whole normalized voter or teller identity.');
/** One normalized whole voter row. */
export type Voter = z.infer<typeof VoterSchema>;
/** All meaningful division metadata; roster arrays are separately selected through voters mode. */
export const DivisionSchema = z
  .object({
    divisionId: z.string().describe('Division ID scoped to the accompanying House.'),
    date: text.describe('Source division date and time.'),
    number: count.describe('House session division number; distinct from divisionId.'),
    title: text.describe('Complete division title.'),
    publicationUpdated: text.describe('Source publication update time.'),
    isDeferred: flag.describe('Commons deferred division flag.'),
    evelType: text.describe('Historic Commons EVEL type.'),
    evelCountry: text.describe('Historic Commons EVEL country.'),
    ayeCount: count.describe('Official Commons aye count, never derived from rows.'),
    noCount: count.describe('Official Commons no count, never derived from rows.'),
    doubleMajorityAyeCount: count.describe('Official Commons double-majority aye count.'),
    doubleMajorityNoCount: count.describe('Official Commons double-majority no count.'),
    friendlyDescription: text.describe('Complete Commons friendly description.'),
    friendlyTitle: text.describe('Commons friendly title.'),
    notes: text.describe('Complete Lords notes.'),
    isWhipped: flag.describe('Lords whipped division flag.'),
    isGovernmentContent: flag.describe('Lords government content position.'),
    authoritativeContentCount: count.describe('Official authoritative Lords content count.'),
    authoritativeNotContentCount: count.describe('Official authoritative Lords not-content count.'),
    divisionHadTellers: flag.describe('Lords source teller presence flag.'),
    tellerContentCount: count.describe(
      'Lords count recorded by tellers; not the number of tellers.',
    ),
    tellerNotContentCount: count.describe('Lords not-content count recorded by tellers.'),
    memberContentCount: count.describe('Lords source member content tally.'),
    memberNotContentCount: count.describe('Lords source member not-content tally.'),
    sponsoringMemberId: text.describe('Source sponsoring Members API ID.'),
    isHouse: flag.describe('Lords source House flag.'),
    isInquorate: flag.describe('Lords inquorate division flag.'),
    amendmentMotionNotes: text.describe('Complete Lords amendment motion HTML.'),
    isGovernmentWin: flag.describe('Lords source government-win flag.'),
    remoteVotingStart: text.describe('Source remote voting start.'),
    remoteVotingEnd: text.describe('Source remote voting end.'),
    divisionWasExclusivelyRemote: flag.describe('Lords exclusively remote division flag.'),
    detailLevel: z
      .enum(['summary', 'complete'])
      .describe('Search summary or selected complete metadata.'),
    source: SourceSchema.describe('Actual official request provenance.'),
    sourceUrl: z.string().describe('Official public division page.'),
    rosterAvailableVia: z
      .literal('ukparl_search_divisions')
      .describe('Use mode=voters with house and divisionId for complete roster rows.'),
    rosterSelectors: z
      .array(
        z
          .object({
            lobby: LobbySchema.describe('Select this lobby in voters mode.'),
            membersKnown: z
              .boolean()
              .describe('Source supplied a complete member roster array for this lobby.'),
            tellersKnown: z
              .boolean()
              .describe('Source supplied a teller array, or this lobby has no teller concept.'),
            count: count.describe(
              'Known complete roster row count; unknown if source omitted its list.',
            ),
            selector: z.literal('voters').describe('Mode selecting this collection.'),
          })
          .describe('One complete roster selector with explicit availability.'),
      )
      .optional()
      .describe('Complete-detail roster descriptors; summaries do not claim roster completeness.'),
    tellers: z
      .array(VoterSchema)
      .optional()
      .describe(
        'Available source teller identities on selected detail; rosterSelectors discloses omitted source lists.',
      ),
    headlineCountTreatment: z
      .string()
      .describe('Source-specific official count semantics, separate from roster arithmetic.'),
    headlineCountExplanationUrl: z
      .string()
      .describe('Official Parliament explanation of whether tellers are counted in each House.'),
  })
  .describe('Normalized whole division metadata.');
/** Normalized selected division or search summary. */
export type Division = z.infer<typeof DivisionSchema>;
/** Party totals contain only roster observations; unknown party stays null or absent. */
export const PartyTotalSchema = z
  .object({
    party: text.describe('Source party label; unknown remains unknown.'),
    lobby: LobbySchema.describe('Source lobby.'),
    voterCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Unique listed non-teller members in this party and lobby.'),
    tellerCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Unique listed tellers in this party and lobby.'),
  })
  .describe('One roster-derived party and lobby tally.');
