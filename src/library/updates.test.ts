import { describe, expect, it } from 'vitest';
import { autoCheckDue, normalizeUpdates, shouldOffer, updateErrorMessage, UPDATE_DEFAULTS } from './updates';

describe('update settings', () => {
  it('falls back to defaults for missing or bad values', () => {
    expect(normalizeUpdates(undefined)).toEqual(UPDATE_DEFAULTS);
    expect(normalizeUpdates({ automatic: 'yes', skipped: '', lastCheck: NaN })).toEqual(UPDATE_DEFAULTS);
    expect(normalizeUpdates({ automatic: false, skipped: '0.2.0', lastCheck: 5 })).toEqual({ automatic: false, skipped: '0.2.0', lastCheck: 5 });
  });
});

describe('automatic checks', () => {
  it('run at every launch while on, however recent the last one', () => {
    expect(autoCheckDue({ ...UPDATE_DEFAULTS })).toBe(true);
    expect(autoCheckDue({ ...UPDATE_DEFAULTS, lastCheck: Date.now() - 1000 })).toBe(true);
  });
  it('never run when off', () => {
    expect(autoCheckDue({ ...UPDATE_DEFAULTS, automatic: false })).toBe(false);
  });
});

describe('offering a version', () => {
  const s = { ...UPDATE_DEFAULTS, skipped: '0.2.0' };
  it('hides a skipped version from automatic checks only', () => {
    expect(shouldOffer('0.2.0', s, false)).toBe(false);
    expect(shouldOffer('0.2.0', s, true)).toBe(true);
    expect(shouldOffer('0.3.0', s, false)).toBe(true);
  });
});

describe('error messages', () => {
  it('tell a translocated app to move to Applications', () => {
    expect(updateErrorMessage(new Error('Read-only file system (os error 30)'))).toMatch(/Applications folder/);
    expect(updateErrorMessage('/private/var/folders/x/AppTranslocation/Emulsion.app')).toMatch(/Applications folder/);
  });
  it('say when the server could not be reached', () => {
    expect(updateErrorMessage('Could not fetch a valid release JSON from the remote')).toMatch(/update server/);
  });
  it('pass other errors through', () => {
    expect(updateErrorMessage('something odd')).toBe('something odd');
  });
});
