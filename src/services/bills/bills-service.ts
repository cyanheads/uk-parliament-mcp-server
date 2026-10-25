/**
 * @fileoverview Bills search, selected scrutiny records and complete reference sets.
 * @module services/bills/bills-service
 */
import { z } from '@cyanheads/mcp-ts-core';
import {
  invalidParams,
  JsonRpcErrorCode,
  McpError,
  validationError,
} from '@cyanheads/mcp-ts-core/errors';
import {
  advanceCollectionCursor,
  invalidCursor,
  readCollectionCursor,
} from '../parliament-http/parliament-cursors.js';
import {
  getParliamentHttp,
  type ParliamentCall,
  type ParliamentHttpService,
  type ParliamentResponse,
} from '../parliament-http/parliament-http-service.js';
import type { House, Link, Source } from '../parliament-http/parliament-models.js';
import {
  BillHitSchema,
  type BillSectionSchema,
  Bills,
  billsPage,
  GetBillOutputSchema,
  normalizeBillValue,
  RawBills,
} from './bills-schemas.js';

/** Normalized Bills search filters. */
export interface SearchBillsInput {
  billTypeIds?: string[] | undefined;
  cursor?: string | undefined;
  house?: House | undefined;
  limit: number;
  memberId?: string | undefined;
  query?: string | undefined;
  sessionId?: string | undefined;
  stageIds?: string[] | undefined;
}
/** Selected bill section with bill-specific stage and item identifiers. */
export interface GetBillInput {
  billId: string;
  billStageId?: string | undefined;
  cursor?: string | undefined;
  itemId?: string | undefined;
  limit?: number | undefined;
  section: z.infer<typeof BillSectionSchema>;
}
/** A full reference set and all request provenance, ready for local filtering. */
export interface BillsReferenceSet {
  items: z.infer<typeof Bills.reference>[];
  sources: Source[];
}
/** Read selected Bills branches using one caller-owned transport deadline. */
export class BillsService {
  private readonly http: ParliamentHttpService;
  constructor(http: ParliamentHttpService) {
    this.http = http;
  }

  /** Fetch every authoritative reference page before callers validate or filter IDs. */
  async references(
    topic: 'bill_stages' | 'bill_types',
    call: ParliamentCall,
  ): Promise<BillsReferenceSet> {
    const path = topic === 'bill_stages' ? '/api/v1/Stages' : '/api/v1/BillTypes';
    const items: BillsReferenceSet['items'] = [];
    const sources: Source[] = [];
    let total: number;
    do {
      const response = await this.http.get(
        call,
        'bills',
        path,
        billsPage(RawBills.reference),
        { Skip: items.length, Take: 100 },
        ['Skip', 'Take'],
      );
      sources.push(response.source);
      total = response.data.totalResults;
      const rows = response.data.items ?? [];
      if (!rows.length && items.length < total)
        throw validationError('Bills reference pagination ended before its advertised total.');
      items.push(...rows.map((item) => Bills.reference.parse(normalizeBillValue(item))));
    } while (items.length < total);
    return { items, sources };
  }

  /** Search summaries without detail fan-out; reject unsupported stage/type IDs first. */
  async search(input: SearchBillsInput, call: ParliamentCall) {
    for (const [topic, ids] of [
      ['bill_stages', input.stageIds],
      ['bill_types', input.billTypeIds],
    ] as const) {
      if (!ids?.length) continue;
      const reference = await this.references(topic, call);
      const known = new Set(reference.items.map((item) => item.id));
      if (ids.some((id) => !known.has(id)))
        throw invalidParams(
          'The selected reference set does not contain a supplied Bills filter ID.',
          { reason: 'unknown_reference_id' },
        );
    }
    const { cursor: _cursor, limit, ...filters } = input;
    const cursor = readCollectionCursor(input.cursor, {
      source: 'bills',
      selector: 'search',
      filters,
      nativePageSize: limit,
    });
    if (cursor.offset > 2147483647) return invalidCursor();
    const response = await this.http.get(
      call,
      'bills',
      '/api/v1/Bills',
      billsPage(RawBills.bill),
      {
        SearchTerm: input.query,
        CurrentHouse:
          input.house === undefined ? undefined : input.house === 'commons' ? 'Commons' : 'Lords',
        Session: input.sessionId,
        MemberId: input.memberId,
        BillStage: input.stageIds,
        BillType: input.billTypeIds,
        Skip: cursor.offset,
        Take: limit,
      },
      [
        'SearchTerm',
        'CurrentHouse',
        'Session',
        'MemberId',
        'BillStage',
        'BillType',
        'Skip',
        'Take',
      ],
    );
    const rows = (response.data.items ?? []).slice(0, limit).map((item) =>
      BillHitSchema.parse({
        ...Bills.bill.parse(normalizeBillValue(item)),
        source: response.source,
        detailLevel: 'summary',
      }),
    );
    if (!rows.length && cursor.offset < response.data.totalResults)
      throw validationError(
        'Bills search pagination returned an empty page before its advertised total. Repeat ukparl_search_bills with the same filters and no cursor to restart pagination.',
      );
    const repage = (count: number) => ({
      ...(input.query ? { query: input.query } : {}),
      items: rows.slice(0, count),
      page: {
        returned: count,
        total: response.data.totalResults,
        hasMore: cursor.offset + count < response.data.totalResults,
        ...(cursor.offset + count < response.data.totalResults
          ? { nextCursor: advanceCollectionCursor(cursor, count) }
          : {}),
      },
    });
    return { payload: repage(rows.length), repage, count: rows.length };
  }

  private async entity<T>(
    call: ParliamentCall,
    path: string,
    schema: z.ZodType<T>,
  ): Promise<ParliamentResponse<T> | undefined> {
    try {
      return await this.http.get(call, 'bills', path, schema);
    } catch (error) {
      call.signal.throwIfAborted();
      if (error instanceof McpError && error.code === JsonRpcErrorCode.NotFound) return undefined;
      throw error;
    }
  }

  /** Retrieve only the selected section; publications are paged locally after complete validation. */
  async get(input: GetBillInput, call: ParliamentCall) {
    const section = input.section;
    const collection = ['stages', 'publications', 'amendments', 'motions'].includes(section);
    const needsStage = ['stage', 'amendments', 'amendment', 'motions', 'motion'].includes(section);
    const needsItem = section === 'amendment' || section === 'motion';
    if (
      needsStage !== Boolean(input.billStageId) ||
      needsItem !== Boolean(input.itemId) ||
      (!collection && (input.cursor !== undefined || input.limit !== undefined))
    )
      throw invalidParams(
        'Use only identifiers and pagination fields for the selected bill section.',
        { reason: 'invalid_mode_arguments' },
      );
    const limit = Math.min(input.limit ?? 20, 50);
    const filters = {
      billId: input.billId,
      section,
      ...(input.billStageId ? { billStageId: input.billStageId } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
    };
    const cursor = collection
      ? readCollectionCursor(input.cursor, {
          source: 'bills',
          selector: section,
          filters,
          nativePageSize: limit,
        })
      : undefined;
    if (cursor && cursor.offset > 2147483647) return invalidCursor();
    const base = `/api/v1/Bills/${input.billId}`;
    const stageBase = `${base}/Stages/${input.billStageId}`;
    const parent = await this.entity(call, base, RawBills.billDetail);
    const miss = (guidance: string) => ({
      payload: GetBillOutputSchema.omit({ delivery: true }).parse({
        found: false,
        billId: input.billId,
        section,
        guidance,
      }),
      count: 0,
    });
    if (!parent)
      return miss('Call ukparl_search_bills to find a billId before repeating ukparl_get_bill.');
    const bill = Bills.billDetail.parse(normalizeBillValue(parent.data));
    const handoff = (publications: z.infer<typeof Bills.publication>[] = []) => {
      const links: Link[] = [];
      for (const publication of publications) {
        for (const link of publication.links ?? []) {
          if (!link.url) continue;
          let url: URL;
          try {
            url = new URL(link.url);
          } catch {
            continue;
          }
          if (
            url.protocol === 'https:' &&
            (url.hostname === 'legislation.gov.uk' || url.hostname.endsWith('.legislation.gov.uk'))
          )
            links.push({
              url: link.url,
              label: link.title ?? publication.title ?? 'Published statute',
              documentId: link.id,
              ...(link.contentType ? { format: link.contentType } : {}),
            });
        }
        for (const file of publication.files ?? []) {
          if (!file.downloadUrl) continue;
          let url: URL;
          try {
            url = new URL(file.downloadUrl);
          } catch {
            continue;
          }
          if (
            url.protocol === 'https:' &&
            (url.hostname === 'legislation.gov.uk' || url.hostname.endsWith('.legislation.gov.uk'))
          )
            links.push({
              url: file.downloadUrl,
              label: file.filename ?? publication.title ?? 'Published statute',
              documentId: file.id,
              ...(file.contentType ? { format: file.contentType } : {}),
            });
        }
      }
      return links.length
        ? { status: 'authoritative_link' as const, links }
        : bill.isAct === false
          ? { status: 'not_enacted' as const, links }
          : {
              status: 'unavailable' as const,
              links,
              reason: 'Parliament supplied no authoritative statute link.',
            };
    };
    if (section === 'overview')
      return {
        payload: GetBillOutputSchema.omit({ delivery: true }).parse({
          found: true,
          section,
          billId: input.billId,
          record: bill,
          source: parent.source,
          detailLevel: 'complete',
          legislationHandoff: handoff(),
        }),
        count: 0,
      };
    if (!collection) {
      const path =
        section === 'stage'
          ? stageBase
          : `${stageBase}/${section === 'amendment' ? 'Amendments' : 'PingPongItems'}/${input.itemId}`;
      const schema =
        section === 'stage'
          ? RawBills.stageDetail
          : section === 'amendment'
            ? RawBills.amendmentDetail
            : RawBills.pingpong;
      const response = await this.entity<z.infer<typeof schema>>(call, path, schema);
      if (!response)
        return miss(
          `Repeat ukparl_get_bill with section=${section === 'stage' ? 'stages' : section === 'amendment' ? 'amendments' : 'motions'} and the same parent identifiers to find the selected item ID.`,
        );
      return {
        payload: GetBillOutputSchema.omit({ delivery: true }).parse({
          found: true,
          section,
          billId: input.billId,
          record: normalizeBillValue(response.data),
          source: response.source,
          detailLevel: 'complete',
        }),
        count: 0,
      };
    }
    if (!cursor) throw new Error('Collection cursor must exist after section validation.');
    let rows: z.infer<typeof GetBillOutputSchema>['items'];
    let source: Source;
    let total: number;
    let publications: z.infer<typeof Bills.publication>[] | undefined;
    if (section === 'publications') {
      const response = await this.entity(
        call,
        `${base}/Publications`,
        z.object({
          billId: z.number().int(),
          publications: z.array(RawBills.publication).nullable(),
        }),
      );
      if (!response)
        return miss('Repeat ukparl_get_bill with section=overview to verify the parent bill.');
      publications = (response.data.publications ?? []).map((item) =>
        Bills.publication.parse(normalizeBillValue(item)),
      );
      rows = publications.slice(cursor.offset, cursor.offset + limit);
      total = publications.length;
      source = response.source;
    } else {
      const path =
        section === 'stages'
          ? `${base}/Stages`
          : `${stageBase}/${section === 'amendments' ? 'Amendments' : 'PingPongItems'}`;
      const schema =
        section === 'stages'
          ? billsPage(RawBills.stage)
          : section === 'amendments'
            ? billsPage(RawBills.amendment)
            : billsPage(RawBills.pingpong);
      let response: ParliamentResponse<z.infer<typeof schema>>;
      try {
        response = await this.http.get<typeof schema>(
          call,
          'bills',
          path,
          schema,
          { Skip: cursor.offset, Take: limit },
          ['Skip', 'Take'],
        );
      } catch (error) {
        call.signal.throwIfAborted();
        if (error instanceof McpError && error.code === JsonRpcErrorCode.NotFound)
          return miss(
            'Repeat ukparl_get_bill with section=stages to find a bill-specific billStageId.',
          );
        throw error;
      }
      rows = z
        .array(GetBillOutputSchema.shape.items.unwrap().element)
        .parse(normalizeBillValue(response.data.items ?? []))
        .slice(0, limit);
      total = response.data.totalResults;
      if (!rows.length && cursor.offset < total)
        throw validationError(
          `Bills ${section} pagination returned an empty page before its advertised total. Repeat ukparl_get_bill with the same section and parent identifiers and no cursor to restart pagination.`,
        );
      source = response.source;
    }
    const selectedRows = rows;
    const repage = (count: number) =>
      GetBillOutputSchema.omit({ delivery: true }).parse({
        found: true,
        section,
        billId: input.billId,
        items: selectedRows.slice(0, count),
        source,
        detailLevel: section === 'amendments' || section === 'motions' ? 'summary' : 'complete',
        page: {
          returned: count,
          total,
          hasMore: cursor.offset + count < total,
          ...(cursor.offset + count < total
            ? { nextCursor: advanceCollectionCursor(cursor, count) }
            : {}),
        },
        ...(publications ? { legislationHandoff: handoff(publications) } : {}),
      });
    return { payload: repage(rows.length), repage, count: rows.length };
  }
}
let service: BillsService | undefined;
/** Initialize after the shared Parliament transport. */
export function initBillsService(http: ParliamentHttpService = getParliamentHttp()): void {
  service = new BillsService(http);
}
/** Access the Bills service after application setup. */
export function getBillsService(): BillsService {
  if (!service) throw new Error('Bills service not initialized; call initBillsService in setup.');
  return service;
}
/** Release the Bills accessor; shared transport teardown owns network cancellation. */
export function disposeBillsService(): void {
  service = undefined;
}
