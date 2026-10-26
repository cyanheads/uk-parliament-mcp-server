/**
 * @fileoverview House-scoped division search, complete metadata, and roster-derived collections.
 * @module services/divisions/divisions-service
 */
import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  advanceCollectionCursor,
  invalidCursor,
  pageFor,
  readCollectionCursor,
} from '../parliament-http/parliament-cursors.js';
import {
  getParliamentHttp,
  type ParliamentCall,
  type ParliamentHttpService,
  type ParliamentQuery,
} from '../parliament-http/parliament-http-service.js';
import type { House, Page, Source } from '../parliament-http/parliament-models.js';
import {
  CommonsDivisionSchema,
  CommonsMemberVoteSchema,
  type Division,
  LordsDivisionSchema,
  LordsMemberVoteSchema,
  type Voter,
} from './divisions-schemas.js';

/** Validated caller selection, before a shared transport call. */
export interface DivisionSelection {
  cursor?: string | undefined;
  divisionId?: string | undefined;
  endDate?: string | undefined;
  house: House;
  limit: number;
  lobby?: Voter['lobby'] | undefined;
  memberId?: string | undefined;
  mode: 'search' | 'detail' | 'voters' | 'party_totals';
  party?: string | undefined;
  query?: string | undefined;
  startDate?: string | undefined;
}
interface SelectedDivision {
  record: Division;
  unavailableLobbies: Voter['lobby'][];
  voters: Voter[];
}
/** Full typed domain payload before shared byte-aware delivery. */
export interface DivisionPayload {
  found?: boolean;
  guidance?: string;
  house: House;
  items?: Division[];
  mode: DivisionSelection['mode'];
  page?: Page;
  partyTotals?: {
    party?: string | null | undefined;
    lobby: Voter['lobby'];
    voterCount: number;
    tellerCount: number;
  }[];
  record?: Division;
  selection: Omit<DivisionSelection, 'cursor'>;
  source?: Source;
  voters?: Voter[];
}
const commonsTreatment =
  'Official Commons AyeCount and NoCount exclude tellers and are preserved as published. Teller identities and roster-derived non-teller counts are separate; no absent member is inferred to have abstained.';
const lordsTreatment =
  'Official Lords totals include teller votes. Authoritative counts use the teller-recorded counts when tellers are present and member counts otherwise. Teller-recorded counts are vote totals, not teller headcounts. Party totals separately count listed non-tellers and tellers.';

function commonsMember(
  member: NonNullable<z.infer<typeof CommonsDivisionSchema>['Ayes']>[number],
  lobby: Voter['lobby'],
  isTeller: boolean,
): Voter {
  return {
    memberId: String(member.MemberId),
    name: member.Name,
    party: member.Party,
    subParty: member.SubParty,
    partyColour: member.PartyColour,
    partyAbbreviation: member.PartyAbbreviation,
    memberFrom: member.MemberFrom,
    constituency: member.MemberFrom,
    listAs: member.ListAs,
    proxyName: member.ProxyName,
    lobby,
    isTeller,
  };
}
function lordsMember(
  member: NonNullable<z.infer<typeof LordsDivisionSchema>['contents']>[number],
  lobby: Voter['lobby'],
  isTeller: boolean,
): Voter {
  return {
    memberId: String(member.memberId),
    name: member.name,
    party: member.party,
    partyColour: member.partyColour,
    partyAbbreviation: member.partyAbbreviation,
    partyIsMainParty: member.partyIsMainParty,
    memberFrom: member.memberFrom,
    listAs: member.listAs,
    lobby,
    isTeller,
  };
}
function uniqueRows(rows: Voter[]): Voter[] {
  const members = new Map<string, Voter>();
  for (const row of rows) {
    const key = `${row.lobby}:${row.memberId}`;
    const previous = members.get(key);
    members.set(
      key,
      previous ? { ...previous, ...row, isTeller: previous.isTeller || row.isTeller } : row,
    );
  }
  return [...members.values()];
}
function normalizeCommons(
  raw: z.infer<typeof CommonsDivisionSchema>,
  source: Source,
  complete: boolean,
): SelectedDivision {
  const rosters = [
    ['aye', raw.Ayes, raw.AyeTellers],
    ['no', raw.Noes, raw.NoTellers],
    ['not_recorded', raw.NoVoteRecorded, undefined],
  ] as const;
  const voters = uniqueRows(
    rosters.flatMap(([lobby, members, tellers]) => [
      ...(members?.map((m) => commonsMember(m, lobby, false)) ?? []),
      ...(tellers?.map((m) => commonsMember(m, lobby, true)) ?? []),
    ]),
  );
  const record: Division = {
    divisionId: String(raw.DivisionId),
    date: raw.Date,
    publicationUpdated: raw.PublicationUpdated,
    number: raw.Number,
    isDeferred: raw.IsDeferred,
    evelType: raw.EVELType,
    evelCountry: raw.EVELCountry,
    title: raw.Title,
    ayeCount: raw.AyeCount,
    noCount: raw.NoCount,
    doubleMajorityAyeCount: raw.DoubleMajorityAyeCount,
    doubleMajorityNoCount: raw.DoubleMajorityNoCount,
    friendlyDescription: raw.FriendlyDescription,
    friendlyTitle: raw.FriendlyTitle,
    remoteVotingStart: raw.RemoteVotingStart,
    remoteVotingEnd: raw.RemoteVotingEnd,
    source,
    sourceUrl: `https://votes.parliament.uk/Votes/Commons/Division/${raw.DivisionId}`,
    detailLevel: complete ? 'complete' : 'summary',
    rosterAvailableVia: 'ukparl_search_divisions',
    headlineCountTreatment: commonsTreatment,
    headlineCountExplanationUrl: 'https://www.parliament.uk/site-information/glossary/tellers/',
    ...(complete
      ? {
          rosterSelectors: rosters.map(([lobby, members, tellers]) => ({
            lobby,
            membersKnown: members != null,
            tellersKnown: lobby === 'not_recorded' || tellers != null,
            count:
              members == null
                ? members
                : lobby !== 'not_recorded' && tellers == null
                  ? undefined
                  : voters.filter((row) => row.lobby === lobby).length,
            selector: 'voters' as const,
          })),
          tellers: voters.filter((row) => row.isTeller),
        }
      : {}),
  };
  return {
    record,
    voters,
    unavailableLobbies: rosters
      .filter(
        ([lobby, members, tellers]) =>
          members == null || (tellers == null && lobby !== 'not_recorded'),
      )
      .map(([lobby]) => lobby),
  };
}
function normalizeLords(
  raw: z.infer<typeof LordsDivisionSchema>,
  source: Source,
  complete: boolean,
): SelectedDivision {
  const rosters = [
    ['content', raw.contents, raw.contentTellers],
    ['not_content', raw.notContents, raw.notContentTellers],
  ] as const;
  const voters = uniqueRows(
    rosters.flatMap(([lobby, members, tellers]) => [
      ...(members?.map((m) => lordsMember(m, lobby, false)) ?? []),
      ...(tellers?.map((m) => lordsMember(m, lobby, true)) ?? []),
    ]),
  );
  return {
    voters,
    unavailableLobbies: rosters
      .filter(([, members, tellers]) => members == null || tellers == null)
      .map(([lobby]) => lobby),
    record: {
      divisionId: String(raw.divisionId),
      date: raw.date,
      number: raw.number,
      notes: raw.notes,
      title: raw.title,
      isWhipped: raw.isWhipped,
      isGovernmentContent: raw.isGovernmentContent,
      authoritativeContentCount: raw.authoritativeContentCount,
      authoritativeNotContentCount: raw.authoritativeNotContentCount,
      divisionHadTellers: raw.divisionHadTellers,
      tellerContentCount: raw.tellerContentCount,
      tellerNotContentCount: raw.tellerNotContentCount,
      memberContentCount: raw.memberContentCount,
      memberNotContentCount: raw.memberNotContentCount,
      sponsoringMemberId:
        raw.sponsoringMemberId == null ? raw.sponsoringMemberId : String(raw.sponsoringMemberId),
      isHouse: raw.isHouse,
      isInquorate: raw.isInquorate,
      amendmentMotionNotes: raw.amendmentMotionNotes,
      isGovernmentWin: raw.isGovernmentWin,
      remoteVotingStart: raw.remoteVotingStart,
      remoteVotingEnd: raw.remoteVotingEnd,
      divisionWasExclusivelyRemote: raw.divisionWasExclusivelyRemote,
      source,
      sourceUrl: `https://votes.parliament.uk/Votes/Lords/Division/${raw.divisionId}`,
      detailLevel: complete ? 'complete' : 'summary',
      rosterAvailableVia: 'ukparl_search_divisions',
      headlineCountTreatment: lordsTreatment,
      headlineCountExplanationUrl: 'https://www.parliament.uk/site-information/glossary/tellers/',
      ...(complete
        ? {
            rosterSelectors: rosters.map(([lobby, members, tellers]) => ({
              lobby,
              membersKnown: members != null,
              tellersKnown: tellers != null,
              count:
                members == null
                  ? members
                  : tellers == null
                    ? undefined
                    : voters.filter((row) => row.lobby === lobby).length,
              selector: 'voters' as const,
            })),
            tellers: voters.filter((row) => row.isTeller),
          }
        : {}),
    },
  };
}

/** Stateless source service; transport owns initialization, deadlines, retries and teardown. */
export class DivisionsService {
  private readonly http: ParliamentHttpService;
  constructor(http: ParliamentHttpService) {
    this.http = http;
  }

  /** Fetch one selected source only; a true 404 becomes a typed not-found payload. */
  async execute(input: DivisionSelection, call: ParliamentCall) {
    const { cursor: _cursor, ...selection } = input;
    const api = input.house === 'commons' ? 'commons_votes' : 'lords_votes';
    const base: DivisionPayload = { mode: input.mode, house: input.house, selection };
    const binding = {
      source: api,
      selector: input.mode,
      filters: selection,
      nativePageSize: input.limit,
    };
    const cursor = readCollectionCursor(input.cursor, binding);
    if (input.mode === 'search') {
      let records: Division[];
      let source: Source;
      if (input.house === 'commons') {
        const query: ParliamentQuery = {
          'queryParameters.searchTerm': input.query,
          'queryParameters.memberId': input.memberId,
          'queryParameters.includeWhenMemberWasTeller': input.memberId ? true : undefined,
          'queryParameters.startDate': input.startDate,
          'queryParameters.endDate': input.endDate,
          'queryParameters.skip': cursor.offset,
          'queryParameters.take': input.limit + 1,
        };
        const response = await this.http.get(
          call,
          api,
          input.memberId ? '/data/divisions.json/membervoting' : '/data/divisions.json/search',
          input.memberId
            ? z
                .array(
                  CommonsMemberVoteSchema.refine((row) => String(row.MemberId) === input.memberId),
                )
                .transform((rows) =>
                  rows.map((row) => ({
                    raw: row.PublishedDivision,
                    memberVote: {
                      memberId: String(row.MemberId),
                      lobby: row.MemberVotedAye ? ('aye' as const) : ('no' as const),
                      wasTeller: row.MemberWasTeller,
                    },
                  })),
                )
            : z
                .array(CommonsDivisionSchema)
                .transform((rows) => rows.map((raw) => ({ raw, memberVote: undefined }))),
          query,
          Object.keys(query),
        );
        source = response.source;
        records = response.data.map(({ raw, memberVote }) => ({
          ...normalizeCommons(raw, source, false).record,
          ...(memberVote ? { memberVote } : {}),
        }));
      } else {
        const query: ParliamentQuery = {
          SearchTerm: input.query,
          MemberId: input.memberId,
          IncludeWhenMemberWasTeller: input.memberId ? true : undefined,
          StartDate: input.startDate,
          EndDate: input.endDate,
          skip: cursor.offset,
          take: input.limit + 1,
        };
        const response = await this.http.get(
          call,
          api,
          input.memberId ? '/data/Divisions/membervoting' : '/data/Divisions/search',
          input.memberId
            ? z
                .array(
                  LordsMemberVoteSchema.refine((row) => String(row.memberId) === input.memberId),
                )
                .transform((rows) =>
                  rows.map((row) => ({
                    raw: row.publishedDivision,
                    memberVote: {
                      memberId: String(row.memberId),
                      lobby: row.memberWasContent ? ('content' as const) : ('not_content' as const),
                      wasTeller: row.memberWasTeller,
                    },
                  })),
                )
            : z
                .array(LordsDivisionSchema)
                .transform((rows) => rows.map((raw) => ({ raw, memberVote: undefined }))),
          query,
          Object.keys(query),
        );
        source = response.source;
        records = response.data.map(({ raw, memberVote }) => ({
          ...normalizeLords(raw, source, false).record,
          ...(memberVote ? { memberVote } : {}),
        }));
      }
      const repage = (count: number): DivisionPayload => ({
        ...base,
        source,
        items: records.slice(0, count),
        page: {
          returned: count,
          hasMore: records.length > count,
          ...(records.length > count ? { nextCursor: advanceCollectionCursor(cursor, count) } : {}),
        },
      });
      const count = Math.min(records.length, input.limit);
      return { payload: repage(count), count, repage };
    }
    let selected: SelectedDivision;
    try {
      if (input.house === 'commons') {
        const response = await this.http.get(
          call,
          api,
          `/data/division/${input.divisionId}.json`,
          CommonsDivisionSchema,
        );
        selected = normalizeCommons(response.data, response.source, true);
      } else {
        const response = await this.http.get(
          call,
          api,
          `/data/Divisions/${input.divisionId}`,
          LordsDivisionSchema,
        );
        selected = normalizeLords(response.data, response.source, true);
      }
    } catch (error) {
      if (!(error instanceof McpError) || error.code !== JsonRpcErrorCode.NotFound) throw error;
      const payload: DivisionPayload = {
        ...base,
        found: false,
        guidance:
          'Search ukparl_search_divisions in the same House to resolve a published divisionId; Commons and Lords division IDs are separate namespaces.',
      };
      return { payload, count: 0, repage: () => payload };
    }
    const full = { ...base, found: true, record: selected.record, source: selected.record.source };
    if (input.mode === 'detail') return { payload: full, count: 0, repage: () => full };
    const unavailable = selected.unavailableLobbies.filter(
      (lobby) => !input.lobby || input.lobby === lobby,
    );
    if (unavailable.length) {
      const payload: DivisionPayload = {
        ...full,
        guidance: `The selected source omitted a complete roster or teller list for ${unavailable.join(', ')}. Counts remain unknown; repeat detail to inspect source metadata or select an available lobby in voters mode.`,
      };
      return { payload, count: 0, repage: () => payload };
    }
    if (input.mode === 'party_totals') {
      const groups = new Map<string, NonNullable<DivisionPayload['partyTotals']>[number]>();
      for (const row of selected.voters) {
        const key = JSON.stringify([row.party, row.lobby]);
        let group = groups.get(key);
        if (!group) {
          group = { party: row.party, lobby: row.lobby, voterCount: 0, tellerCount: 0 };
          groups.set(key, group);
        }
        if (row.isTeller) group.tellerCount++;
        else group.voterCount++;
      }
      const payload: DivisionPayload = { ...full, partyTotals: [...groups.values()] };
      return { payload, count: 0, repage: () => payload };
    }
    const voters = selected.voters.filter(
      (row) =>
        (!input.party || row.party?.toLowerCase() === input.party.toLowerCase()) &&
        (!input.lobby || row.lobby === input.lobby),
    );
    if (cursor.offset > voters.length) return invalidCursor();
    const count = Math.min(input.limit, voters.length - cursor.offset);
    const repage = (shown: number): DivisionPayload => ({
      ...full,
      voters: voters.slice(cursor.offset, cursor.offset + shown),
      page: pageFor(cursor, shown, voters.length),
    });
    return { payload: repage(count), count, repage };
  }
}
/** Create the stateless division service using the initialized shared transport. */
export function getDivisionsService(): DivisionsService {
  return new DivisionsService(getParliamentHttp());
}
