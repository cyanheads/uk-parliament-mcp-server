/**
 * @fileoverview Bills search, selected scrutiny records and complete reference sets.
 * @module services/bills/bills-service
 */
import { z } from '@cyanheads/mcp-ts-core';
import { invalidParams, validationError } from '@cyanheads/mcp-ts-core/errors';
import { pageFor, readCollectionCursor } from '../parliament-http/parliament-cursors.js';
import {
  getParliamentHttp,
  type ParliamentCall,
  type ParliamentHttpService,
} from '../parliament-http/parliament-http-service.js';
import type { House, Link, Source } from '../parliament-http/parliament-models.js';
import {
  type AmendmentDecisionSchema,
  BillHitSchema,
  type BillSectionSchema,
  type BillSortOrderSchema,
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
  departmentId?: string | undefined;
  house?: House | undefined;
  inAmendableStage?: boolean | undefined;
  isDefeated?: boolean | undefined;
  isWithdrawn?: boolean | undefined;
  limit: number;
  memberId?: string | undefined;
  originatingHouse?: House | undefined;
  query?: string | undefined;
  sessionId?: string | undefined;
  sortOrder?: z.infer<typeof BillSortOrderSchema> | undefined;
  stageIds?: string[] | undefined;
}
/** Selected bill section with bill-specific stage and item identifiers. */
export interface GetBillInput {
  amendmentNumber?: string | undefined;
  billId: string;
  billStageId?: string | undefined;
  cursor?: string | undefined;
  decision?: z.infer<typeof AmendmentDecisionSchema> | undefined;
  itemId?: string | undefined;
  limit?: number | undefined;
  memberId?: string | undefined;
  section: z.infer<typeof BillSectionSchema>;
}
/** A full reference set and all request provenance, ready for local filtering. */
export interface BillsReferenceSet {
  items: z.infer<typeof Bills.reference>[];
  sources: Source[];
}
/** Only an HTTPS legislation.gov.uk URL establishes a statute handoff. */
function isLegislationUrl(value: string): boolean {
  const url = URL.parse(value);
  return (
    url?.protocol === 'https:' &&
    (url.hostname === 'legislation.gov.uk' || url.hostname.endsWith('.legislation.gov.uk'))
  );
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
        DepartmentId: input.departmentId,
        SortOrder: input.sortOrder,
        OriginatingHouse:
          input.originatingHouse === undefined
            ? undefined
            : input.originatingHouse === 'commons'
              ? 'Commons'
              : 'Lords',
        IsDefeated: input.isDefeated,
        IsWithdrawn: input.isWithdrawn,
        IsInAmendableStage: input.inAmendableStage,
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
        'DepartmentId',
        'SortOrder',
        'OriginatingHouse',
        'IsDefeated',
        'IsWithdrawn',
        'IsInAmendableStage',
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
      page: pageFor(cursor, count, response.data.totalResults),
    });
    return { payload: repage(rows.length), repage, count: rows.length };
  }

  /** Retrieve only the selected section; publications are paged locally after complete validation. */
  async get(input: GetBillInput, call: ParliamentCall) {
    const section = input.section;
    const collection = ['stages', 'publications', 'amendments', 'motions'].includes(section);
    const needsStage = ['stage', 'amendments', 'amendment', 'motions', 'motion'].includes(section);
    const needsItem = section === 'amendment' || section === 'motion';
    const conflicts: string[] = [];
    if (needsStage !== Boolean(input.billStageId))
      conflicts.push(
        needsStage
          ? `section=${section} requires billStageId; retrieve it with section=stages.`
          : `billStageId is unsupported for section=${section}; omit billStageId or select stage, amendments, amendment, motions or motion.`,
      );
    if (needsItem !== Boolean(input.itemId))
      conflicts.push(
        needsItem
          ? `section=${section} requires itemId; retrieve it with section=${section === 'amendment' ? 'amendments' : 'motions'}.`
          : `itemId is unsupported for section=${section}; omit itemId or select amendment or motion.`,
      );
    for (const field of ['cursor', 'limit'] as const)
      if (!collection && input[field] !== undefined)
        conflicts.push(
          `${field} is unsupported for section=${section}; omit ${field} or select stages, publications, amendments or motions.`,
        );
    for (const field of ['amendmentNumber', 'decision', 'memberId'] as const)
      if (section !== 'amendments' && input[field] !== undefined)
        conflicts.push(
          `${field} is unsupported for section=${section}; omit ${field} or select amendments.`,
        );
    if (conflicts.length)
      throw invalidParams(conflicts.join(' '), { reason: 'invalid_mode_arguments' });
    const limit = Math.min(input.limit ?? 20, 50);
    const filters = {
      billId: input.billId,
      section,
      ...(input.billStageId ? { billStageId: input.billStageId } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
      ...(input.amendmentNumber !== undefined ? { amendmentNumber: input.amendmentNumber } : {}),
      ...(input.decision !== undefined ? { decision: input.decision } : {}),
      ...(input.memberId !== undefined ? { memberId: input.memberId } : {}),
    };
    const cursor = collection
      ? readCollectionCursor(input.cursor, {
          source: 'bills',
          selector: section,
          filters,
          nativePageSize: limit,
        })
      : undefined;
    const base = `/api/v1/Bills/${input.billId}`;
    const stageBase = `${base}/Stages/${input.billStageId}`;
    const parent = await this.http.find(call, 'bills', base, RawBills.billDetail);
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
    const handoff = (publications?: z.infer<typeof Bills.publication>[]) => {
      const links: Link[] = [];
      for (const publication of publications ?? []) {
        const published = [
          ...(publication.links ?? []).map((link) => ({
            url: link.url,
            label: link.title,
            documentId: link.id,
            format: link.contentType,
          })),
          ...(publication.files ?? []).map((file) => ({
            url: file.downloadUrl,
            label: file.filename,
            documentId: file.id,
            format: file.contentType,
          })),
        ];
        for (const { url, label, documentId, format } of published)
          if (url && isLegislationUrl(url))
            links.push({
              url,
              label: label ?? publication.title ?? 'Published statute',
              documentId,
              ...(format ? { format } : {}),
            });
      }
      return links.length
        ? { status: 'authoritative_link' as const, links }
        : bill.isAct === false
          ? { status: 'not_enacted' as const, links }
          : {
              status: 'unavailable' as const,
              links,
              reason:
                publications === undefined
                  ? 'Overview has not checked publications. Repeat ukparl_get_bill with the same billId and section=publications to discover authoritative statute links.'
                  : 'Parliament supplied no authoritative statute link.',
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
      const response = await this.http.find(call, 'bills', path, schema);
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
      const response = await this.http.find(
        call,
        'bills',
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
      const response = await this.http.find(
        call,
        'bills',
        path,
        schema,
        {
          Skip: cursor.offset,
          Take: limit,
          ...(section === 'amendments'
            ? {
                AmendmentNumber: input.amendmentNumber,
                Decision: input.decision,
                MemberId: input.memberId,
              }
            : {}),
        },
        section === 'amendments'
          ? ['Skip', 'Take', 'AmendmentNumber', 'Decision', 'MemberId']
          : ['Skip', 'Take'],
      );
      if (!response)
        return miss(
          'Repeat ukparl_get_bill with section=stages to find a bill-specific billStageId.',
        );
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
        page: pageFor(cursor, count, total),
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
