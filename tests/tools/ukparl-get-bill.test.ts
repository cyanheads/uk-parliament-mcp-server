/**
 * @fileoverview Selected Bills records, recovery and lossless delivery on both MCP surfaces.
 * @module tests/tools/ukparl-get-bill.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ukparlGetBill } from '@/mcp-server/tools/definitions/ukparl-get-bill.tool.js';
import { disposeBillsService } from '@/services/bills/bills-service.js';
import { digest, encodeCursor } from '@/services/parliament-http/parliament-cursors.js';
import { disposeParliamentHttp } from '@/services/parliament-http/parliament-http-service.js';
import { LICENCE_NOTICE } from '@/services/parliament-http/parliament-models.js';
import {
  amendment,
  amendmentDetail,
  bill,
  installBills,
  motion,
  page,
  publication,
  stage,
  withFullBillsQueue,
} from '../services/bills/bills-fixtures.js';

function text(result: Awaited<ReturnType<typeof runToolContract>>) {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/** Assert each source scalar survives the reversible formatter, including every nested line. */
function expectScalars(rendered: string, value: unknown): void {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) expectScalars(rendered, item);
  } else if (typeof value === 'string') expect(rendered).toContain(JSON.stringify(value));
  else expect(rendered).toContain(String(value));
}

type Output = ReturnType<typeof ukparlGetBill.output.parse>;
type Selection = { billId: string; section: 'overview' | 'stages'; limit?: number };

/** Traverse every continuation descriptor and concatenate scalar chunks before decoding. */
async function reconstruct(selection: Selection, initial: Output): Promise<unknown> {
  const content = initial.contentPage!;
  if (content.fragment !== undefined) {
    let encoded = content.fragment;
    let cursor = content.nextCursor;
    while (cursor) {
      const result = await runToolContract(ukparlGetBill, { ...selection, contentCursor: cursor });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
      const output = ukparlGetBill.output.parse(result.structuredContent);
      expect(output.contentPage?.offset).toBe(encoded.length);
      expect(text(result)).toContain(JSON.stringify(output.contentPage!.fragment));
      encoded += output.contentPage!.fragment!;
      cursor = output.contentPage!.nextCursor;
    }
    return JSON.parse(encoded);
  }
  const children: [string, unknown][] = [];
  let current: Output | undefined = initial;
  while (current) {
    for (const entry of current.contentPage!.entries!) {
      const result = await runToolContract(ukparlGetBill, {
        ...selection,
        contentCursor: entry.contentCursor,
      });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
      const output = ukparlGetBill.output.parse(result.structuredContent);
      expect(output.contentPage?.path).toBe(entry.path);
      expect(text(result)).toContain(entry.path);
      children.push([
        entry.path
          .slice(entry.path.lastIndexOf('/') + 1)
          .replaceAll('~1', '/')
          .replaceAll('~0', '~'),
        await reconstruct(selection, output),
      ]);
    }
    const next: string | undefined = current.contentPage!.nextCursor;
    if (!next) break;
    const result = await runToolContract(ukparlGetBill, { ...selection, contentCursor: next });
    expect(result.isError).not.toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
    current = ukparlGetBill.output.parse(result.structuredContent);
  }
  return content.kind === 'array'
    ? children.map(([, value]) => value)
    : Object.fromEntries(children);
}

afterEach(() => {
  disposeBillsService();
  disposeParliamentHttp();
});

describe('ukparl_get_bill selected content', () => {
  it('returns full overview metadata, preserving sparse nulls and source-only enactment uncertainty', async () => {
    const record = {
      ...bill(),
      isAct: null,
      longTitle: 'A Bill to provide synthetic safeguards',
      summary: '<p>Complete summary\n  including spaces.</p>',
      sponsors: [
        {
          member: {
            memberId: 77,
            name: 'Synthetic Sponsor',
            memberPage: 'https://members.parliament.uk/member/77/contact',
          },
          organisation: null,
        },
      ],
      promoters: [
        { organisationName: 'Synthetic Promoter', organisationUrl: 'https://example.org/promoter' },
      ],
      petitionInformation: null,
    };
    const requests = installBills(() => record);
    const result = await runToolContract(ukparlGetBill, {
      billId: '0011',
      billStageId: '',
      itemId: '',
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      billId: '11',
      section: 'overview',
      detailLevel: 'complete',
      record: {
        longTitle: record.longTitle,
        summary: record.summary,
        isAct: null,
        petitionInformation: null,
      },
      legislationHandoff: {
        status: 'unavailable',
        links: [],
        reason: 'Parliament supplied no authoritative statute link.',
      },
    });
    expectScalars(text(result), record.summary);
    expect(text(result)).toContain('https://example.org/promoter');
    expect(text(result)).toContain('Parliament supplied no authoritative statute link.');
    expect(requests.map((url) => url.pathname)).toEqual(['/api/v1/Bills/11']);
  });

  it.each([false, true, undefined])('never infers a statute link from isAct=%s', async (isAct) => {
    installBills(() => ({
      billId: 11,
      shortTitle: 'Synthetic Act 2026 Chapter 1',
      ...(isAct !== undefined ? { isAct } : {}),
    }));
    const result = await runToolContract(ukparlGetBill, { billId: '11' });
    expect(result.structuredContent).toMatchObject({
      legislationHandoff: { status: isAct === false ? 'not_enacted' : 'unavailable', links: [] },
    });
    expect(text(result)).toContain(isAct === false ? 'not_enacted' : 'unavailable');
    expect(text(result)).not.toContain('https://www.legislation.gov.uk/ukpga/2026/1');
  });

  it('returns all selected stage sittings, committee and next/previous occurrence IDs', async () => {
    installBills((url) =>
      url.pathname === '/api/v1/Bills/11'
        ? bill()
        : {
            ...stage(),
            committee: {
              id: 88,
              name: 'Synthetic Scrutiny Committee',
              house: 'Lords',
              url: 'https://committees.parliament.uk/committee/88',
            },
            nextStageBillStageId: 102,
            previousStageBillStageId: 100,
            hasMotions: true,
          },
    );
    const result = await runToolContract(ukparlGetBill, {
      billId: '11',
      section: 'stage',
      billStageId: '101',
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      record: {
        house: 'unassigned',
        stageSittings: [{ id: '201' }, { id: '202' }],
        committee: { id: '88', house: 'lords' },
        nextStageBillStageId: '102',
        previousStageBillStageId: '100',
      },
    });
    for (const term of [
      'stageSittings/1/id',
      '202',
      'hasMotions',
      '102',
      '100',
      'https://committees.parliament.uk/committee/88',
    ])
      expect(text(result)).toContain(term);
  });

  it('returns full amendment text, sponsor links and true amendmentId on both surfaces', async () => {
    const record = amendmentDetail();
    installBills((url) => (url.pathname === '/api/v1/Bills/11' ? bill() : record));
    const result = await runToolContract(ukparlGetBill, {
      billId: '11',
      section: 'amendment',
      billStageId: '101',
      itemId: '901',
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      detailLevel: 'complete',
      record: {
        id: '0',
        amendmentId: '901',
        amendmentLines: record.amendmentLines,
        explanatoryText: record.explanatoryText,
      },
    });
    expectScalars(text(result), {
      ...record,
      sponsors: [{ ...record.sponsors[0], house: 'commons' }],
    });
    expect(text(result)).toContain(
      '[Open source link](<https://members.parliament.uk/member/77/contact>)',
    );
  });

  it.each(['Motion', 'Amendment'] as const)(
    'renders all %s nested relationships and complete text',
    async (type) => {
      installBills((url) => (url.pathname === '/api/v1/Bills/11' ? bill() : motion(type)));
      const result = await runToolContract(ukparlGetBill, {
        billId: '11',
        section: 'motion',
        billStageId: '101',
        itemId: '601',
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        record: {
          id: '601',
          itemKind: type,
          relatedAmendments: expect.arrayContaining([
            expect.objectContaining({
              number: '5',
              groupKind: 'amendmentGroups',
              groupIndex: 0,
              amendmentIndex: 1,
              text: [{ text: 'Related 5 full text', indentation: 2 }],
            }),
          ]),
        },
      });
      const output = ukparlGetBill.output.parse(result.structuredContent);
      expectScalars(text(result), output.record);
      expect(text(result)).toContain(
        '[Open source link](<https://members.parliament.uk/member/77/contact>)',
      );
    },
  );

  it('returns complete publication files/links and an authoritative handoff solely from actual source URLs', async () => {
    const published = publication();
    const requests = installBills((url) =>
      url.pathname.endsWith('/Publications')
        ? { billId: 11, publications: [published] }
        : { ...bill(), isAct: true },
    );
    const result = await runToolContract(ukparlGetBill, { billId: '11', section: 'publications' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      items: [{ house: 'unassigned', files: [{ id: '501' }, { id: '502', downloadUrl: null }] }],
      legislationHandoff: {
        status: 'authoritative_link',
        links: [
          {
            url: 'https://www.legislation.gov.uk/ukpga/2026/1/contents',
            documentId: '402',
            format: 'text/html',
          },
        ],
      },
    });
    expectScalars(text(result), { ...published, house: 'unassigned' });
    expect(text(result)).toContain(
      '[Open source link](<https://www.legislation.gov.uk/ukpga/2026/1/contents>)',
    );
    expect(requests.every((url) => url.origin === 'https://bills-api.parliament.uk')).toBe(true);
  });

  it.each([
    'http://legislation.gov.uk/ukpga/2026/1',
    'https://legislation.gov.uk.evil.example/ukpga/2026/1',
    'https://notlegislation.gov.uk/ukpga/2026/1',
    'not a URL',
  ])('does not elevate non-authoritative supplied URL %s', async (url) => {
    installBills((request) =>
      request.pathname.endsWith('/Publications')
        ? { billId: 11, publications: [{ id: 301, links: [{ id: 401, url }] }] }
        : { ...bill(), isAct: true },
    );
    const result = await runToolContract(ukparlGetBill, { billId: '11', section: 'publications' });
    expect(result.structuredContent).toMatchObject({
      legislationHandoff: { status: 'unavailable', links: [] },
    });
    expect(text(result)).toContain('unavailable');
  });
});

describe('ukparl_get_bill boundaries and recovery', () => {
  it.each(
    (['stages', 'amendments', 'motions'] as const).flatMap((section) => [
      { section, items: [] },
      { section, items: null },
    ]),
  )(
    'rejects non-advancing empty $section pages ($items) before the advertised total',
    async ({ section, items }) => {
      const requests = installBills((url) =>
        url.pathname === '/api/v1/Bills/11' ? bill() : page(items, 1),
      );
      const result = await runToolContract(ukparlGetBill, {
        billId: '11',
        section,
        ...(section === 'stages' ? {} : { billStageId: '101' }),
      });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.ValidationError },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/page|pagination|total|remaining/i);
      expect(text(result)).not.toContain('source returned no items');
      expect(requests).toHaveLength(2);
    },
  );

  it.each(
    (['stages', 'amendments', 'motions'] as const).flatMap((section) => [
      { section, items: [] },
      { section, items: null },
    ]),
  )('accepts empty $section pages ($items) at the advertised total', async ({ section, items }) => {
    installBills((url) => (url.pathname === '/api/v1/Bills/11' ? bill() : page(items, 1)));
    const filters = {
      billId: '11',
      section,
      ...(section === 'stages' ? {} : { billStageId: '101' }),
    };
    const cursor = encodeCursor({
      v: 1,
      source: 'bills',
      selector: section,
      filters: digest(filters),
      offset: 1,
      nativePageSize: 20,
    });
    const result = await runToolContract(ukparlGetBill, { ...filters, cursor });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      found: true,
      items: [],
      page: { returned: 0, total: 1, hasMore: false },
    });
    expect(ukparlGetBill.output.parse(result.structuredContent).page).not.toHaveProperty(
      'nextCursor',
    );
    expect(text(result)).toContain('/page/hasMore\n```json\nfalse');
  });

  it('renders real queue saturation with selected-tool recovery on both surfaces', async () => {
    await withFullBillsQueue(async () => {
      const result = await runToolContract(ukparlGetBill, { billId: '11' });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: { data: { reason: 'queue_full' } } });
      expect(text(result)).toContain(
        'Wait briefly, then repeat ukparl_get_bill with the same selection.',
      );
    });
  });

  it.each(['stages', 'amendments', 'motions'] as const)(
    'follows every native %s page and retains the final record on both surfaces',
    async (section) => {
      const rows =
        section === 'stages'
          ? [stage(101), stage(102), stage(103)]
          : section === 'amendments'
            ? [amendment(901), amendment(902), amendment(903)]
            : [
                { type: 'Motion', motion: { id: 601, summary: 'First motion' } },
                {
                  type: 'Amendment',
                  amendment: { id: 602, summary: 'Second ping-pong amendment' },
                },
                { type: 'Motion', motion: { id: 603, summary: 'Final motion' } },
              ];
      const requests = installBills((url) =>
        url.pathname === '/api/v1/Bills/11'
          ? bill()
          : page(
              rows.slice(
                Number(url.searchParams.get('Skip')),
                Number(url.searchParams.get('Skip')) + 2,
              ),
              3,
            ),
      );
      const selection = {
        billId: '11',
        section,
        limit: 2,
        ...(section !== 'stages' ? { billStageId: '101' } : {}),
      };
      const first = await runToolContract(ukparlGetBill, selection);
      expect(first.isError).not.toBe(true);
      const firstOutput = ukparlGetBill.output.parse(first.structuredContent);
      expect(firstOutput.items).toHaveLength(2);
      expect(firstOutput.page).toMatchObject({ returned: 2, total: 3, hasMore: true });
      const last = await runToolContract(ukparlGetBill, {
        ...selection,
        cursor: firstOutput.page!.nextCursor!,
      });
      expect(last.isError).not.toBe(true);
      const lastOutput = ukparlGetBill.output.parse(last.structuredContent);
      expect(lastOutput.page).toEqual({ returned: 1, total: 3, hasMore: false });
      expect(lastOutput.items).toHaveLength(1);
      expect(lastOutput.items![0]).toMatchObject(
        section === 'stages'
          ? { id: '103', stageSittings: [{ id: '201' }, { id: '202' }] }
          : section === 'amendments'
            ? { id: '0', amendmentId: '903' }
            : { id: '603', itemKind: 'Motion', summary: 'Final motion' },
      );
      expect(text(last)).toContain(
        section === 'stages' ? '103' : section === 'amendments' ? '903' : 'Final motion',
      );
      expect(requests[3]?.searchParams.get('Skip')).toBe('2');
    },
  );
  it.each([
    { section: 'overview', billStageId: '101' },
    { section: 'overview', itemId: '901' },
    { section: 'overview', limit: 1 },
    { section: 'overview', cursor: 'a' },
    { section: 'stage' },
    { section: 'stage', billStageId: '101', itemId: '901' },
    { section: 'amendments' },
    { section: 'amendments', billStageId: '101', itemId: '901' },
    { section: 'amendment', billStageId: '101' },
    { section: 'motions' },
    { section: 'motion', billStageId: '101' },
    { section: 'motion', billStageId: '101', itemId: '601', limit: 1 },
    { section: 'publications', billStageId: '101' },
  ] as const)('rejects invalid selector fields before network: %j', async (fields) => {
    const requests = installBills(() => bill());
    const result = await runToolContract(ukparlGetBill, { billId: '11', ...fields });
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'invalid_mode_arguments' } },
    });
    expect(text(result)).toContain('topic=identifiers');
    expect(requests).toHaveLength(0);
  });

  it.each([
    'overview',
    'stage',
    'amendment',
    'motion',
    'amendments',
    'motions',
    'publications',
  ] as const)('returns explicit missing %s with usable same-server guidance', async (section) => {
    installBills((url) =>
      section === 'overview' || url.pathname !== '/api/v1/Bills/11'
        ? new Response(null, { status: 404 })
        : bill(),
    );
    const result = await runToolContract(ukparlGetBill, {
      billId: '11',
      section,
      ...(['stage', 'amendment', 'motion', 'amendments', 'motions'].includes(section)
        ? { billStageId: '101' }
        : {}),
      ...(['amendment', 'motion'].includes(section) ? { itemId: '901' } : {}),
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      found: false,
      billId: '11',
      section,
      guidance: expect.stringContaining(
        section === 'overview' ? 'ukparl_search_bills' : 'ukparl_get_bill',
      ),
    });
    const output = ukparlGetBill.output.parse(result.structuredContent);
    expect(output).not.toHaveProperty('record');
    expect(output).not.toHaveProperty('items');
    expect(text(result)).toContain(output.guidance!);
  });

  it.each(['stages', 'amendments', 'motions', 'publications'] as const)(
    'preserves null empty %s as successful selected collection',
    async (section) => {
      installBills((url) =>
        url.pathname === '/api/v1/Bills/11'
          ? bill()
          : section === 'publications'
            ? { billId: 11, publications: null }
            : page(null),
      );
      const result = await runToolContract(ukparlGetBill, {
        billId: '11',
        section,
        ...(['amendments', 'motions'].includes(section) ? { billStageId: '101' } : {}),
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        found: true,
        items: [],
        page: { returned: 0, total: 0, hasMore: false },
        notice: expect.stringContaining(
          `source returned no items for ukparl_get_bill section=${section}`,
        ),
      });
      expect(text(result)).toContain(LICENCE_NOTICE);
      expect(text(result)).toContain(`section=${section}`);
    },
  );

  it.each([1000, 1001, Number.MAX_SAFE_INTEGER])(
    'clamps nested read limit %s before workload and preserves licence plus actual count',
    async (limit) => {
      const requests = installBills((url) =>
        url.pathname === '/api/v1/Bills/11' ? bill() : page([stage()], 100),
      );
      const result = await runToolContract(ukparlGetBill, {
        billId: '11',
        section: 'stages',
        limit,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        applied: { limit: 50 },
        requestedLimit: limit,
        shown: 1,
        truncated: true,
        cap: 50,
        notice: expect.stringContaining(LICENCE_NOTICE),
      });
      expect(text(result)).toContain(`Requested limit ${limit} is capped at 50.`);
      expect(requests[1]?.searchParams.get('Take')).toBe('50');
    },
  );

  it('rejects filter-bound collection cursors before network', async () => {
    const requests = installBills((url) =>
      url.pathname === '/api/v1/Bills/11' ? bill() : page([stage()], 3),
    );
    const first = await runToolContract(ukparlGetBill, {
      billId: '11',
      section: 'stages',
      limit: 1,
    });
    const cursor = ukparlGetBill.output.parse(first.structuredContent).page!.nextCursor!;
    const before = requests.length;
    const result = await runToolContract(ukparlGetBill, {
      billId: '12',
      section: 'stages',
      limit: 1,
      cursor,
    });
    expect(result.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(result)).toContain('same filters and no cursor or contentCursor');
    expect(requests).toHaveLength(before);
  });

  it('keeps schema-invalid 200 responses as errors rather than missing bills', async () => {
    installBills(() => ({ shortTitle: 'Missing required billId' }));
    const result = await runToolContract(ukparlGetBill, { billId: '11' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.ValidationError },
    });
    expect(text(result)).not.toContain('find a billId');
  });
});

describe('ukparl_get_bill oversized source content', () => {
  it('pages large whole stages by actual emitted rows and measures the complete composed response', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      ...stage(index + 101),
      description: `Stage ${index}: ${'文'.repeat(1400)}`,
    }));
    const requests = installBills((url) =>
      url.pathname === '/api/v1/Bills/11'
        ? bill()
        : page(
            rows.slice(
              Number(url.searchParams.get('Skip')),
              Number(url.searchParams.get('Skip')) + Number(url.searchParams.get('Take')),
            ),
            5,
          ),
    );
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await runToolContract(ukparlGetBill, {
        billId: '11',
        section: 'stages',
        limit: 5,
        ...(cursor ? { cursor } : {}),
      });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
      const output = ukparlGetBill.output.parse(result.structuredContent);
      expect(requests.at(-1)?.searchParams.get('Skip')).toBe(String(ids.length));
      expect(output.delivery).toBe('full');
      expect(output.items!.length).toBeGreaterThan(0);
      expect(output.items!.length).toBeLessThan(5);
      for (const item of output.items!) {
        expect(item).toMatchObject({ stageSittings: [{ id: '201' }, { id: '202' }] });
        expect(text(result)).toContain(JSON.stringify(Reflect.get(item, 'description')));
        ids.push(String(Reflect.get(item, 'id')));
      }
      expect(result.structuredContent).toMatchObject({
        ...(output.page!.hasMore ? { truncated: true, shown: output.items!.length, cap: 5 } : {}),
        notice: expect.stringContaining(LICENCE_NOTICE),
      });
      cursor = output.page!.nextCursor;
    } while (cursor);
    expect(ids).toEqual(['101', '102', '103', '104', '105']);
  });

  it('outlines only the oversized first stage, reconstructs it whole and resumes the next collection item', async () => {
    const description = 'Large indivisible synthetic stage Ω 🏛️\n'.repeat(900);
    const rows = [{ ...stage(101), description }, stage(102)];
    installBills((url) =>
      url.pathname === '/api/v1/Bills/11'
        ? bill()
        : page(
            rows.slice(
              Number(url.searchParams.get('Skip')),
              Number(url.searchParams.get('Skip')) + Number(url.searchParams.get('Take')),
            ),
            2,
          ),
    );
    const selection = { billId: '11', section: 'stages' as const, limit: 2 };
    const result = await runToolContract(ukparlGetBill, selection);
    expect(result.isError).not.toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
    const output = ukparlGetBill.output.parse(result.structuredContent);
    expect(output.delivery).toBe('outline');
    expect(output.collectionPage).toMatchObject({ returned: 1, total: 2, hasMore: true });
    expect(result.structuredContent).toMatchObject({
      shown: 1,
      truncated: true,
      cap: 2,
      notice: expect.stringContaining(LICENCE_NOTICE),
    });
    const reconstructed = await reconstruct(selection, output);
    expect(reconstructed).toMatchObject({
      items: [{ id: '101', description, stageSittings: [{ id: '201' }, { id: '202' }] }],
      page: { returned: 1, total: 2, hasMore: true },
    });
    expect(reconstructed).toHaveProperty('items.length', 1);
    const last = await runToolContract(ukparlGetBill, {
      ...selection,
      cursor: output.collectionPage!.nextCursor!,
    });
    expect(last.isError).not.toBe(true);
    expect(last.structuredContent).toMatchObject({
      delivery: 'full',
      items: [{ id: '102' }],
      page: { returned: 1, total: 2, hasMore: false },
    });
  });

  it('reconstructs a complete large overview with multi-page scalar text and more than twenty sponsor entries', async () => {
    const summary = '<p>"escaped"\n\\ Ω 🏛️</p>'.repeat(2200);
    const sponsors = Array.from({ length: 25 }, (_, index) => ({
      member: {
        memberId: index + 1,
        name: `Synthetic ${index}`,
        memberPage: `https://members.parliament.uk/member/${index + 1}/contact`,
      },
    }));
    installBills(() => ({ billId: 11, summary, sponsors }));
    const selection = { billId: '11', section: 'overview' as const };
    const first = await runToolContract(ukparlGetBill, selection);
    expect(first.isError).not.toBe(true);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(24000);
    const output = ukparlGetBill.output.parse(first.structuredContent);
    expect(output.delivery).toBe('outline');
    expect(output).not.toHaveProperty('record');
    expect(text(first)).toContain('Reconstruct this payload');
    const reconstructed = await reconstruct(selection, output);
    expect(reconstructed).toMatchObject({
      found: true,
      record: {
        billId: '11',
        summary,
        sponsors: sponsors.map((sponsor, index) => ({
          member: { ...sponsor.member, memberId: String(index + 1) },
        })),
      },
    });
  });

  it('reports source-change and content-selection recovery on both surfaces', async () => {
    let summary = 'First synthetic revision'.repeat(1500);
    installBills(() => ({ billId: 11, summary }));
    const selection = { billId: '11', section: 'overview' as const };
    const first = await runToolContract(ukparlGetBill, selection);
    const cursor = ukparlGetBill.output.parse(first.structuredContent).contentPage!.entries![0]!
      .contentCursor;
    const rebound = await runToolContract(ukparlGetBill, {
      ...selection,
      billId: '12',
      contentCursor: cursor,
    });
    expect(rebound.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_cursor' } },
    });
    expect(text(rebound)).toContain('same filters and no cursor or contentCursor');
    summary = 'Changed synthetic revision'.repeat(1500);
    const changed = await runToolContract(ukparlGetBill, { ...selection, contentCursor: cursor });
    expect(changed.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.Conflict, data: { reason: 'source_changed' } },
    });
    expect(text(changed)).toContain('original filters and no contentCursor');
  });
});
