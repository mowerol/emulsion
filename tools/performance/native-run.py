"""Add audit tests to a disposable source snapshot, never to the shared app tree."""
import pathlib
import shutil
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[2]
snapshot = pathlib.Path(sys.argv[1]).resolve()
if snapshot == root or not snapshot.name.startswith('emulsion-audit-'):
    raise SystemExit('Expected a disposable emulsion-audit-* snapshot')
native = snapshot / 'src-tauri'
for name in ['Cargo.toml', 'Cargo.lock', 'build.rs', 'tauri.conf.json']:
    shutil.copy2(root / 'src-tauri' / name, native / name)
for name in ['native', 'vendor', 'icons', 'capabilities', 'gen']:
    path = native / name
    if not path.exists():
        path.symlink_to(root / 'src-tauri' / name, target_is_directory=True)
shutil.copy2(root / 'tools/performance/native-audit.rs', native / 'src/app_performance_audit.rs')
lib = native / 'src/lib.rs'
if 'mod app_performance_audit;' not in lib.read_text():
    with lib.open('a') as stream:
        stream.write('\n#[cfg(test)] mod app_performance_audit;\n')
subprocess.run(['cargo', 'test', '--lib', 'app_performance_native_audit', '--', '--nocapture', '--test-threads=1'], cwd=native, check=True)
