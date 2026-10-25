/**
 * @fileoverview Synthetic House-specific wire records and the injected HTTP boundary.
 * @module tests/services/divisions/divisions-fixtures
 */
import { initParliamentHttp } from '@/services/parliament-http/parliament-http-service.js';

/** Commons fields deliberately distinguish unknown values and teller identities. */
export function commonsDivision(id = 42) {
  return {
    DivisionId: id,
    Title: 'Synthetic "Éire"\n<em>division</em> ```',
    Number: 7,
    Date: '2024-03-01T12:00:00',
    PublicationUpdated: '2024-03-02T13:00:00',
    AyeCount: 101,
    NoCount: null,
    DoubleMajorityAyeCount: 0,
    IsDeferred: false,
    FriendlyDescription: 'Complete\nsource description',
    Ayes: [
      {
        MemberId: 1,
        Name: 'Élodie "A"\n文',
        Party: 'Synthetic Labour',
        MemberFrom: 'North 🏛️',
        ProxyName: 'Proxy \\ one',
      },
      { MemberId: 2, Name: 'Teller α', Party: 'Synthetic Labour' },
      { MemberId: 3, Name: null, Party: null, MemberFrom: null },
      { MemberId: 4 },
    ],
    AyeTellers: [
      { MemberId: 2, Name: 'Teller α', Party: 'Synthetic Labour' },
      { MemberId: 5, Name: 'Teller β', Party: 'Synthetic Labour' },
    ],
    Noes: [{ MemberId: 6, Name: 'Negative', Party: 'Synthetic Labour Co-operative' }],
    NoTellers: [],
    NoVoteRecorded: [{ MemberId: 7, Name: 'No recorded vote', Party: 'Synthetic Labour' }],
  };
}

/** Lords casing follows DivisionViewModel, with distinct official/member/teller totals. */
export function lordsDivision(id = 42) {
  return {
    divisionId: id,
    title: 'Synthetic Lords 文',
    number: 8,
    notes: 'Notes\n"verbatim"',
    authoritativeContentCount: 90,
    authoritativeNotContentCount: 91,
    tellerContentCount: 90,
    tellerNotContentCount: 91,
    memberContentCount: 88,
    memberNotContentCount: 89,
    divisionHadTellers: true,
    isGovernmentWin: false,
    sponsoringMemberId: 123,
    amendmentMotionNotes: '<p>Amendment &amp; text</p>',
    contents: [
      {
        memberId: 11,
        name: 'Lord 文',
        party: 'Crossbench',
        memberFrom: 'Peerage',
        partyIsMainParty: false,
      },
      { memberId: 12, name: 'Lady teller', party: 'Crossbench' },
      { memberId: 13, party: null },
    ],
    contentTellers: [{ memberId: 12, name: 'Lady teller', party: 'Crossbench' }],
    notContents: [
      { memberId: 14, name: null },
      { memberId: 15, party: 'Crossbench Independent' },
    ],
    notContentTellers: [{ memberId: 16, name: 'Other teller', party: 'Crossbench' }],
  };
}

/** Replace only ParliamentExchange; services and tool delivery remain real. */
export function installDivisions(route: (url: URL) => unknown | Response) {
  const requests: URL[] = [];
  initParliamentHttp({
    exchange: async (url) => {
      requests.push(new URL(url));
      const value = route(url);
      return value instanceof Response ? value : Response.json(value);
    },
  });
  return requests;
}
