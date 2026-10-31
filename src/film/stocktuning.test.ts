// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STOCK, STOCKS, type StockId } from './stocks';
import { balancedRow, fileValues, isTuned, resetStock, stockCode, tuneStock } from './stocktuning';

const source = readFileSync(new URL('./stocks.ts', import.meta.url), 'utf8');

describe('stock tuning', () => {
  it("writes each stock's entry exactly as stocks.ts has it, so pasting it back changes nothing", () => {
    for (const s of STOCKS.filter((s) => s.id !== 'neutral')) expect(source).toContain(stockCode(s.id));
  });

  it('changes a stock live, writes the change, and goes back to the file', () => {
    const id: StockId = 'gold200';
    const before = JSON.stringify(STOCK[id]);
    tuneStock(id, { contrast: 1.2, balance: [1.1, 1, 0.9] });
    expect(STOCK[id].contrast).toBe(1.2);
    expect(isTuned(id)).toBe(true);
    expect(fileValues(id).contrast).toBe(1.05);
    expect(stockCode(id)).toContain('contrast: 1.2, crossover: [0.02, 0, -0.07], balance: [1.1, 1, 0.9]');
    resetStock(id);
    expect(isTuned(id)).toBe(false);
    expect(JSON.stringify(STOCK[id])).toBe(before);
  });

  it('keeps crosstalk rows summing to 1, so greys stay grey', () => {
    const row = balancedRow([0.5, 0.1, -0.05], 0);
    expect(row[0]).toBeCloseTo(0.95, 12);
    expect(row.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 12);
  });

  it('writes an identity crosstalk as I and rounds to three decimals', () => {
    tuneStock('cinestill800t', { fade: 0.01234 });
    expect(stockCode('cinestill800t')).toContain('matrix: I,');
    expect(stockCode('cinestill800t')).toContain('fade: 0.012,');
    resetStock('cinestill800t');
  });

  it("writes a stock's grade as code, settings at darktable's defaults left out, and resets it", () => {
    tuneStock('gold200', { grade: { shadows_C: 0.12, shadows_H: 220, shadows_weight: 1, highlights_Y: 0 } });
    expect(stockCode('gold200')).toContain('    grade: { shadows_C: 0.12, shadows_H: 220 },');
    resetStock('gold200');
    expect(STOCK.gold200.grade).toBeUndefined();
    expect(source).toContain(stockCode('gold200'));
  });
});
