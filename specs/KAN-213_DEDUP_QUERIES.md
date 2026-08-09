# KAN-213 — duplicate-recipe queries and one-time purge runbook

Working document for Sprint 6 / S1. Copy-paste into **Cloud SQL Studio**.
Not synced to Confluence (same treatment as `specs/KAN-119_LOOP_PLAN.md`).

> **Nothing here deletes anything until §5, and §5 runs inside a transaction that ends in
> `ROLLBACK` until you deliberately change it.** Read a result before you act on it.

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

### 3b. POTENTIAL duplicates — public name collisions, any owner

```sql
SELECT name, count(*) AS dupes
FROM recipe WHERE is_public = true
GROUP BY name HAVING count(*) > 1 ORDER BY dupes DESC, name;
```

### 3c. CONFIRMED duplicates — same name AND same image

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
duplicates have **no image**. Their pairs are (original _with_ image, duplicate _without_),
so **3c will not match them** — they hide in 3b. They are also the rows rendering a blank
hero and blank OG image on the public site.

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

---

## 4. Survivor rule

Pre-decided so the purge needs no judgement call mid-flight.

1. **Never delete `is_canonical = true`.** Locked by design; seeded by migration.
2. **Public rows: keep the one WITH an image, delete the imageless twin.** The KAN-194
   publish-toggle duplicate is often the _newer_ row and always the worse one — it renders a
   blank hero and blank OG. Beats `created_at` for this pass.
3. **Otherwise: keep the oldest `created_at`.**
4. **Tiebreak: if exactly one row is `is_public`, keep that one.**

Scope: **a one-time purge of rows created before the guard exists.** Slug suffixing
behaviour going forward is unchanged — a genuinely different recipe still gets `-2`.

---

## 5. The purge — transaction-wrapped, ends in ROLLBACK

Replace the id list with ids you have actually read from §2b / §3e.
**Do not write a blind `DELETE … USING`.**

```sql
BEGIN;

-- 1. preview EXACTLY what will go
SELECT id, name, slug, is_public, is_canonical, created_at
FROM recipe WHERE id IN ('<id-1>', '<id-2>');

-- 2. refuse to proceed if any canonical row is in the list (must return 0)
SELECT count(*) AS canonical_in_list
FROM recipe WHERE id IN ('<id-1>', '<id-2>') AND is_canonical = true;

-- 3. delete
DELETE FROM recipe WHERE id IN ('<id-1>', '<id-2>') AND is_canonical = false;

-- 4. re-run the §2 count — must now return 0 rows
SELECT user_id, source_slug, count(*) AS dupes
FROM recipe
WHERE source_slug IS NOT NULL AND user_id IS NOT NULL
GROUP BY user_id, source_slug HAVING count(*) > 1;

ROLLBACK;   -- swap to COMMIT only when every result above looks right
```

Run it once ending in `ROLLBACK` and read the output. Then change the last line to `COMMIT`
and run again. Backups are on (`backupConfiguration.enabled: true`) and deletion protection
is enabled, but neither undoes a wrong `DELETE` cheaply.

---

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
