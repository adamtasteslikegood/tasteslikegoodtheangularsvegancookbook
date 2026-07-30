import { describe, expect, it } from 'vitest';
import { interpretSaveResponse } from './persistence.service';

/**
 * KAN-155 — a 409 from POST /api/recipes is a REFUSAL, not a success.
 *
 * This file exists because of a single line that was correct when written and
 * silently became wrong:
 *
 *     if (!res.ok && res.status !== 409) { ...return false }
 *
 * The comment above it said "the current API never returns 409 (it upserts
 * instead of conflicting)", and while that held, letting 409 fall through to
 * `return true` was harmless. Then the ownership refusal moved from 500 to 409
 * (Backend #256) and the same line began reporting a rejected write as a
 * successful one — leaving the optimistic `is_public: true` on screen over a row
 * the server never stored. The user is told they published something they did
 * not.
 *
 * Nothing in the frontend changed to cause that. It broke because a downstream
 * contract moved, which is exactly the kind of break a unit test has to catch:
 * the type checker cannot see an HTTP status.
 */
describe('interpretSaveResponse (KAN-155)', () => {
  const res = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it('reports a 409 as a refusal, not a success', async () => {
    // The core regression. If this ever returns null (= "continue, it worked"),
    // the publish toggle stays on over a row the server refused to write.
    const outcome = await interpretSaveResponse(
      res(409, { error: 'refused', code: 'OWNERSHIP_OTHER_ACCOUNT' })
    );

    expect(outcome).not.toBeNull();
    expect(outcome?.ok).toBe(false);
  });

  it('surfaces the server code so the UI can pick the right message', async () => {
    for (const code of [
      'OWNERSHIP_OTHER_ACCOUNT',
      'OWNERSHIP_OTHER_GUEST_SESSION',
      'OWNERSHIP_ORPHANED_GUEST_ROW',
    ]) {
      const outcome = await interpretSaveResponse(res(409, { code }));
      expect(outcome?.refusal, code).toBe(code);
    }
  });

  it('degrades a 409 with no code to a generic ownership refusal', async () => {
    // A Backend older than the three-code split still answers a bare 409. It is
    // still a refusal — the absence of a code must never read as success.
    const outcome = await interpretSaveResponse(res(409, { error: 'refused' }));

    expect(outcome).toEqual({ ok: false, refusal: 'ownership' });
  });

  it('degrades an unrecognised 409 code to a generic ownership refusal', async () => {
    // A code from a Backend newer than this build.
    const outcome = await interpretSaveResponse(res(409, { code: 'OWNERSHIP_SOMETHING_FUTURE' }));

    expect(outcome).toEqual({ ok: false, refusal: 'ownership' });
  });

  it('treats a 409 with an unparseable body as a refusal, not a crash', async () => {
    const outcome = await interpretSaveResponse({
      ok: false,
      status: 409,
      json: async () => {
        throw new SyntaxError('not json');
      },
    });

    expect(outcome).toEqual({ ok: false, refusal: 'ownership' });
  });

  it('never reports an ownership refusal as a sync failure', async () => {
    // Would put the connection message back on a permission decision — the
    // original KAN-155 complaint.
    const outcome = await interpretSaveResponse(res(409, { code: 'OWNERSHIP_OTHER_ACCOUNT' }));

    expect(outcome?.refusal).not.toBe('sync');
  });

  it('still reports a non-409 server error as a sync failure', async () => {
    expect(await interpretSaveResponse(res(500, { error: 'boom' }))).toEqual({
      ok: false,
      refusal: 'sync',
    });
    expect(await interpretSaveResponse(res(400, { error: 'bad slug' }))).toEqual({
      ok: false,
      refusal: 'sync',
    });
  });

  it('returns null on success so the caller continues to the slug mirror-back', async () => {
    // KAN-149 (#3262): the server mints the slug and the caller must adopt it.
    // Short-circuiting a 201 here would silently break the View link.
    expect(await interpretSaveResponse(res(201, { id: 'r1', slug: 'vegan-cornbread' }))).toBeNull();
    expect(await interpretSaveResponse(res(200, { id: 'r1' }))).toBeNull();
  });
});
