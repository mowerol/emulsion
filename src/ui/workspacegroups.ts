// SPDX-License-Identifier: GPL-3.0-or-later
// Existing editing groups are the units users arrange across their own tabs.
import type { WorkspaceIcon } from './controlworkspace';
import { WORKSPACE_SLIDERS, workspaceControl } from './workspacecontrols';

export interface WorkspaceGroupDefinition { id: string; name: string; icon: WorkspaceIcon; controls: string[] }
export const WORKSPACE_GROUPS: WorkspaceGroupDefinition[] = [
  { id: 'stock', name: 'Look', icon: 'film', controls: ['look-picker', 'lookAmount'] },
  { id: 'whitebalance', name: 'White Balance', icon: 'sun', controls: ['wb-tools', 'temperature', 'tint'] },
  { id: 'exposure', name: 'Exposure', icon: 'contrast', controls: ['exposure', 'contrast', 'toneCharacter', 'saturation', 'vibrance'] },
  { id: 'hdr', name: 'High Dynamic Range', icon: 'sun', controls: ['highlights', 'shadows', 'whites', 'blacks'] },
  { id: 'curve', name: 'Tone curve', icon: 'waves', controls: ['curve'] },
  { id: 'color', name: 'HSL', icon: 'palette', controls: WORKSPACE_SLIDERS.filter(d => d.category === 'HSL').map(d => d.id) },
  { id: 'grading', name: 'Colour wheels', icon: 'palette', controls: ['grading-wheel', ...WORKSPACE_SLIDERS.filter(d => d.category === 'Colour grading').map(d => d.id), 'shadows', 'saturation'] },
  { id: 'detail', name: 'Detail', icon: 'focus', controls: [...WORKSPACE_SLIDERS.filter(d => d.category === 'Detail').map(d => d.id), 'detail-order'] },
  { id: 'optics', name: 'Optics', icon: 'sparkles', controls: WORKSPACE_SLIDERS.filter(d => d.category === 'Finish').map(d => d.id) },
  { id: 'grain', name: 'Grain', icon: 'film', controls: ['grain-speed', ...WORKSPACE_SLIDERS.filter(d => d.category === 'Grain').map(d => d.id)] },
  { id: 'noise', name: 'Noise reduction', icon: 'waves', controls: WORKSPACE_SLIDERS.filter(d => d.category === 'Noise reduction').map(d => d.id) },
  { id: 'lens', name: 'Lens corrections', icon: 'aperture', controls: ['lens-tools', ...WORKSPACE_SLIDERS.filter(d => d.category === 'Lens corrections').map(d => d.id)] },
  { id: 'transform', name: 'Transform', icon: 'focus', controls: ['transform-tools', ...WORKSPACE_SLIDERS.filter(d => d.category === 'Transform').map(d => d.id)] },
];
export const workspaceGroup = (id: string) => WORKSPACE_GROUPS.find(g => g.id === id);
const controlLabels: Record<string, string> = { 'look-picker': 'Look picker', 'grading-wheel': 'Colour wheel', 'lens-tools': 'Profile and correction switches', 'transform-tools': 'Auto correction and crop constraint' };
export const workspaceGroupControlLabel = (id: string) => controlLabels[id] ?? workspaceControl(id)?.label ?? id;
