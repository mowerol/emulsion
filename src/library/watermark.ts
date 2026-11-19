// SPDX-License-Identifier: GPL-3.0-or-later
// Export-only overlays. Rasterize just the mark, then blend into the developed pixels so
// a 16-bit photo never passes through an 8-bit canvas.
export const WATERMARK_POSITIONS = [
  ['top-left', 'Top left'], ['top-center', 'Top center'], ['top-right', 'Top right'],
  ['center-left', 'Center left'], ['center', 'Center'], ['center-right', 'Center right'],
  ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom center'], ['bottom-right', 'Bottom right'],
] as const;

export interface WatermarkSettings {
  enabled: boolean;
  kind: 'text' | 'image';
  text: string;
  color: 'white' | 'black';
  /** An embedded PNG, independent of the imported file and portable with export presets. */
  image: string | null;
  imageName: string;
  position: typeof WATERMARK_POSITIONS[number][0];
  /** Width and inset as percentages of the final frame's shorter edge. */
  size: number;
  inset: number;
  opacity: number;
}

export const WATERMARK_DEFAULTS: WatermarkSettings = {
  enabled: false, kind: 'text', text: '', color: 'white', image: null, imageName: '',
  position: 'bottom-right', size: 30, inset: 3, opacity: 70,
};
const MAX_IMAGE_LENGTH = 2_800_000;
const percent = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(min, Math.min(max, v))) : fallback;

export function normalizeWatermark(value: unknown): WatermarkSettings {
  const p = (value && typeof value === 'object' ? value : {}) as Partial<WatermarkSettings>;
  const d = WATERMARK_DEFAULTS;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : d.enabled,
    kind: p.kind === 'image' ? 'image' : 'text',
    text: typeof p.text === 'string' ? p.text.replace(/[\p{Cc}]/gu, ' ').slice(0, 200) : d.text,
    color: p.color === 'black' ? 'black' : 'white',
    image: typeof p.image === 'string' && p.image.length <= MAX_IMAGE_LENGTH && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(p.image) ? p.image : null,
    imageName: typeof p.imageName === 'string' ? p.imageName.slice(0, 200) : '',
    position: WATERMARK_POSITIONS.some(([v]) => v === p.position) ? p.position! : d.position,
    size: percent(p.size, d.size, 5, 100), inset: percent(p.inset, d.inset, 0, 20), opacity: percent(p.opacity, d.opacity, 1, 100),
  };
}

export function watermarkError(s: WatermarkSettings): string | null {
  if (!s.enabled) return null;
  return s.kind === 'text' ? (s.text.trim() ? null : 'Enter the watermark text, or turn watermarking off.')
    : s.image ? null : 'Choose a watermark image, or turn watermarking off.';
}

async function decodeImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  try { await image.decode(); } catch { throw new Error('Could not open the watermark image. Choose a PNG, JPEG or WebP.'); }
  return image;
}

function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not draw the watermark.');
  return { canvas, ctx };
}

/** Store a bounded PNG copy, retaining transparency and converting browser-supported profiles to sRGB. */
export async function importWatermarkImage(file: File): Promise<{ image: string; imageName: string }> {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error('Choose a PNG, JPEG or WebP watermark image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a watermark image smaller than 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await decodeImage(url);
    const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const { canvas, ctx } = canvas2d(Math.max(1, Math.round(img.naturalWidth * scale)), Math.max(1, Math.round(img.naturalHeight * scale)));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/png');
    if (image.length > MAX_IMAGE_LENGTH) throw new Error('This watermark image is too detailed to save. Choose a smaller PNG or signature image.');
    return { image, imageName: file.name.slice(0, 200) };
  } finally { URL.revokeObjectURL(url); }
}

export interface WatermarkOverlay { pixels: Uint8ClampedArray; width: number; height: number; x: number; y: number }

/** Integer bounds shared by preview and export, including tall logos and very small frames. */
export function watermarkBounds(width: number, height: number, aspect: number, s: WatermarkSettings) {
  const edge = Math.min(width, height);
  const inset = Math.round(edge * s.inset / 100);
  const availableW = Math.max(1, width - 2 * inset), availableH = Math.max(1, height - 2 * inset);
  const w = Math.max(1, Math.min(Math.round(edge * s.size / 100), availableW, Math.round(availableH * aspect)));
  const h = Math.max(1, Math.min(availableH, Math.round(w / aspect)));
  const x = s.position.endsWith('left') ? inset : s.position.endsWith('right') ? width - inset - w : Math.round((width - w) / 2);
  const y = s.position.startsWith('top') ? inset : s.position.startsWith('bottom') ? height - inset - h : Math.round((height - h) / 2);
  return { width: w, height: h, x, y };
}

/** Decode the logo/load the font once per batch. The returned function rasterizes at each frame's final size. */
export async function prepareWatermark(s: WatermarkSettings): Promise<(width: number, height: number) => WatermarkOverlay> {
  const error = watermarkError(s);
  if (error) throw new Error(error);
  const img = s.kind === 'image' ? await decodeImage(s.image!) : null;
  const font = '"Geist Variable", sans-serif';
  if (!img) await document.fonts.load(`100px ${font}`, s.text);
  const measure = canvas2d(1, 1).ctx;
  measure.font = `100px ${font}`;
  const metrics = measure.measureText(s.text.trim());
  // Include actual glyph overhangs (italic/accented/non-Latin characters) in the painted bounds.
  const left = Math.max(0, metrics.actualBoundingBoxLeft);
  const textWidth = Math.max(1, metrics.width, left + metrics.actualBoundingBoxRight);
  const ascent = Math.max(1, metrics.actualBoundingBoxAscent), descent = Math.max(0, metrics.actualBoundingBoxDescent);
  const textHeight = ascent + descent + 4;
  const aspect = img ? img.naturalWidth / img.naturalHeight : (textWidth + 4) / textHeight;
  return (width, height) => {
    const bounds = watermarkBounds(width, height, aspect, s);
    const { canvas, ctx } = canvas2d(bounds.width, bounds.height);
    ctx.globalAlpha = s.opacity / 100;
    if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    else {
      ctx.scale(canvas.width / (textWidth + 4), canvas.height / textHeight);
      ctx.font = `100px ${font}`;
      ctx.fillStyle = s.color;
      ctx.fillText(s.text.trim(), left + 2, ascent + 2);
    }
    return { ...bounds, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  };
}

/** The GPU supplies opaque RGBA8 or RGB16, already encoded in sRGB. Only covered pixels change. */
export function blendWatermark(pixels: Uint8Array | Uint16Array, width: number, height: number, mark: WatermarkOverlay) {
  const deep = pixels instanceof Uint16Array, channels = deep ? 3 : 4, scale = deep ? 257 : 1;
  for (let y = 0; y < mark.height; y++) {
    const dy = y + mark.y;
    if (dy < 0 || dy >= height) continue;
    for (let x = 0; x < mark.width; x++) {
      const dx = x + mark.x;
      if (dx < 0 || dx >= width) continue;
      const source = (y * mark.width + x) * 4, alpha = mark.pixels[source + 3] / 255;
      if (!alpha) continue;
      const target = (dy * width + dx) * channels;
      for (let c = 0; c < 3; c++) pixels[target + c] = Math.round(pixels[target + c] * (1 - alpha) + mark.pixels[source + c] * scale * alpha);
    }
  }
}
