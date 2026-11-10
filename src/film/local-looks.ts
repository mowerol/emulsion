// SPDX-License-Identifier: GPL-3.0-or-later
// Optional local Fuji test catalogue. LUT files stay outside public/ and git;
// Vite serves them during development, and production builds register no local looks.

export interface LocalLook {
  id: `lut:${string}`;
  pack: 'fuji-test' | 'fuji-xtrans-iii' | 'spektrafilm';
  name: string;
  category: string;
  file: string;
  iso: number;
  sha256: string;
}

export const LOCAL_LOOKS: LocalLook[] = import.meta.env.DEV
  ? Object.values(import.meta.glob('/local-looks/*/catalogue.json', { eager: true, import: 'default' })).flat() as LocalLook[]
  : [];
