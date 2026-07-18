import { describe, expect, it } from 'vitest';

// Harness negative control (SPEC-01 acceptance 6): this PR must be blocked
// by branch protection. Never merge.
describe('gate negative control', () => {
  it('deliberately fails to prove the gate blocks merging', () => {
    expect(true).toBe(false);
  });
});
