# SPDX-License-Identifier: GPL-3.0-or-later
"""Regenerate native DCP fixtures from the pinned RawTherapee checkout."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

PIN = 'b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c'
here = Path(__file__).resolve().parent
repo = here.parents[2]
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 tools/probe/dcp-reference/run.py /path/to/RawTherapee')
upstream = Path(sys.argv[1]).resolve()
commit = subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip()
if commit != PIN:
    raise SystemExit(f'Expected RawTherapee {PIN}, got {commit}')
fixtures = repo / 'src/engine/fixtures'
with tempfile.TemporaryDirectory(prefix='emulsion-dcp-reference-') as tmp:
    def script(name, *args):
        subprocess.run([sys.executable, str(here/name), *map(str, args)], check=True)
    script('extract.py', upstream, tmp)
    script('extend-tone.py', upstream, tmp)
    binary = Path(tmp)/'dcp-core'
    subprocess.run([os.environ.get('CXX', 'clang++'), '-std=c++17', '-O2', str(Path(tmp)/'dcp-core.cpp'), '-o', str(binary)], check=True)
    script('make-fixtures.py', binary, fixtures/'dcp-native.json')
    script('make-profile.py', fixtures/'dcp-native.json', fixtures/'synthetic.dcp')
print('Regenerated native JSON and synthetic DCP fixtures.')
