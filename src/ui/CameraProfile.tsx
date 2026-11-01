// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { cameraKey, type CameraProfileId, type CameraMetadata } from '../film/profiles';
import {
  importProfile,
  profileEntries,
  profileLabel,
  refreshProfiles,
  sameCamera,
  setDefaultProfile,
  useProfileVersion,
} from '../engine/profilestore';

export function CameraProfileControls({
  raw,
  camera,
  value,
  onChange,
}: {
  raw: boolean;
  camera: CameraMetadata | null;
  value: CameraProfileId;
  onChange: (value: CameraProfileId) => void;
}) {
  useProfileVersion();
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void refreshProfiles().catch((e) => setError(String(e)));
  }, []);
  const available = camera ? profileEntries().filter((p) => sameCamera(p.camera, cameraKey(camera))) : [];
  const custom = value.startsWith('dcp:');
  const importDcp = async () => {
    if (!camera) return;
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'DNG camera profile', extensions: ['dcp'] }],
        title: 'Import a camera profile',
      });
      if (typeof path !== 'string') return;
      setBusy(true);
      setError(null);
      const entry = await importProfile(path, camera);
      onChange(`dcp:${entry.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!raw)
    return <p className="hint">This photo already has its camera rendering. Camera profiles apply to RAW files.</p>;
  return (
    <>
      <div className="grain-speed">
        <label htmlFor="camera-profile">Profile</label>
        <select id="camera-profile" value={value} onChange={(e) => onChange(e.target.value as CameraProfileId)}>
          <option value="auto">Auto</option>
          <option value="standard">Standard</option>
          {!!available.length && (
            <optgroup label="Camera profiles">
              {available.map((p) => (
                <option key={p.id} value={`dcp:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {custom && !available.some((p) => `dcp:${p.id}` === value) && (
            <option value={value}>{profileLabel(value)}</option>
          )}
        </select>
      </div>
      <p className="hint">{camera ? cameraKey(camera) : 'Reading camera information…'}</p>
      {value === 'auto' && (
        <p className="hint">
          Uses this camera’s default profile, with the standard matrix when no profile is installed.
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn" disabled={!camera || busy} onClick={importDcp}>
          {busy ? 'Importing…' : 'Import DCP…'}
        </button>
        {custom && camera && available.some((p) => `dcp:${p.id}` === value) && (
          <button type="button" className="btn" onClick={() => setDefaultProfile(camera, value.slice(4))}>
            Use as camera default
          </button>
        )}
      </div>
      {error && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
