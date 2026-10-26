/**
 * @fileoverview Filter binding and native-page continuation tests.
 * @module tests/services/parliament-http/parliament-cursors.test
 */
import { describe, expect, it } from 'vitest';
import {
  advanceCollectionCursor,
  CollectionCursorSchema,
  decodeCursor,
  encodeCursor,
  readCollectionCursor,
} from '@/services/parliament-http/parliament-cursors.js';
import {
  DateSchema,
  HouseSchema,
  IdSchema,
  numericHouse,
  optionalText,
  validateDateRange,
} from '@/services/parliament-http/parliament-models.js';

const binding = {
  source: 'members',
  selector: 'voting',
  filters: { memberId: '42', house: 'commons' },
  nativePageSize: 20,
};

describe('collection cursors', () => {
  it('keeps native-page remainders and advances only after the last row', () => {
    const initial = {
      ...readCollectionCursor(undefined, binding),
      nativePage: 1,
      intraPageOffset: 0,
    };
    const remainder = readCollectionCursor(advanceCollectionCursor(initial, 3), binding);
    expect(remainder).toMatchObject({ offset: 3, nativePage: 1, intraPageOffset: 3 });
    expect(readCollectionCursor(advanceCollectionCursor(remainder, 17), binding)).toMatchObject({
      offset: 20,
      nativePage: 2,
      intraPageOffset: 0,
    });
  });

  it('binds source, selector, filters and native size', () => {
    const token = encodeCursor(readCollectionCursor(undefined, binding));
    for (const changed of [
      { source: 'bills' },
      { selector: 'profile' },
      { filters: { memberId: '43', house: 'commons' } },
      { nativePageSize: 10 },
    ]) {
      expect(() => readCollectionCursor(token, { ...binding, ...changed })).toThrow(
        expect.objectContaining({ data: expect.objectContaining({ reason: 'invalid_cursor' }) }),
      );
    }
  });

  it('rejects malformed, unknown-key, unsupported and inconsistent cursors', () => {
    const valid = readCollectionCursor(undefined, binding);
    for (const value of [
      '!',
      'e30',
      Buffer.from(JSON.stringify({ ...valid, v: 2 })).toString('base64url'),
      Buffer.from(JSON.stringify({ ...valid, origin: 'https://evil.test' })).toString('base64url'),
      encodeCursor({ ...valid, nativePage: 2, offset: 0 }),
      encodeCursor({ ...valid, offset: -1 }),
      encodeCursor({ ...valid, offset: 2147483648 }),
    ]) {
      expect(() => readCollectionCursor(value, binding)).toThrow(
        expect.objectContaining({ data: expect.objectContaining({ reason: 'invalid_cursor' }) }),
      );
    }
    expect(decodeCursor(encodeCursor(valid), CollectionCursorSchema)).toEqual(valid);
    expect(
      readCollectionCursor(encodeCursor({ ...valid, offset: 2147483647 }), binding).offset,
    ).toBe(2147483647);
  });
});

describe('shared edge schemas', () => {
  it('normalizes only decimal int32 IDs and official House aliases', () => {
    expect(IdSchema.parse('00042')).toBe('42');
    for (const id of ['0', '-1', '2147483648', '1.0', 'https://example.test/42', 'bill-42'])
      expect(IdSchema.safeParse(id).success).toBe(false);
    expect(numericHouse(HouseSchema.parse(' House of Commons '))).toBe(1);
    expect(numericHouse(HouseSchema.parse('LORDS'))).toBe(2);
    expect(HouseSchema.safeParse('joint').success).toBe(false);
    expect(optionalText(IdSchema).parse('   ')).toBeUndefined();
  });

  it('rejects impossible/reversed dates while retaining leap days', () => {
    expect(DateSchema.parse('2024-02-29')).toBe('2024-02-29');
    for (const date of ['2023-02-29', '2024-04-31', '2024-1-01'])
      expect(DateSchema.safeParse(date).success).toBe(false);
    expect(() => validateDateRange('2024-02-02', '2024-02-01')).toThrow(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'invalid_date_range' }) }),
    );
  });
});
