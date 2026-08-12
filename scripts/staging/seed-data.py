#!/usr/bin/env python3
"""
seed-data.py — Populate a staging database with sanitized test data.

Creates realistic row shapes (users, recipes, cookbooks) using fake data
so staging exercises the same code paths as production without exposing
any real PII. Covers edge cases: orphaned guest rows, multi-account
ownership, published/unpublished recipes, saved copies with source_slug.

Usage:
    # From the Backend/ directory with the staging DATABASE_URL set:
    DATABASE_URL=sqlite:///staging.db python ../scripts/staging/seed-data.py

    # Or via uv from Backend/:
    DATABASE_URL=sqlite:///staging.db uv run python ../scripts/staging/seed-data.py

    # Dry run (prints what would be created, no DB writes):
    DATABASE_URL=sqlite:///staging.db python ../scripts/staging/seed-data.py --dry-run

    # Also import an Export Cookbook JSON (real recipe shapes, no PII —
    # every imported row is owned by the synthetic staging-admin user):
    DATABASE_URL=... uv run python ../scripts/staging/seed-data.py \
        --from-json ../ADAMS_SAVEDveganRECIPE_COOKBOOK_EXPORT_ALL-2026-08-10.json
"""

import argparse
import json
import os
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
BACKEND_DIR = os.path.join(REPO_ROOT, "Backend")
if not os.path.isdir(BACKEND_DIR):
    sys.exit(f"Backend submodule not found at {BACKEND_DIR} — run: git submodule update --init Backend")
sys.path.insert(0, BACKEND_DIR)


def make_recipe_data(name, description="A delicious vegan recipe.", servings=4):
    """Build a minimal recipe data dict matching the production schema."""
    # Match the app's slug shape (^[a-z0-9-]+$): collapse every
    # non-alphanumeric run to a single hyphen instead of hand-stripping
    # individual punctuation marks.
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return {
        "name": name,
        "description": description,
        "servings": servings,
        "prep_time": "15 minutes",
        "cook_time": "30 minutes",
        "total_time": "45 minutes",
        "ingredients": [
            {"name": "tofu", "amount": "1", "unit": "block"},
            {"name": "soy sauce", "amount": "2", "unit": "tbsp"},
            {"name": "garlic", "amount": "3", "unit": "cloves"},
        ],
        "instructions": [
            {"step": 1, "text": "Prepare the ingredients."},
            {"step": 2, "text": "Cook until golden."},
            {"step": 3, "text": "Serve and enjoy."},
        ],
        "slug": slug,
        "tags": ["vegan", "staging-test"],
    }


# ── Seed data definitions ─────────────────────────────────────────────

USERS = [
    {
        "email": "staging-admin@example.test",
        "name": "Staging Admin",
        "google_id": "staging-google-100001",
    },
    {
        "email": "staging-chef@example.test",
        "name": "Chef Testington",
        "google_id": "staging-google-100002",
    },
    # User with no recipes (edge case: empty account)
    {
        "email": "staging-empty@example.test",
        "name": "Empty User",
        "google_id": "staging-google-100003",
    },
]

# Valid Recipe.status values (see Backend/blueprints/worker_api_bp.py):
# 'ready' (resting/complete), 'generating', 'generating_image', 'processing',
# 'error'. There is no 'complete' status.
RECIPES = [
    # Published recipes (is_public=True)
    {
        "name": "Staging Vegan Pad Thai",
        "owner_idx": 0,
        "is_public": True,
        "status": "ready",
    },
    {
        "name": "Staging Tofu Scramble",
        "owner_idx": 0,
        "is_public": True,
        "status": "ready",
    },
    {
        "name": "Staging Mushroom Risotto",
        "owner_idx": 1,
        "is_public": True,
        "status": "ready",
    },
    # Unpublished recipe (private to user)
    {
        "name": "Staging Secret Recipe",
        "owner_idx": 1,
        "is_public": False,
        "status": "ready",
    },
    # Saved copy (has source_slug pointing to a published recipe). The slug
    # column is globally unique, so saved copies cannot reuse the source slug —
    # leave slug NULL and let source_slug carry the identity, matching how the
    # app persists a save (Recipe._IDENTITY uses coalesce(source_slug, slug)).
    {
        "name": "Staging Vegan Pad Thai",
        "owner_idx": 1,
        "is_public": False,
        "status": "ready",
        "source_slug": "staging-vegan-pad-thai",
        "slug_override": None,
        "origin": "saved",
    },
    # Orphaned guest recipe (no user_id, has guest_session_id)
    {
        "name": "Staging Guest Creation",
        "owner_idx": None,
        "is_public": False,
        "status": "ready",
        "guest_session_id": "staging-guest-sess-001",
    },
    # Recipe stuck in generating state (edge case)
    {
        "name": "Generating Placeholder",
        "owner_idx": 0,
        "is_public": False,
        "status": "generating",
    },
    # Recipe in error state (edge case)
    {
        "name": "Failed Recipe",
        "owner_idx": 0,
        "is_public": False,
        "status": "error",
    },
]


# Export-record keys that map to Recipe columns rather than living inside
# Recipe.data. sourceSlug is the one camelCase→snake_case rename; the data
# payload itself already matches Backend/recipe_schema.json (camelCase
# prepTime/cookTime are canonical there).
EXPORT_COLUMN_KEYS = {"id", "sourceSlug", "is_public", "is_canonical", "origin"}

# Fields the SPA carries locally but that should never land in Recipe.data —
# ai_image_data is base64 image bytes that bloats the DB.
EXPORT_STRIP_KEYS = {"ai_image_data", "user_id"}

# recipe_schema.json's required keys — records missing any are reported and
# skipped rather than crashing the whole import.
EXPORT_REQUIRED_KEYS = {"name", "prepTime", "cookTime", "servings", "ingredients", "instructions"}


def import_export_json(path, owner, saved_owner=None, dry_run=False):
    """Import an Export Cookbook JSON file as recipes owned by `owner`.

    The export carries no user/email fields, so sanitization reduces to
    assigning synthetic owners. Every imported row is forced to
    status='ready' (exports only contain finished recipes). Idempotent by
    recipe id, with a slug-collision guard for re-exports under new ids.

    Rows with a sourceSlug (saved copies) go to `saved_owner` instead: an
    export can contain both a recipe (slug=X) and the account's saved copy
    of it (source_slug=X), which under a single owner would violate the
    one-row-per-(owner, identity) constraint — and a saved copy of another
    user's recipe is the realistic shape anyway (the publish-guard path).
    Returns the list of imported/existing recipe ids.
    """
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import func

    from extensions import db
    from models import Recipe

    saved_owner = saved_owner or owner

    with open(path) as f:
        records = json.load(f)

    imported, existed, invalid = 0, 0, 0
    recipe_ids = []
    now = datetime.now(timezone.utc)

    for i, rec in enumerate(records):
        missing = EXPORT_REQUIRED_KEYS - rec.keys()
        if missing:
            invalid += 1
            print(f"  SKIP invalid record {i} ({rec.get('name', '?')}): missing {sorted(missing)}")
            continue

        if dry_run:
            print(f"  [DRY RUN] Would import: {rec['name']} (public={rec.get('is_public')})")
            continue

        rid = str(rec["id"]) if rec.get("id") else str(uuid.uuid4())
        if db.session.get(Recipe, rid):
            existed += 1
            recipe_ids.append(rid)
            continue

        slug = rec.get("slug")
        if slug and Recipe.query.filter_by(slug=slug).first():
            # Same recipe re-exported under a new id: the slug row wins.
            existed += 1
            print(f"  Slug already present, skipping: {rec['name']} ({slug})")
            continue

        target = saved_owner if rec.get("sourceSlug") else owner
        identity = rec.get("sourceSlug") or slug
        if identity is not None:
            clash = Recipe.query.filter(
                Recipe.user_id == target.id,
                func.coalesce(Recipe.source_slug, Recipe.slug) == identity,
            ).first()
            if clash:
                existed += 1
                print(f"  Identity already present for owner, skipping: {rec['name']} ({identity})")
                continue

        data = {k: v for k, v in rec.items() if k not in EXPORT_COLUMN_KEYS and k not in EXPORT_STRIP_KEYS}
        recipe = Recipe(
            id=rid,
            user_id=target.id,
            name=rec["name"],
            data=data,
            slug=slug,
            source_slug=rec.get("sourceSlug"),
            status="ready",
            is_public=bool(rec.get("is_public")),
            is_canonical=bool(rec.get("is_canonical")),
            origin=rec.get("origin"),
            created_at=now - timedelta(minutes=len(records) - i),
            updated_at=now - timedelta(minutes=len(records) - i),
        )
        db.session.add(recipe)
        imported += 1
        recipe_ids.append(rid)

    print(f"  Export import: {imported} imported, {existed} already present, {invalid} invalid")
    return recipe_ids


def claim_ownership(claim_email, claim_from_email, dry_run=False):
    """Reassign one synthetic owner's rows to a real login email.

    Staging has no real-user OAuth by default, so imports land under a
    synthetic owner. Once staging login is enabled, the person testing needs
    those rows under THEIR account: this creates (or finds) a User with
    `claim_email` and moves the synthetic owner's recipes and cookbooks to
    it. The OAuth callback matches users by email before creating one
    (Backend/blueprints/auth_api_bp.py), so the first Google login with that
    address attaches to this row and the kitchen shows the claimed cookbook.

    Saved copies deliberately live under a second synthetic owner (the
    uq_recipe_user_recipe_identity constraint forbids holding a recipe and
    its saved copy under one owner) — those are not touched. Re-runnable: a
    second claim finds nothing left to move. Ran with the wrong email? Run
    again with --claim-from <wrong-email> --claim-email <right-one>.
    """
    from sqlalchemy import func

    from extensions import db
    from models import Cookbook, Recipe, User

    source = User.query.filter_by(email=claim_from_email).first()
    if not source:
        print(f"  Claim: no user with email {claim_from_email}; nothing to move")
        return

    if dry_run:
        n = Recipe.query.filter_by(user_id=source.id).count()
        print(f"  [DRY RUN] Would move {n} recipes + cookbooks from {claim_from_email} to {claim_email}")
        return

    target = User.query.filter_by(email=claim_email).first()
    if not target:
        target = User(email=claim_email, name=claim_email.split("@")[0])
        db.session.add(target)
        db.session.flush()
        print(f"  Claim: created user {claim_email} (id={target.id}, google_id unset until first login)")

    moved, skipped = 0, 0
    for recipe in Recipe.query.filter_by(user_id=source.id).all():
        identity = recipe.source_slug or recipe.slug
        if identity is not None:
            clash = Recipe.query.filter(
                Recipe.user_id == target.id,
                func.coalesce(Recipe.source_slug, Recipe.slug) == identity,
            ).first()
            if clash:
                skipped += 1
                print(f"  Claim: target already owns identity '{identity}', leaving: {recipe.name}")
                continue
        recipe.user_id = target.id
        moved += 1

    cb_moved = 0
    for cookbook in Cookbook.query.filter_by(user_id=source.id).all():
        if Cookbook.query.filter_by(user_id=target.id, name=cookbook.name).first():
            print(f"  Claim: target already owns cookbook '{cookbook.name}', leaving it")
            continue
        cookbook.user_id = target.id
        cb_moved += 1

    print(f"  Claim: moved {moved} recipes, {cb_moved} cookbooks {claim_from_email} → {claim_email} ({skipped} skipped)")


def seed(dry_run=False, from_json=None, claim_email=None, claim_from=None):
    """Create seed data in the staging database."""
    os.chdir(BACKEND_DIR)

    # Import after chdir so config.py resolves paths correctly
    from app import create_app
    from extensions import db
    from models import Cookbook, Recipe, User

    app = create_app()

    with app.app_context():
        if not dry_run:
            db.create_all()

        # ── Users ──
        created_users = []
        for u in USERS:
            if dry_run:
                print(f"  [DRY RUN] Would create user: {u['email']}")
                created_users.append(None)
                continue

            existing = User.query.filter_by(email=u["email"]).first()
            if existing:
                print(f"  User already exists: {u['email']} (id={existing.id})")
                created_users.append(existing)
                continue

            user = User(
                email=u["email"],
                name=u["name"],
                google_id=u["google_id"],
            )
            db.session.add(user)
            db.session.flush()  # get the id
            print(f"  Created user: {u['email']} (id={user.id})")
            created_users.append(user)

        # ── Recipes ──
        created_recipe_ids = []
        now = datetime.now(timezone.utc)

        for i, r in enumerate(RECIPES):
            user_id = created_users[r["owner_idx"]].id if r["owner_idx"] is not None and not dry_run else None
            data = make_recipe_data(r["name"])

            # slug_override lets a row (e.g. a saved copy) opt out of the
            # slug-from-name default and store NULL, avoiding a collision with
            # the source recipe's globally-unique slug.
            slug = r["slug_override"] if "slug_override" in r else data["slug"]
            source_slug = r.get("source_slug")
            guest_session_id = r.get("guest_session_id")

            if dry_run:
                owner_label = USERS[r["owner_idx"]]["email"] if r["owner_idx"] is not None else "guest"
                print(f"  [DRY RUN] Would create recipe: {r['name']} (owner={owner_label}, public={r['is_public']})")
                created_recipe_ids.append(str(uuid.uuid4()))
                continue

            # Idempotency: slugs are deterministic from the name and globally
            # unique, so a second run must skip rather than collide on the
            # unique index. The saved copy stores slug=NULL, so it is
            # identified by owner + source_slug + origin instead.
            if slug is not None:
                existing = Recipe.query.filter_by(slug=slug).first()
            else:
                existing = Recipe.query.filter_by(
                    user_id=user_id, source_slug=source_slug, origin=r.get("origin")
                ).first()
            if existing:
                print(f"  Recipe already exists: {r['name']} (id={existing.id})")
                created_recipe_ids.append(existing.id)
                continue

            recipe_id = str(uuid.uuid4())

            # Recipe.data is a MutableDict(JSON) column — SQLAlchemy handles
            # serialization. Pass the Python dict directly; json.dumps() here
            # would double-encode (or fail MutableDict.coerce).
            recipe = Recipe(
                id=recipe_id,
                user_id=user_id,
                name=r["name"],
                data=data,
                slug=slug,
                source_slug=source_slug,
                status=r["status"],
                is_public=r["is_public"],
                origin=r.get("origin"),
                guest_session_id=guest_session_id,
                created_at=now - timedelta(days=len(RECIPES) - i),
                updated_at=now - timedelta(days=len(RECIPES) - i),
            )
            db.session.add(recipe)
            print(f"  Created recipe: {r['name']} (id={recipe_id}, public={r['is_public']}, status={r['status']})")
            created_recipe_ids.append(recipe_id)

        # ── Cookbooks ──
        if not dry_run and created_users[0] is not None:
            # Existence check is by name, NOT owner: after --claim-email moves
            # the cookbook to a real account, a re-run must not recreate a
            # duplicate shell under staging-admin.
            existing_cb = Cookbook.query.filter_by(name="My Staging Cookbook").first()
            if existing_cb:
                print(f"  Cookbook already exists for user {created_users[0].email}")
            else:
                # Cookbook with recipe_ids (JSON list, matching production schema)
                public_ids = [
                    created_recipe_ids[i]
                    for i, r in enumerate(RECIPES)
                    if r["owner_idx"] == 0 and r["status"] == "ready"
                ]
                # Cookbook.recipe_ids is a JSON column — pass the Python list
                # directly. json.dumps() here would double-encode.
                cookbook = Cookbook(
                    id=str(uuid.uuid4()),
                    user_id=created_users[0].id,
                    name="My Staging Cookbook",
                    recipe_ids=public_ids,
                )
                db.session.add(cookbook)
                print(f"  Created cookbook: 'My Staging Cookbook' ({len(public_ids)} recipes)")
        elif dry_run:
            print("  [DRY RUN] Would create cookbook: 'My Staging Cookbook'")

        # ── Export Cookbook JSON import (optional) ──
        if from_json:
            print(f"\n  Importing export JSON: {from_json}")
            owner = created_users[0]
            saved_owner = created_users[1] if len(created_users) > 1 else None
            imported_ids = import_export_json(from_json, owner, saved_owner=saved_owner, dry_run=dry_run)
            if not dry_run and imported_ids:
                # By name, not owner — same reason as 'My Staging Cookbook':
                # a claim may have moved it to a real account, and the update
                # branch should refresh THAT copy rather than recreate one.
                existing_cb = Cookbook.query.filter_by(name="Imported Cookbook (staging)").first()
                if existing_cb:
                    existing_cb.recipe_ids = imported_ids
                    print("  Updated cookbook: 'Imported Cookbook (staging)'")
                else:
                    db.session.add(
                        Cookbook(
                            id=str(uuid.uuid4()),
                            user_id=owner.id,
                            name="Imported Cookbook (staging)",
                            recipe_ids=imported_ids,
                        )
                    )
                    print(f"  Created cookbook: 'Imported Cookbook (staging)' ({len(imported_ids)} recipes)")

        # ── Ownership claim (optional) ──
        if claim_email:
            print(f"\n  Claiming {claim_from} rows for {claim_email}")
            claim_ownership(claim_email, claim_from, dry_run=dry_run)

        if not dry_run:
            db.session.commit()
            print(f"\nSeeded: {len(USERS)} users, {len(RECIPES)} recipes, 1 cookbook")
        else:
            print(f"\n[DRY RUN] Would seed: {len(USERS)} users, {len(RECIPES)} recipes, 1 cookbook")


def main():
    parser = argparse.ArgumentParser(description="Seed staging database with test data")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be created without writing to DB")
    parser.add_argument(
        "--from-json",
        metavar="PATH",
        help="Also import an Export Cookbook JSON file (rows owned by the synthetic staging-admin user)",
    )
    parser.add_argument(
        "--claim-email",
        metavar="EMAIL",
        help="Reassign the synthetic owner's recipes/cookbooks to this login email "
        "(first Google login with it then owns them — see claim_ownership)",
    )
    parser.add_argument(
        "--claim-from",
        metavar="EMAIL",
        default="staging-admin@example.test",
        help="Owner email to move rows away from (default: the synthetic staging-admin)",
    )
    args = parser.parse_args()

    # Resolve before seed() chdirs into Backend/.
    from_json = os.path.abspath(args.from_json) if args.from_json else None
    if from_json and not os.path.isfile(from_json):
        parser.error(f"--from-json path does not exist: {from_json}")

    print("=== Staging Data Seeder ===")
    print(f"Backend dir: {BACKEND_DIR}")
    print(f"DATABASE_URL: {os.environ.get('DATABASE_URL', '(not set, will use default)')}")
    print("")

    seed(dry_run=args.dry_run, from_json=from_json, claim_email=args.claim_email, claim_from=args.claim_from)


if __name__ == "__main__":
    main()
