/**
 * @fileoverview Members source adapters sharing one transport deadline per selected workflow.
 * @module services/members/members-service
 */
import { z } from '@cyanheads/mcp-ts-core';
import {
  getParliamentHttp,
  type ParliamentCall,
  type ParliamentHttpService,
} from '@/services/parliament-http/parliament-http-service.js';
import { type House, numericHouse } from '@/services/parliament-http/parliament-models.js';
import {
  AnsweringBodySchema,
  BiographySchema,
  CommitteeMemberSchema,
  ContactSchema,
  DepartmentSchema,
  InterestCategorySchema,
  MemberSchema,
  memberSearchSchema,
  memberValueSchema,
  PartySchema,
  VoteSchema,
} from './member-models.js';

/** Normalized filters; historical and modern parameter sets are intentionally distinct. */
export interface MemberSearch {
  asOf?: string | undefined;
  constituency?: string | undefined;
  currentOnly: boolean;
  house?: House | undefined;
  name?: string | undefined;
  partyId?: string | undefined;
}
/** Source-only adapters: no personal-data cache and no automatic cross-section hydration. */
export class MembersService {
  private readonly http: ParliamentHttpService;
  constructor(http: ParliamentHttpService) {
    this.http = http;
  }

  /** Search omits IsCurrentMember entirely for the all-members selection. */
  search(call: ParliamentCall, input: MemberSearch, offset: number, take: number) {
    const historical = Boolean(input.asOf);
    const query = historical
      ? { name: input.name, dateToSearchFor: input.asOf, skip: offset, take }
      : {
          Name: input.name,
          Location: input.constituency,
          PartyId: input.partyId,
          House: input.house ? numericHouse(input.house) : undefined,
          IsCurrentMember: input.currentOnly ? true : undefined,
          skip: offset,
          take,
        };
    return this.http.get(
      call,
      'members',
      historical ? '/api/Members/SearchHistorical' : '/api/Members/Search',
      memberSearchSchema(MemberSchema),
      query,
      historical
        ? ['name', 'dateToSearchFor', 'skip', 'take']
        : ['Name', 'Location', 'PartyId', 'House', 'IsCurrentMember', 'skip', 'take'],
    );
  }

  /** Missing profile is a successful absence; transport and validation failures still propagate. */
  profile(call: ParliamentCall, memberId: string) {
    return this.http.find(
      call,
      'members',
      `/api/Members/${memberId}`,
      memberValueSchema(MemberSchema),
    );
  }
  /** Fetch the whole biography once; preserve null categories rather than fabricating empty history. */
  biography(call: ParliamentCall, memberId: string) {
    return this.http.get(
      call,
      'members',
      `/api/Members/${memberId}/Biography`,
      memberValueSchema(BiographySchema),
    );
  }
  /** Official contact information includes its full source descriptions and notes. */
  contacts(call: ParliamentCall, memberId: string) {
    return this.http.get(
      call,
      'members',
      `/api/Members/${memberId}/Contact`,
      memberValueSchema(z.array(ContactSchema)),
    );
  }
  /** Recursive child declarations remain inside their complete interest category. */
  interests(call: ParliamentCall, memberId: string, house: House) {
    return this.http.get(
      call,
      'members',
      `/api/Members/${memberId}/RegisteredInterests`,
      memberValueSchema(z.array(InterestCategorySchema)),
      { house: numericHouse(house) },
      ['house'],
    );
  }
  /** Native page numbering starts at one; malformed source next links are never followed. */
  voting(call: ParliamentCall, memberId: string, house: House, page: number) {
    return this.http.get(
      call,
      'members',
      `/api/Members/${memberId}/Voting`,
      memberSearchSchema(VoteSchema),
      { house: numericHouse(house), page },
      ['house', 'page'],
    );
  }
  /** MNIS is the member join key; source person and membership IDs retain their own namespaces. */
  committeeSeats(call: ParliamentCall, memberId: string) {
    return this.http.get(
      call,
      'committees',
      '/api/Members',
      z.array(CommitteeMemberSchema),
      { Members: [Number(memberId)], MembershipStatus: 'All', ShowOnWebsiteOnly: true },
      ['Members', 'MembershipStatus', 'ShowOnWebsiteOnly'],
    );
  }
  /** Complete active-party directory; upstream totalResults=0 is not its collection length. */
  async parties(call: ParliamentCall, house: House) {
    const result = await this.http.get(
      call,
      'members',
      `/api/Parties/GetActive/${numericHouse(house)}`,
      memberSearchSchema(PartySchema),
    );
    return {
      items: result.data.items,
      source: result.source,
      total: result.data.items?.length,
    };
  }
  /** Fully read department directory for subsequent local reference filtering. */
  departments(call: ParliamentCall) {
    return this.http.get(call, 'members', '/api/Reference/Departments', z.array(DepartmentSchema));
  }
  /** Fully read answering-body directory, including nullable department associations. */
  answeringBodies(call: ParliamentCall) {
    return this.http.get(
      call,
      'members',
      '/api/Reference/AnsweringBodies',
      z.array(AnsweringBodySchema),
    );
  }
}
let service: MembersService | undefined;
/** Initialize after the shared transport in createApp.setup. */
export function initMembers(http: ParliamentHttpService = getParliamentHttp()): void {
  service = new MembersService(http);
}
/** Access after setup; tests can instantiate MembersService directly. */
export function getMembers(): MembersService {
  if (!service) throw new Error('Members service not initialized; call initMembers in setup.');
  return service;
}
/** Drop the process-local accessor; shared transport owns all teardown resources. */
export function disposeMembers(): void {
  service = undefined;
}
