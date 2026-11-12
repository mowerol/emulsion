// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

vi.mock('../backend/api', () => ({
  writeSidecar: vi.fn(() => Promise.resolve()),
  metadataFromFiles: vi.fn(),
  scanFolder: vi.fn(),
  whitePoints: vi.fn(() => Promise.resolve([])),
  thumbnail: vi.fn(),
  isTauri: () => true,
  logToTerminal: () => {},
}));

const { marksFromFile, readMetadataFromFiles, undo, useApp } = await import('./store');
const { metadataFromFiles, writeSidecar } = await import('../backend/api');

const photo = (path: string, more: object = {}) => ({ path, rel: path, name: path, size: 1, modified: 0, recipe: null, seed: 1, white: null, rating: 0, label: null, flag: null, raw: false, pair: null, ...more });
const file = (rating: number, label: string | null, keywords: string[] = [], reject = false) => ({ rating, label, reject, meta: { keywords } });

describe('Read Metadata from Files', () => {
  it('takes stars and label from the file; a reject keeps the stars and a pick stays', () => {
    expect(marksFromFile({ rating: 1, label: null, flag: 'pick' }, file(4, 'red'))).toEqual({ rating: 4, label: 'red', flag: 'pick' });
    expect(marksFromFile({ rating: 3, label: 'green', flag: 'pick' }, file(0, 'blue', [], true))).toEqual({ rating: 3, label: 'blue', flag: 'reject' });
    expect(marksFromFile({ rating: 3, label: null, flag: 'reject' }, file(2, null))).toEqual({ rating: 2, label: null, flag: null });
  });

  it('replaces the selected photos\' marks and metadata with their files\', as one undoable step', async () => {
    vi.useFakeTimers();
    useApp.setState({
      photos: [photo('a', { rating: 1 }), photo('a', { copyId: 'c1', rating: 2 }), photo('b', { rating: 3, flag: 'reject' }), photo('c', { rating: 5 })],
      active: 0, selected: new Set(['a', 'b', 'c']),
    });
    vi.mocked(metadataFromFiles).mockResolvedValue([file(4, 'red', ['Places|Japan']), file(0, null), null]);
    await readMetadataFromFiles();
    expect(metadataFromFiles).toHaveBeenCalledWith(['a', 'b', 'c']);
    const [a, copy, b, c] = useApp.getState().photos;
    expect([a.rating, a.label, a.meta?.keywords]).toEqual([4, 'red', ['Places|Japan']]);
    // A virtual copy keeps its own marks and shares its source's metadata.
    expect([copy.rating, copy.meta?.keywords]).toEqual([2, ['Places|Japan']]);
    expect([b.rating, b.flag]).toEqual([0, null]);
    // No metadata in c's files: left as it is.
    expect(c.rating).toBe(5);
    expect(useApp.getState().history.undo).toBe('Read metadata from files on 2 photos');
    await vi.runAllTimersAsync();
    expect(writeSidecar).toHaveBeenCalledWith('a', expect.objectContaining({ rating: 4, label: 'red' }), false);
    undo();
    expect(useApp.getState().photos.map(p => p.rating)).toEqual([1, 2, 3, 5]);
    expect(useApp.getState().photos[0].meta?.keywords ?? []).toEqual([]);
    vi.useRealTimers();
  });
});
