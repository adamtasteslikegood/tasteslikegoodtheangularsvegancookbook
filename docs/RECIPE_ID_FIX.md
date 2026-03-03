# Recipe ID Consistency Fix

## Problem

The application was experiencing a **dual-ID issue** where each recipe had two different IDs:

1. **Outer ID** (`Recipe.id`): Database primary key (UUID)
2. **Inner ID** (`Recipe.data.id`): Recipe ID embedded in the JSON data field

### Example of the Problem

```json
{
  "id": "ca55f18a-b0cd-4c92-8059-ca603aac53f1",  // Database UUID
  "name": "Test Soup",
  "data": {
    "id": "test-r-222",  // Different ID in the data!
    "name": "Test Soup",
    "ingredients": [],
    "instructions": []
  },
  "created_at": "2026-03-03T18:45:26.783916",
  "updated_at": "2026-03-03T18:45:26.783924"
}
```

### Root Cause

The Flask backend's `Recipe` model stores:
- `id` as the primary key (string UUID)
- `data` as a JSON blob containing the full recipe (which can include its own `id` field)

When creating recipes:
1. The old code **always generated a new UUID** for the database record
2. It stored the incoming `recipe_data` (which might already have an `id`) without modification
3. This created two different IDs in the same record

## Solution

### Backend Changes

#### 1. `Backend/repositories/db_recipe_repository.py` - `create_recipe()`

**Before:**
```python
recipe_id = str(uuid.uuid4())  # Always generate new UUID
recipe = Recipe(
    id=recipe_id,
    user_id=user_id,
    name=recipe_name,
    data=recipe_data  # May contain a different id!
)
```

**After:**
```python
# Use the id from recipe_data if present, otherwise generate a new UUID
recipe_id = recipe_data.get('id', str(uuid.uuid4()))

# Ensure the id in recipe_data matches the database record id
recipe_data_with_id = {**recipe_data, 'id': recipe_id}

recipe = Recipe(
    id=recipe_id,
    user_id=user_id,
    name=recipe_name,
    data=recipe_data_with_id  # Now contains the consistent id
)
```

#### 2. `Backend/repositories/db_recipe_repository.py` - `update_recipe()`

**Before:**
```python
recipe.data = recipe_data  # May contain wrong id
```

**After:**
```python
# Ensure the id in recipe_data matches the database record id
recipe_data_with_id = {**recipe_data, 'id': recipe_id}
recipe.data = recipe_data_with_id
```

### Frontend Changes

#### `src/services/persistence.service.ts` - `loadFromApi()`

**Before:**
```typescript
const recipes: Recipe[] = (recipesData.recipes ?? []).map(
  (r: { id: string; data: Recipe }) => ({
    ...r.data,
    id: r.id, // Override data.id with DB id
  }),
);
```

**After:**
```typescript
// With the backend fix, data.id and the outer id are now consistent
const recipes: Recipe[] = (recipesData.recipes ?? []).map(
  (r: { id: string; data: Recipe }) => r.data,
);
```

## Migration for Existing Data

A migration script is provided to fix recipes that already exist in the database:

```bash
cd Backend
python scripts/fix_recipe_ids.py
```

This script:
1. Loads all recipes from the database
2. Checks if `Recipe.data.id` matches `Recipe.id`
3. Updates any mismatched recipes to use the database ID consistently
4. Commits the changes

## Verification

After applying the fix, all recipes should have consistent IDs:

```json
{
  "id": "ca55f18a-b0cd-4c92-8059-ca603aac53f1",
  "name": "Test Soup",
  "data": {
    "id": "ca55f18a-b0cd-4c92-8059-ca603aac53f1",  // ✓ Same ID
    "name": "Test Soup",
    "ingredients": [],
    "instructions": []
  },
  "created_at": "2026-03-03T18:45:26.783916",
  "updated_at": "2026-03-03T18:45:26.783924"
}
```

## Benefits

1. **No more dual IDs**: Each recipe has one canonical ID used everywhere
2. **Simpler frontend code**: No need to override or choose between IDs
3. **Better data integrity**: Database primary key matches the recipe's logical ID
4. **Preserves client-generated IDs**: If the client sends an ID (e.g., from localStorage or AI generation), it's preserved
5. **Backward compatible**: Recipes without an ID still get a new UUID generated

## Related Files

- `Backend/repositories/db_recipe_repository.py` - Repository layer (CRUD operations)
- `Backend/models/recipe.py` - Recipe SQLAlchemy model
- `src/services/persistence.service.ts` - Frontend persistence layer
- `src/recipe.types.ts` - TypeScript Recipe interface
- `Backend/scripts/fix_recipe_ids.py` - Migration script for existing data
