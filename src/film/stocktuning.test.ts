// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STOCK, STOCKS, type StockId } from './stocks';
import { fileValues, isTuned, resetStock, stockCode, tuneStock } from './stocktuning';

const source = readFileSync(new URL('./stocks.ts', import.meta.url), 'utf8');

describe('stock tuning', () => {
  it("writes each stock's entry exactly as stocks.ts has it, so pasting it back changes nothing", () => {
    for (const s of STOCKS.filter((s) => s.id !== 'neutral')) expect(source).toContain(stockCode(s.id));
  });

  it('changes a stock live, writes the change, and goes back to the file', () => {
    const id: StockId = 'gold200';
    const before = JSON.stringify(STOCK[id]);
    const contrast = fileValues(id).contrast;
    tuneStock(id, { contrast: 1.2, primaries: { inset: [0.1, 0.1, 0.15], rotation: [2, -1, -3], purity: 0.25 } });
    expect(STOCK[id].contrast).toBe(1.2);
    expect(isTuned(id)).toBe(true);
    expect(fileValues(id).contrast).toBe(contrast);
    expect(stockCode(id)).toContain('    contrast: 1.2, halation: 0,');
    expect(stockCode(id)).toContain('    primaries: { inset: [0.1, 0.1, 0.15], rotation: [2, -1, -3], purity: 0.25 },');
    resetStock(id);
    expect(isTuned(id)).toBe(false);
    expect(JSON.stringify(STOCK[id])).toBe(before);
  });

  it('leaves out primaries that do nothing and rounds to three decimals', () => {
    tuneStock('hp5', { contrast: 1.01234, primaries: { inset: [0, 0, 0], rotation: [0, 0, 0], purity: 0.5 } });
    expect(stockCode('hp5')).toContain('contrast: 1.012,');
    expect(stockCode('hp5')).not.toContain('primaries');
    resetStock('hp5');
    expect(STOCK.hp5.primaries).toBeUndefined();
  });

  it("writes a stock's grade as code, settings at darktable's defaults left out, and resets it", () => {
    const grade = STOCK.gold200.grade;
    tuneStock('gold200', { grade: { shadows_C: 0.12, shadows_H: 220, shadows_weight: 1, highlights_Y: 0 } });
    expect(stockCode('gold200')).toContain('    grade: { shadows_C: 0.12, shadows_H: 220 },');
    resetStock('gold200');
    expect(STOCK.gold200.grade).toEqual(grade);
    expect(source).toContain(stockCode('gold200'));
  });
});
