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
"""

import argparse
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

# Add Backend to the path so we can import the app
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
BACKEND_DIR = os.path.join(REPO_ROOT, "Backend")
sys.path.insert(0, BACKEND_DIR)


def make_recipe_data(name, description="A delicious vegan recipe.", servings=4):
    """Build a minimal recipe data dict matching the production schema."""
    slug = name.lower().replace(" ", "-").replace("'", "")
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


def seed(dry_run=False):
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
            recipe_id = str(uuid.uuid4())
            user_id = created_users[r["owner_idx"]].id if r["owner_idx"] is not None and not dry_run else None
            data = make_recipe_data(r["name"])

            if dry_run:
                owner_label = USERS[r["owner_idx"]]["email"] if r["owner_idx"] is not None else "guest"
                print(f"  [DRY RUN] Would create recipe: {r['name']} (owner={owner_label}, public={r['is_public']})")
                created_recipe_ids.append(recipe_id)
                continue

            # slug_override lets a row (e.g. a saved copy) opt out of the
            # slug-from-name default and store NULL, avoiding a collision with
            # the source recipe's globally-unique slug.
            slug = r["slug_override"] if "slug_override" in r else data["slug"]
            source_slug = r.get("source_slug")
            guest_session_id = r.get("guest_session_id")

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
            # Check if cookbook already exists
            existing_cb = Cookbook.query.filter_by(user_id=created_users[0].id).first()
            if existing_cb:
                print(f"  Cookbook already exists for user {created_users[0].email}")
            else:
                # Cookbook with recipe_ids (JSON list, matching production schema)
                public_ids = [
                    created_recipe_ids[i]
                    for i, r in enumerate(RECIPES)
                    if r["owner_idx"] == 0 and r["status"] == "complete"
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

        if not dry_run:
            db.session.commit()
            print(f"\nSeeded: {len(USERS)} users, {len(RECIPES)} recipes, 1 cookbook")
        else:
            print(f"\n[DRY RUN] Would seed: {len(USERS)} users, {len(RECIPES)} recipes, 1 cookbook")


def main():
    parser = argparse.ArgumentParser(description="Seed staging database with test data")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be created without writing to DB")
    args = parser.parse_args()

    print("=== Staging Data Seeder ===")
    print(f"Backend dir: {BACKEND_DIR}")
    print(f"DATABASE_URL: {os.environ.get('DATABASE_URL', '(not set, will use default)')}")
    print("")

    seed(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
