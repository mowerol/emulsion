// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DragDropEvent } from '@tauri-apps/api/webview';
import { PhysicalPosition } from '@tauri-apps/api/dpi';

const native = vi.hoisted(() => ({ drop: (_event: DragDropEvent) => {}, unlisten: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({
  onDragDropEvent: async (handler: (event: { payload: DragDropEvent }) => void) => {
    native.drop = payload => handler({ payload }); return native.unlisten;
  },
}) }));
vi.mock('../backend/api', () => ({ isTauri: () => true }));
vi.mock('../backend/ipc', () => ({ invoke: vi.fn() }));
import { invoke } from '../backend/ipc';
import { LookReferencePicker, type LookReference } from './LookReference';

let host: HTMLDivElement, root: Root;
let current: LookReference | null;
let blobs: Blob[];
function Picker() {
  const [reference, setReference] = useState<LookReference | null>(null);
  current = reference;
  return createElement(LookReferencePicker, { reference, onChange: setReference });
}
const drop = async (...paths: string[]) => act(async () => native.drop({ type: 'drop', paths, position: new PhysicalPosition(300, 200) }));
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('Image', class { src = ''; decode = async () => {}; });
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { if (!(blob instanceof Blob)) throw Error('Expected a photo blob'); blobs.push(blob); return `blob:reference-${blobs.length}`; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.mocked(invoke).mockResolvedValue(new Uint8Array([255, 216, 1, 2, 3]).buffer);
  native.unlisten.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(Picker)));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});
it('reads Finder drops as original encoded bytes and releases replaced and removed references', async () => {
  await drop('/Photos/Fuji.JPG');
  expect(invoke).toHaveBeenCalledWith('read_reference_photo', { path: '/Photos/Fuji.JPG' });
  expect([...new Uint8Array(await blobs[0].arrayBuffer())]).toEqual([255, 216, 1, 2, 3]);
  expect(current).toEqual({ name: 'Fuji.JPG', url: 'blob:reference-1' });
  await drop('/Photos/Second.JPG');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reference-1');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove reference photo"]')!.click());
  expect(current).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reference-2');
});
it('keeps the existing reference when a native file cannot be read and rejects multiple files or folders', async () => {
  await drop('/Photos/Fuji.JPG');
  vi.mocked(invoke).mockRejectedValueOnce(new Error('File missing'));
  await drop('/Photos/Missing.JPG');
  expect(current?.name).toBe('Fuji.JPG');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t open');
  vi.mocked(invoke).mockClear();
  await drop('/Photos'); await drop('/One.JPG', '/Two.JPG');
  expect(invoke).not.toHaveBeenCalled();
  expect(current?.name).toBe('Fuji.JPG');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Drop one');
});
it('ignores an older native read when another photo is dropped and frees the active URL on unmount', async () => {
  let finish!: (bytes: ArrayBuffer) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await drop('/Slow.JPG'); await drop('/Latest.JPG');
  await act(async () => finish(new ArrayBuffer(4)));
  expect(current?.name).toBe('Latest.JPG');
  expect(blobs).toHaveLength(1);
  await act(async () => root.unmount());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reference-1');
  expect(native.unlisten).toHaveBeenCalledOnce();
});

it('offers the camera JPEG only for a paired photo with the frame uncropped', async () => {
  const { cameraJpegBlocked, cameraJpegPath } = await import('./LookReference');
  const raw = { path: '/Photos/DSCF0287.RAF', raw: true, pair: null };
  const photos = [raw, { path: '/Photos/DSCF0287.jpg' }, { path: '/Other/DSCF0598.JPG' }];
  // Folded twin, or found by name when RAW+JPEG grouping is off; never for a JPEG itself.
  expect(cameraJpegPath({ ...raw, pair: '/Photos/DSCF0287.JPG' }, [])).toBe('/Photos/DSCF0287.JPG');
  expect(cameraJpegPath(raw, photos)).toBe('/Photos/DSCF0287.jpg');
  expect(cameraJpegPath({ path: '/Photos/DSCF0598.RAF', raw: true, pair: null }, photos)).toBeNull();
  expect(cameraJpegPath({ path: '/Photos/DSCF0287.jpg', raw: false, pair: null }, photos)).toBeNull();
  expect(cameraJpegPath(raw, [{ path: '/Photos/DSCF0287.jpg', copyId: 'c1' }])).toBeNull();
  expect(cameraJpegBlocked('/Photos/DSCF0287.JPG', null)).toBeNull();
  expect(cameraJpegBlocked('/Photos/DSCF0287.JPG', { crop: null, transform: null })).toBeNull();
  expect(cameraJpegBlocked(null, null)).toMatch(/No camera JPEG/);
  expect(cameraJpegBlocked('/Photos/DSCF0287.JPG', { crop: { angle: 0 }, transform: null })).toMatch(/cropped/);
});

it('reads each photo’s camera JPEG as it changes and releases the one it replaces', async () => {
  const { useCameraJpeg } = await import('./LookReference');
  let seen: ReturnType<typeof useCameraJpeg> = { state: 'off' };
  function Probe({ path }: { path: string | null }) { seen = useCameraJpeg(path); return null; }
  await act(async () => root.render(createElement(Probe, { path: '/Photos/DSCF0287.JPG' })));
  expect(invoke).toHaveBeenCalledWith('read_reference_photo', { path: '/Photos/DSCF0287.JPG' });
  expect(seen).toEqual({ state: 'ready', reference: { url: 'blob:reference-1', name: 'DSCF0287.JPG' } });
  await act(async () => root.render(createElement(Probe, { path: '/Photos/DSCF0598.JPG' })));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reference-1');
  expect(seen).toEqual({ state: 'ready', reference: { url: 'blob:reference-2', name: 'DSCF0598.JPG' } });
  vi.mocked(invoke).mockRejectedValueOnce(new Error('File missing'));
  await act(async () => root.render(createElement(Probe, { path: '/Photos/Missing.JPG' })));
  expect(seen).toEqual({ state: 'error' });
  await act(async () => root.render(createElement(Probe, { path: null })));
  expect(seen).toEqual({ state: 'off' });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reference-2');
});
