/**
 * @fileoverview Fixed-route Committees API adapters sharing one caller deadline.
 * @module services/committees/committees-service
 */
import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  getParliamentHttp,
  type ParliamentCall,
  type ParliamentHttpService,
} from '@/services/parliament-http/parliament-http-service.js';
import {
  CommitteeBusinessDetailsRawSchema,
  CommitteeBusinessSummaryRawSchema,
  CommitteeDetailsRawSchema,
  CommitteeMemberRawSchema,
  CommitteeSummaryRawSchema,
  normalizeCommitteeBusinessDetails,
  normalizeCommitteeBusinessSummary,
  normalizeCommitteeDetails,
  normalizeCommitteeMember,
  normalizeCommitteeSummary,
  normalizePublication,
  PublicationRawSchema,
} from './committee-models.js';

/** Published navigation metadata; links never become request targets. */
export const CommitteeLinkSchema = z
  .object({
    rel: z.string().nullish().describe('Published relationship.'),
    href: z.string().nullish().describe('Published URL, possibly relative.'),
    method: z.string().nullish().describe('Published HTTP method.'),
  })
  .describe('Published source relationship metadata.');
function collectionSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item).nullable().describe('Whole selected source records.'),
    totalResults: z.number().int().nonnegative().describe('Complete source match count.'),
    itemsPerPage: z.number().int().nonnegative().describe('Source page-size metadata.'),
    links: z.array(CommitteeLinkSchema).nullish().describe('Published collection links.'),
  });
}
/** Caller chamber; Joint is a distinct supported Committees API House. */
export type CommitteeHouse = 'commons' | 'lords' | 'joint';
/** Complete membership-period selector. */
export type CommitteeMembership = 'all' | 'current' | 'former';
/** Fixed-route adapters; no evidence documents are downloaded. */
export class CommitteesService {
  private readonly http: ParliamentHttpService;
  constructor(http: ParliamentHttpService) {
    this.http = http;
  }

  /** Search summaries, retaining complete parent/subcommittee metadata. */
  async search(
    call: ParliamentCall,
    input: { query?: string | undefined; house?: CommitteeHouse | undefined },
    skip: number,
    take: number,
  ) {
    const response = await this.http.get(
      call,
      'committees',
      '/api/Committees',
      collectionSchema(CommitteeSummaryRawSchema),
      {
        SearchTerm: input.query,
        House:
          input.house === undefined
            ? undefined
            : input.house === 'commons'
              ? 'Commons'
              : input.house === 'lords'
                ? 'Lords'
                : 'Joint',
        ShowOnWebsiteOnly: true,
        Skip: skip,
        Take: take,
      },
      ['SearchTerm', 'House', 'ShowOnWebsiteOnly', 'Skip', 'Take'],
    );
    return {
      ...response,
      data: {
        ...response.data,
        itemsState: response.data.items === null ? ('null' as const) : ('present' as const),
        items: response.data.items?.map(normalizeCommitteeSummary) ?? [],
      },
    };
  }

  /** All role periods and distinct source-person and MNIS identifiers. */
  async members(
    call: ParliamentCall,
    committeeId: string,
    membership: CommitteeMembership,
    skip: number,
    take: number,
  ) {
    const response = await this.http.get(
      call,
      'committees',
      `/api/Committees/${committeeId}/Members`,
      collectionSchema(CommitteeMemberRawSchema),
      {
        MembershipStatus:
          membership === 'all' ? 'All' : membership === 'current' ? 'Current' : 'Former',
        ShowOnWebsiteOnly: true,
        Skip: skip,
        Take: take,
      },
      ['MembershipStatus', 'ShowOnWebsiteOnly', 'Skip', 'Take'],
    );
    return {
      ...response,
      data: {
        ...response.data,
        itemsState: response.data.items === null ? ('null' as const) : ('present' as const),
        items: response.data.items?.map(normalizeCommitteeMember) ?? [],
      },
    };
  }

  /** Return every business type, including records with isInquiry=false. */
  async inquiries(
    call: ParliamentCall,
    committeeId: string,
    query: string | undefined,
    skip: number,
    take: number,
  ) {
    const response = await this.http.get(
      call,
      'committees',
      '/api/CommitteeBusiness',
      collectionSchema(CommitteeBusinessSummaryRawSchema),
      {
        CommitteeId: Number(committeeId),
        SearchTerm: query,
        ShowOnWebsiteOnly: true,
        Skip: skip,
        Take: take,
      },
      ['CommitteeId', 'SearchTerm', 'ShowOnWebsiteOnly', 'Skip', 'Take'],
    );
    return {
      ...response,
      data: {
        ...response.data,
        itemsState: response.data.items === null ? ('null' as const) : ('present' as const),
        items: response.data.items?.map(normalizeCommitteeBusinessSummary) ?? [],
      },
    };
  }

  /** Publication metadata includes all types; a null file URL stays null. */
  async publications(
    call: ParliamentCall,
    committeeId: string,
    businessId: string | undefined,
    query: string | undefined,
    skip: number,
    take: number,
  ) {
    const response = await this.http.get(
      call,
      'committees',
      '/api/Publications',
      collectionSchema(PublicationRawSchema),
      {
        CommitteeId: Number(committeeId),
        CommitteeBusinessId: businessId === undefined ? undefined : Number(businessId),
        SearchTerm: query,
        ShowOnWebsiteOnly: true,
        Skip: skip,
        Take: take,
      },
      ['CommitteeId', 'CommitteeBusinessId', 'SearchTerm', 'ShowOnWebsiteOnly', 'Skip', 'Take'],
    );
    return {
      ...response,
      data: {
        ...response.data,
        itemsState: response.data.items === null ? ('null' as const) : ('present' as const),
        items: response.data.items?.map(normalizePublication) ?? [],
      },
    };
  }

  private async singular<T extends z.ZodType>(call: ParliamentCall, path: string, schema: T) {
    try {
      return await this.http.get(call, 'committees', path, schema, { showOnWebsiteOnly: true }, [
        'showOnWebsiteOnly',
      ]);
    } catch (error) {
      call.signal.throwIfAborted();
      if (
        error instanceof McpError &&
        (error.code === JsonRpcErrorCode.NotFound ||
          error.data?.status === 404 ||
          error.data?.statusCode === 404)
      )
        return;
      throw error;
    }
  }

  /** Missing entity 404 is a successful miss; operational failures propagate. */
  async detail(call: ParliamentCall, committeeId: string) {
    const response = await this.singular(
      call,
      `/api/Committees/${committeeId}`,
      CommitteeDetailsRawSchema,
    );
    return response ? { ...response, data: normalizeCommitteeDetails(response.data) } : undefined;
  }
  /** Full business detail includes submission periods, latest report and evidence session. */
  async inquiry(call: ParliamentCall, businessId: string) {
    const response = await this.singular(
      call,
      `/api/CommitteeBusiness/${businessId}`,
      CommitteeBusinessDetailsRawSchema,
    );
    return response
      ? { ...response, data: normalizeCommitteeBusinessDetails(response.data) }
      : undefined;
  }
  /** Full publication detail preserves response and document relationships. */
  async publication(call: ParliamentCall, publicationId: string) {
    const response = await this.singular(
      call,
      `/api/Publications/${publicationId}`,
      PublicationRawSchema,
    );
    return response ? { ...response, data: normalizePublication(response.data) } : undefined;
  }
}
let service: CommitteesService | undefined;
/** Initialize after the shared HTTP transport. */
export function initCommittees(http: ParliamentHttpService = getParliamentHttp()): void {
  service = new CommitteesService(http);
}
/** Return the initialized Committees adapter. */
export function getCommittees(): CommitteesService {
  if (!service)
    throw new Error('Committees service not initialized; call initCommittees in setup.');
  return service;
}
/** Transport owns queues and timers; this adapter retains no cache or resources. */
export function disposeCommittees(): void {
  service = undefined;
}
