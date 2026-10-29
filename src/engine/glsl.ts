// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal `#include "file"` support for GLSL. Each file is included once.

const INCLUDE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;

export function assemble(entry: string, files: Record<string, string>, seen: Set<string> = new Set()): string {
  return entry.replace(INCLUDE, (_line, name: string) => {
    if (seen.has(name)) return `// ${name} already included`;
    const src = files[name];
    if (src === undefined) throw new Error(`Missing shader include: ${name}`);
    seen.add(name);
    return `// begin ${name}\n${assemble(src, files, seen)}\n// end ${name}`;
  });
}
