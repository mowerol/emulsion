// SPDX-License-Identifier: GPL-3.0-or-later
import { Aperture, Circle, Contrast, Film, Focus, Heart, Layers, Palette, SlidersHorizontal, Sparkles, Sun, Waves } from 'lucide-react';
import { WORKSPACE_ICONS, type WorkspaceIcon } from './controlworkspace';

const icons = { sliders: SlidersHorizontal, sun: Sun, palette: Palette, sparkles: Sparkles, film: Film, contrast: Contrast, aperture: Aperture, focus: Focus, waves: Waves, layers: Layers, heart: Heart, circle: Circle };
const labels: Record<WorkspaceIcon, string> = { sliders: 'Sliders', sun: 'Sun', palette: 'Palette', sparkles: 'Sparkles', film: 'Film', contrast: 'Contrast', aperture: 'Aperture', focus: 'Focus', waves: 'Waves', layers: 'Layers', heart: 'Heart', circle: 'Circle' };
export function WorkspaceIconView({ name, size = 16 }: { name: WorkspaceIcon; size?: number }) {
  const Icon = icons[name]; return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}
export function WorkspaceIconPicker({ value, label, onChange }: { value: WorkspaceIcon; label: string; onChange: (v: WorkspaceIcon) => void }) {
  return <label className="workspace-icon-picker"><WorkspaceIconView name={value} />
    <select aria-label={label} value={value} onChange={e => onChange(WORKSPACE_ICONS.find(i => i === e.target.value) ?? 'sliders')}>
      {WORKSPACE_ICONS.map(id => <option key={id} value={id}>{labels[id]}</option>)}
    </select>
  </label>;
}
