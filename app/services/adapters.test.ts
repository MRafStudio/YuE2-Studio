import { describe, expect, it } from 'vitest';
import { usesFromSettings } from './adapters';

describe('restoring adapter strengths', () => {
  it('preserves zero slots and signed strengths from engine and prompt requests', () => {
    expect(usesFromSettings({ adapters: [{ name: 'voice', ar_scale: 0, nar_scale: -10 }] }))
      .toEqual([{ id: 'voice', scales: { ar: 0, nar: -10 } }]);
    expect(usesFromSettings({ adapters: [{ id: 'voice', scales: { ar: 10, nar: 0 } }] }))
      .toEqual([{ id: 'voice', scales: { ar: 10, nar: 0 } }]);
  });
});
