/**
 * @fileoverview Fixed-route Committees API adapters sharing one caller deadline.
 * @module services/committees/committees-service
 */
import { z } from '@cyanheads/mcp-ts-core';
import { validationError } from '@cyanheads/mcp-ts-core/errors';
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
  type CommitteeRecordSchema,
  CommitteeSummaryRawSchema,
  normalizeCommitteeBusinessDetails,
  normalizeCommitteeBusinessSummary,
  normalizeCommitteeDetails,
  normalizeCommitteeMember,
  normalizeCommitteeSummary,
  normalizeOralEvidence,
  normalizePublication,
  normalizeWrittenEvidence,
  OralEvidenceRawSchema,
  PublicationRawSchema,
  WrittenEvidenceRawSchema,
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
/** Written and oral evidence IDs occupy distinct upstream namespaces. */
export type EvidenceType = 'written' | 'oral';
/** Official committee lifecycle selector. */
export const CommitteeStatusSchema = z.enum(['Current', 'Former', 'All']);
/** Official committee business state selector. */
export const CommitteeBusinessStatusSchema = z.enum(['Open', 'Closed']);
/** Official business ordering, applied by the source rather than locally. */
export const CommitteeBusinessSortSchema = z.enum([
  'DateOpenedNewest',
  'DateOpenedOldest',
  'PublicationDateAscending',
  'PublicationDateDescending',
]);
/** Official publication ordering, including response-date variants. */
export const CommitteePublicationSortSchema = z.enum([
  'PublicationDateAscending',
  'PublicationDateDescending',
  'ResponseDateAscending',
  'ResponseDateDescending',
]);
/** Source business filters; callers send acceptingEvidence only as true, since the source ignores false. */
export interface CommitteeBusinessFilters {
  acceptingEvidence?: boolean | undefined;
  openedFrom?: string | undefined;
  openedTo?: string | undefined;
  sortOrder?: z.infer<typeof CommitteeBusinessSortSchema> | undefined;
  status?: z.infer<typeof CommitteeBusinessStatusSchema> | undefined;
}
/** Source publication filters; type IDs serialize as repeated parameters. */
export interface CommitteePublicationFilters {
  publicationTypeIds?: string[] | undefined;
  publishedFrom?: string | undefined;
  publishedTo?: string | undefined;
  sortOrder?: z.infer<typeof CommitteePublicationSortSchema> | undefined;
}
/** Document-route envelope; only the base64 file bytes are read, the rest repeats file metadata. */
const DocumentEnvelopeSchema = z.object({
  data: z.string().describe('Base64-encoded file bytes.'),
});
/** Strict base64 (canonical round trip) of UTF-8 text; a BOM and every character stay verbatim. */
function decodeHtml(data: string): string {
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data)
    throw validationError('Committee document data is not canonical base64.', {
      retryable: false,
    });
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (cause) {
    throw validationError(
      'Committee document Html is not valid UTF-8.',
      { retryable: false },
      { cause },
    );
  }
}
/** Fixed-route adapters; only evidence_document reads a file, the evidence Html rendition. */
export class CommitteesService {
  private readonly http: ParliamentHttpService;
  constructor(http: ParliamentHttpService) {
    this.http = http;
  }

  /** Search summaries, retaining complete parent/subcommittee metadata. */
  async search(
    call: ParliamentCall,
    input: {
      query?: string | undefined;
      house?: CommitteeHouse | undefined;
      status?: z.infer<typeof CommitteeStatusSchema> | undefined;
    },
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
        CommitteeStatus: input.status,
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
      ['SearchTerm', 'CommitteeStatus', 'House', 'ShowOnWebsiteOnly', 'Skip', 'Take'],
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
    committeeId: string | undefined,
    query: string | undefined,
    skip: number,
    take: number,
    filters: CommitteeBusinessFilters = {},
  ) {
    const response = await this.http.get(
      call,
      'committees',
      '/api/CommitteeBusiness',
      collectionSchema(CommitteeBusinessSummaryRawSchema),
      {
        CommitteeId: committeeId === undefined ? undefined : Number(committeeId),
        SearchTerm: query,
        Status: filters.status,
        CurrentlyAcceptingEvidence: filters.acceptingEvidence,
        DateFrom: filters.openedFrom,
        DateTo: filters.openedTo,
        SortOrder: filters.sortOrder,
        ShowOnWebsiteOnly: true,
        Skip: skip,
        Take: take,
      },
      [
        'CommitteeId',
        'SearchTerm',
        'Status',
        'CurrentlyAcceptingEvidence',
        'DateFrom',
        'DateTo',
        'SortOrder',
        'ShowOnWebsiteOnly',
        'Skip',
        'Take',
      ],
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

  /**
   * Publication metadata includes all types; a null file URL stays null. Items omit the committee,
   * which every row of one committee's list repeats; mode=publication keeps it.
   */
  async publications(
    call: ParliamentCall,
    committeeId: string,
    businessId: string | undefined,
    query: string | undefined,
    skip: number,
    take: number,
    filters: CommitteePublicationFilters = {},
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
        SortOrder: filters.sortOrder,
        PublicationTypeIds: filters.publicationTypeIds,
        StartDate: filters.publishedFrom,
        EndDate: filters.publishedTo,
        ShowOnWebsiteOnly: true,
        Skip: skip,
        Take: take,
      },
      [
        'CommitteeId',
        'CommitteeBusinessId',
        'SearchTerm',
        'SortOrder',
        'PublicationTypeIds',
        'StartDate',
        'EndDate',
        'ShowOnWebsiteOnly',
        'Skip',
        'Take',
      ],
    );
    return {
      ...response,
      data: {
        ...response.data,
        itemsState: response.data.items === null ? ('null' as const) : ('present' as const),
        items:
          response.data.items?.map((item) =>
            normalizePublication({ ...item, committee: undefined }),
          ) ?? [],
      },
    };
  }

  private singular<T extends z.ZodType>(call: ParliamentCall, path: string, schema: T) {
    return this.http.find(call, 'committees', path, schema, { showOnWebsiteOnly: true }, [
      'showOnWebsiteOnly',
    ]);
  }

  /**
   * Page one business's website-visible written submissions or oral sessions. Written items omit the
   * committees and business every row repeats; oral items keep theirs, since one session can cover
   * several businesses.
   */
  evidence(
    call: ParliamentCall,
    evidenceType: EvidenceType,
    businessId: string,
    skip: number,
    take: number,
  ) {
    const fetch = async <T extends z.ZodType>(
      path: string,
      schema: T,
      normalize: (value: z.output<T>) => z.infer<typeof CommitteeRecordSchema>,
    ) => {
      const response = await this.http.get(
        call,
        'committees',
        path,
        collectionSchema(schema),
        {
          CommitteeBusinessId: Number(businessId),
          ShowOnWebsiteOnly: true,
          Skip: skip,
          Take: take,
        },
        ['CommitteeBusinessId', 'ShowOnWebsiteOnly', 'Skip', 'Take'],
      );
      return {
        ...response,
        data: {
          ...response.data,
          itemsState: response.data.items === null ? ('null' as const) : ('present' as const),
          items: response.data.items?.map(normalize) ?? [],
        },
      };
    };
    return evidenceType === 'written'
      ? fetch('/api/WrittenEvidence', WrittenEvidenceRawSchema, (item) =>
          normalizeWrittenEvidence({
            ...item,
            committees: undefined,
            committeeBusiness: undefined,
          }),
        )
      : fetch('/api/OralEvidence', OralEvidenceRawSchema, normalizeOralEvidence);
  }
  /**
   * The evidence record, then its own published Html rendition decoded verbatim. Only the record
   * decides a miss: no listed Html file or a document 404 leaves `document` undefined.
   */
  async evidenceDocument(call: ParliamentCall, evidenceType: EvidenceType, evidenceId: string) {
    const record = await this.evidenceDetail(call, evidenceType, evidenceId);
    if (!record) return;
    // The evidence's own document only; nested business reports list publication files.
    const route = record.data.entities.flatMap((node) =>
      node.kind === 'DocumentFile' &&
      node.fileDataFormat === 'Html' &&
      node.sourcePath.startsWith('/document/files/') &&
      node.apiRoute !== undefined
        ? [node.apiRoute]
        : [],
    )[0];
    const response = route ? await this.singular(call, route, DocumentEnvelopeSchema) : undefined;
    return {
      ...record,
      document: response && { html: decodeHtml(response.data.data), source: response.source },
    };
  }
  /** A missing evidence detail is a successful namespace-specific miss. */
  async evidenceDetail(call: ParliamentCall, evidenceType: EvidenceType, evidenceId: string) {
    if (evidenceType === 'written') {
      const response = await this.singular(
        call,
        `/api/WrittenEvidence/${evidenceId}`,
        WrittenEvidenceRawSchema,
      );
      return response ? { ...response, data: normalizeWrittenEvidence(response.data) } : undefined;
    }
    const response = await this.singular(
      call,
      `/api/OralEvidence/${evidenceId}`,
      OralEvidenceRawSchema,
    );
    return response ? { ...response, data: normalizeOralEvidence(response.data) } : undefined;
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
