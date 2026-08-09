# KAN-213 — duplicate-recipe queries and one-time purge runbook

Working document for Sprint 6 / S1. Copy-paste into **Cloud SQL Studio**.
Not synced to Confluence (same treatment as `specs/KAN-119_LOOP_PLAN.md`).

> **Nothing here deletes anything until §5. Studio does not honour `BEGIN…ROLLBACK` blocks
> reliably (§5 preamble), so §5 runs statements one at a time with a preview `SELECT`, an
> `is_canonical = false` write guard, and a zero-row verify after each mutation.** Read every
> result before running the next statement.

---

## 0. Connect

| Field    | Value                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Console  | Cloud SQL → `vegangenius-db` → **Studio**                                                                        |
| Auth     | **Built-in** — required to run `GRANT` or `DELETE` as the owner                                                  |
| User     | `vegangenius-user`                                                                                               |
| Password | `gcloud secrets versions access latest --secret=DATABASE_URL` → the 24 chars between `vegangenius-user:` and `@` |
| Database | **`vegangenius`** — _not_ `postgres`, which is the empty maintenance DB                                          |

IAM auth (`adamschoen3@tasteslikegood.org`) is enabled and has **SELECT only** — fine for
reading, cannot grant or delete. Use built-in for anything in §5.

**Run statements ONE AT A TIME.** Studio commonly displays only the last statement's result
set, which silently hides earlier output and has already produced one wrong reading.

---

## 1. Privileges (KAN-217 — done, keep for reference)

```sql
-- as vegangenius-user (the owner). Granting as the IAM user silently no-ops.
GRANT USAGE  ON SCHEMA public               TO "adamschoen3@tasteslikegood.org";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO "adamschoen3@tasteslikegood.org";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO "adamschoen3@tasteslikegood.org";
```

```sql
-- ALWAYS verify. GRANT returns success while granting nothing if you lack authority;
-- it only emits "WARNING: no privileges were granted", which Studio buries.
SELECT has_schema_privilege('adamschoen3@tasteslikegood.org','public','USAGE')  AS usage_ok,
       has_table_privilege ('adamschoen3@tasteslikegood.org','recipe','SELECT') AS select_ok;
```

---

## 2. The constraint-blocking counts — RUN, RESULTS RECORDED 2026-08-08

These decide whether the unique index can be created at all. **Both `WHERE` clauses are
load-bearing** — dropping them makes `GROUP BY` collapse every `NULL` into one bucket and
invent phantom duplicates (it reported "112" for user 1, which was not 112 duplicates).

```sql
-- authenticated → RESULT: 2 groups, 2 rows each, both user_id = 1
SELECT user_id, source_slug, count(*) AS dupes
FROM recipe
WHERE source_slug IS NOT NULL AND user_id IS NOT NULL
GROUP BY user_id, source_slug HAVING count(*) > 1 ORDER BY dupes DESC;
```

```sql
-- guest → RESULT: 0 rows. Guest partial index needs no backfill.
SELECT guest_session_id, source_slug, count(*) AS dupes
FROM recipe
WHERE source_slug IS NOT NULL AND guest_session_id IS NOT NULL
GROUP BY guest_session_id, source_slug HAVING count(*) > 1 ORDER BY dupes DESC;
```

**Verdict: 4 rows involved, 2 to delete.** S1 is a 1–2 day item.

### 2b. Inspect those 4 before deleting

```sql
SELECT id, name, slug, source_slug, is_public, is_canonical, origin, created_at
FROM recipe
WHERE user_id = 1
  AND source_slug IN ('vegan-fried-pizza-dough-with-powdered-sugar',
                      'vegan-banana-apple-cider-oatmeal-raisin-cookies')
ORDER BY source_slug, created_at;
```

Check: does the `is_public` tiebreak fire, and is either row `is_canonical`?
**A canonical row is locked and must never be deleted.**

---

## 3. The public-surface purge — duplicates visible on the live site

Independent of §2. §2 unblocks the migration; §3 cleans what users actually see.

### 3a. Which image field is populated?

```sql
SELECT count(*) AS public_total,
       count(*) FILTER (WHERE data->>'ai_image_url'    IS NOT NULL) AS has_ai,
       count(*) FILTER (WHERE data->>'stock_image_url' IS NOT NULL) AS has_stock,
       count(*) FILTER (WHERE data->>'image'           IS NOT NULL) AS has_image
FROM recipe WHERE is_public = true;
```

There is **no image column** — image lives in the `data` JSON blob.

> ### ⚠️ The image test does not work. Verified 2026-08-08.
>
> Every row's image resolves to **`/api/recipes/<its own id>/image`** — derived from the row id,
> so **no two rows can ever match on image, duplicate or not.** §3c below is structurally
> incapable of returning a row and is kept only as a record of the dead end. Comparing images
> for real would mean hashing the GCS objects, which is not worth building for a one-time purge.
>
> **Use `source_slug IS NULL` instead** — it identifies the author's original, and everything
> with a `source_slug` is a saved copy. That turned out to be a cleaner signal than image ever
> would have been. See §3f.

### 3b. POTENTIAL duplicates — public name collisions, any owner

```sql
SELECT name, count(*) AS dupes
FROM recipe WHERE is_public = true
GROUP BY name HAVING count(*) > 1 ORDER BY dupes DESC, name;
```

### 3c. ~~CONFIRMED duplicates — same name AND same image~~ — DEAD END, returns nothing

```sql
SELECT name,
       COALESCE(data->>'ai_image_url', data->>'stock_image_url', data->>'image') AS img,
       count(*) AS dupes
FROM recipe WHERE is_public = true
GROUP BY name, COALESCE(data->>'ai_image_url', data->>'stock_image_url', data->>'image')
HAVING count(*) > 1 ORDER BY dupes DESC, name;
```

### 3d. The KAN-194 pattern — imageless twins

`togglePublic()` never backfills the image from the source recipe, so publish-toggle
duplicates were expected to have **no image**, hiding from 3c and surfacing only in 3b.

**Did not appear in the 2026-08-08 data** — all 11 public duplicate rows carry an image URL
(self-referential, per the warning in 3a). Keep the query for future passes; it was not the
mechanism behind this set.

```sql
SELECT name, count(*) AS rows_,
       count(*) FILTER (
         WHERE COALESCE(data->>'ai_image_url', data->>'stock_image_url', data->>'image') IS NULL
       ) AS imageless
FROM recipe WHERE is_public = true
GROUP BY name HAVING count(*) > 1 ORDER BY imageless DESC, rows_ DESC;
```

### 3e. Full row detail for every public name collision

```sql
SELECT r.id, r.name, r.slug, r.user_id, r.guest_session_id, r.source_slug,
       r.is_canonical, r.origin, r.created_at,
       COALESCE(r.data->>'ai_image_url', r.data->>'stock_image_url', r.data->>'image') AS img
FROM recipe r
JOIN (SELECT name FROM recipe WHERE is_public = true
      GROUP BY name HAVING count(*) > 1) d ON d.name = r.name
WHERE r.is_public = true
ORDER BY r.name, r.created_at;
```

### 3f. What §3e actually found — 2026-08-08

11 public rows across 5 name groups. **None of them are KAN-213's bug.** Every duplicate carries
a `source_slug` pointing at the original, so each is a _saved copy that inherited
`is_public = true` from its source_ — the cross-author publish-state defect (KAN-137 cluster).
These are exactly the rows created before that fix, which is the population this pass clears.

| Group                                            | Original (`source_slug` NULL)                               | Saved copies now public                              |
| ------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------- |
| Vegan English Breakfast with Oven-Dried Tomatoes | user 7 · `48b3856c`                                         | user 3 · `a554e5d1` · user 1 · `6c80e79e`            |
| Sparkling Iced Yuzu Matcha                       | user 2 · `16c74921`                                         | user 1 · `d3b9dbeb`                                  |
| Homemade Vegan Flour Tortillas                   | user 1 · `d2332b8d`                                         | user 3 · `376378a8`                                  |
| Vegan Banana Apple Cider Oatmeal Raisin Cookies  | user 1 · `8d4b84fc` (`generated`)                           | user 1 · `e8f8cd84` (`saved` — own recipe)           |
| Vegan Cornbread                                  | user 1 · `2ae1c984` — **typo slug `vegasssdsdn-cornbread`** | user 3 · `7e480d4b` — **`is_canonical`**, clean slug |

**Unpublish 6, keep 5.** Cornbread inverts the rule: the canonical copy wins and the typo-slugged
original is the one that goes.

**Consequence to decide before running §5:** `7e480d4b.source_slug = 'vegasssdsdn-cornbread'`, so
unpublishing its source leaves the canonical Cornbread page pointing "source" at a 404 — the same
defect class as KAN-212. A curated canonical recipe does not need provenance, so:

```sql
UPDATE recipe SET source_slug = NULL
WHERE id = '7e480d4b-2a87-41e8-a9e0-f005eb19fa2d';
```

### 3g. Not duplicates — do not purge these

- **`"Generating..." × 2`** — placeholder name on rows with `status = 'generating'`; abandoned or
  stuck generation jobs (see `worker_claim_token`). Two orphaned rows, not duplication. Worth a
  separate look; **exclude from any purge list.**
- **Same-name rows with different `source_slug` lineage** — e.g. "Vegan Oatmeal Raisin Cookies" vs
  "Vegan Banana Apple Cider Oatmeal Raisin Cookies" are different recipes. Name alone is a
  candidate list, never a verdict.

---

## 4. Survivor rule — REVISED 2026-08-08 after seeing §3e

The image-based rule was written before the data was read and does not work (§3a). Replaced:

1. **Never touch `is_canonical = true`.** Locked by design; seeded by migration. Every
   statement in §5 carries `AND is_canonical = false` as a structural guard, so a mistyped id
   still cannot reach a canonical row.
2. **Keep the row with `source_slug IS NULL`** — the author's original. Unpublish the copies.
   A saved copy should never have been public.
3. **Exception — when a copy is canonical, the copy wins.** Cornbread: the canonical row holds
   the clean slug `vegan-cornbread` while the original holds the typo slug
   `vegasssdsdn-cornbread`. Keep canonical, unpublish the original.
4. **Fall back to oldest `created_at`** only when neither rule decides.

~~Keep the one WITH an image~~ — dead, see §3a.

Scope: **a one-time purge of rows created before the guard exists.** Slug suffixing
behaviour going forward is unchanged — a genuinely different recipe still gets `-2`.

---

## 5. The purge — ONE STATEMENT AT A TIME, no transaction wrapper

> ### ⚠️ Cloud SQL Studio does not run `BEGIN…ROLLBACK` blocks reliably. Verified 2026-08-08.
>
> The first version of this section wrapped every purge in `BEGIN … ROLLBACK` and told you to
> flip the last line to `COMMIT`. **That guard does not work in Studio**, and it contradicted
> §0's own instruction to run statements one at a time.
>
> Proof: inside the §5b block, `SELECT … WHERE id IN ('e8f8cd84…','c491e407…')` returned **no
> rows**, while the identical statement run standalone returned **both rows**. Same session, same
> data, seconds apart. 5a happened to produce the right outcome — by luck, not by the rollback
> it appeared to have.
>
> **A safety mechanism that silently does not work is worse than none**, because it buys
> confidence it cannot honour. Same lesson as the retro automation that never fired and the
> Alembic head-check that could not fail.
>
> **Run every statement below individually and read each result before the next.**

### 5a. Public surface — UNPUBLISH, do not delete — ✅ DONE 2026-08-08

These rows have live `/r/<slug>` URLs. Deleting turns each into a hard 404 and some may be
indexed; duplicate content is the SEO harm, and a surviving _private_ row causes none.
Unpublishing drops them from `/browse` and the sitemap immediately and is reversible — the
precedent KAN-157 set. Cornbread deliberately excluded, see §5c.

```sql
-- 1. preview (expect 5 rows, all is_public = true, all is_canonical = false)
SELECT id, name, slug, is_public, is_canonical FROM recipe WHERE id IN (
  '376378a8-626f-44c6-bc36-e827eab79047',   -- Flour Tortillas   — user 3's copy
  'd3b9dbeb-136a-409e-8865-371ba94ec71b',   -- Yuzu Matcha       — user 1's copy
  'e8f8cd84-bc1e-42fa-a8d1-9918af1edea5',   -- Banana Cookies    — user 1's own copy
  'a554e5d1-8f8b-407a-8b06-6b296c8bf0f7',   -- English Breakfast — user 3's copy
  '6c80e79e-d7fc-4eea-9b6d-ff24c15f7c63');  -- English Breakfast — user 1's copy
```

```sql
-- 2. apply
UPDATE recipe SET is_public = false WHERE id IN (
  '376378a8-626f-44c6-bc36-e827eab79047','d3b9dbeb-136a-409e-8865-371ba94ec71b',
  'e8f8cd84-bc1e-42fa-a8d1-9918af1edea5','a554e5d1-8f8b-407a-8b06-6b296c8bf0f7',
  '6c80e79e-d7fc-4eea-9b6d-ff24c15f7c63')
  AND is_canonical = false;
```

```sql
-- 3. verify — expect EXACTLY ONE row: Vegan Cornbread | 2. NOT zero.
SELECT name, count(*) FROM recipe WHERE is_public = true
GROUP BY name HAVING count(*) > 1;
```

One row is success; Cornbread is still duplicated on purpose. Zero would mean something
unintended was unpublished. More than one means an id did not take.

**Result 2026-08-08:** preview showed the 5, verify showed only Cornbread, committed. ✅

### 5b. Constraint blockers — DELETE, and only these — ✅ DONE 2026-08-08

Unpublishing does **not** clear these: the index keys on `source_slug` regardless of
`is_public`. Survivors are the older row in each pair; in the Fried Pizza Dough pair the age
rule and the `is_public` tiebreak agree.

| Group             | Keep                                         | Delete                       |
| ----------------- | -------------------------------------------- | ---------------------------- |
| Banana Cookies    | `bcf07835` — 07-31 06:31                     | **`e8f8cd84`** — 07-31 16:13 |
| Fried Pizza Dough | `2ea758d4` — 07-30, also the only public one | **`c491e407`** — 08-02       |

```sql
-- 1. preview (expect 2 rows, both is_canonical = false)
SELECT id, slug, source_slug, is_public, is_canonical, created_at FROM recipe
WHERE id IN ('e8f8cd84-bc1e-42fa-a8d1-9918af1edea5',
             'c491e407-41b2-4b56-995e-8f15a1b1f0eb');
```

```sql
-- 2. guard — must be 0
SELECT count(*) AS canonical_in_list FROM recipe
WHERE id IN ('e8f8cd84-bc1e-42fa-a8d1-9918af1edea5',
             'c491e407-41b2-4b56-995e-8f15a1b1f0eb') AND is_canonical = true;
```

```sql
-- 3. IRREVERSIBLE — no rollback behind this. Expect 2 rows affected.
DELETE FROM recipe
WHERE id IN ('e8f8cd84-bc1e-42fa-a8d1-9918af1edea5',
             'c491e407-41b2-4b56-995e-8f15a1b1f0eb') AND is_canonical = false;
```

```sql
-- 4. THE GATE — must return 0 rows. Until it does, the unique index cannot be created.
SELECT user_id, source_slug, count(*) AS dupes FROM recipe
WHERE source_slug IS NOT NULL AND user_id IS NOT NULL
GROUP BY user_id, source_slug HAVING count(*) > 1;
```

**Result 2026-08-08:** guard returned 0, `DELETE` reported success, and **statement 4 returned no
rows**. The constraint-blocking duplicates are gone and the unique index is unblocked. ✅

**These were not concurrent saves.** The pairs are **10 hours** and **3 days** apart — deliberate
re-saves, not KAN-213's two-tab race. The constraint still catches them correctly (INV-1's "you
already have this recipe" is exactly the right answer), but the duplicate population came from
repeated saving rather than a race. That is a stronger argument for the constraint than the race
was.

**Left public on purpose: `2ea758d4`.** It is a saved copy serving
`/r/vegan-fried-pizza-dough-with-powdered-sugar-2` while its original is private, so §3e never saw
it — that name has only one public row and therefore no collision. It is not a visible duplicate;
unpublishing would pull the recipe off the public site entirely. The `-2` in a live URL is
cosmetically odd, not a defect.

### 5c. Cornbread — decide individually, last

The only group where the **canonical copy survives and the original is unpublished**:

| Row              | id         | slug                                                   | Disposition              |
| ---------------- | ---------- | ------------------------------------------------------ | ------------------------ |
| original, user 1 | `2ae1c984` | **`vegasssdsdn-cornbread`** — keyboard-mash typo, live | unpublish                |
| copy, user 3     | `7e480d4b` | `vegan-cornbread` — clean                              | **keep, `is_canonical`** |

```sql
UPDATE recipe SET is_public = false
WHERE id = '2ae1c984-be3f-488f-9adb-5489c9fc8c28' AND is_canonical = false;
```

```sql
-- PENDING DECISION: prevents a dead "source" link on /r/vegan-cornbread (KAN-212 class),
-- since 7e480d4b.source_slug points at the slug just unpublished.
-- UPDATE recipe SET source_slug = NULL WHERE id = '7e480d4b-2a87-41e8-a9e0-f005eb19fa2d';
```

```sql
SELECT name, count(*) FROM recipe WHERE is_public = true
GROUP BY name HAVING count(*) > 1;   -- now expect 0 rows
```

## 6. After the purge — the constraint (S1's actual deliverable)

Ships as an Alembic migration, not by hand. Recorded here so the SQL is reviewable.

```sql
CREATE UNIQUE INDEX CONCURRENTLY uq_recipe_user_source_slug
  ON recipe (user_id, source_slug)
  WHERE source_slug IS NOT NULL AND user_id IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY uq_recipe_guest_source_slug
  ON recipe (guest_session_id, source_slug)
  WHERE source_slug IS NOT NULL AND guest_session_id IS NOT NULL;
```

**Both ship together or neither** (R3) — `user_id` is nullable and guests key on
`guest_session_id`, which is the KAN-186 path.

`CONCURRENTLY` cannot run inside a transaction; in Alembic use
`op.execute(...)` with `autocommit_block()`.

### Known coverage limit — state it, do not paper over it

These are **partial** indexes. Rows with `source_slug IS NULL` — generated and manually
entered recipes, the large majority of the table — are **not constrained**. That is correct:
a generated recipe has no provenance to collide on, and a name-based constraint was rejected
because two genuinely different recipes may share a title.

So D1 closes KAN-213's class. **It does not make the table duplicate-free**, and the charter
must not be read that way.

### Blind-spot probe (§3's cousin, for NULL-source rows)

```sql
-- RESULT 2026-08-08: 4 groups — 2 confirmed same-user (user_id 2), 2 were the NULL-user
-- artifact. Same name is NOT the same recipe; needs a content check before it means anything.
SELECT user_id, name, count(*) AS dupes
FROM recipe WHERE source_slug IS NULL
GROUP BY user_id, name HAVING count(*) > 1 ORDER BY dupes DESC;
```

```sql
-- are the user-2 pairs one recipe or two attempts?
SELECT id, name, created_at, origin, is_public, length(data::text) AS data_len
FROM recipe
WHERE source_slug IS NULL AND user_id = 2
  AND name IN ('Vegan Pot Pie','Vegan Cinnamon Sugar Dessert Tacos')
ORDER BY name, created_at;
```

Similar `data_len` ⇒ likely genuine duplicates. Clearly different ⇒ two distinct recipes
sharing a name, and there is no bug. Enforcing uniqueness here would need a **normalized
content-hash column** — a schema change worth costing only against evidence, as a Sprint 7
ticket. Not Sprint 6 scope.
