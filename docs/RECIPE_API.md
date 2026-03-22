# Recipe API Endpoints - Phase 3

Documentation for the new database-backed recipe API endpoints.

---

## Base URL

- **Development**: `http://localhost:5000/api`
- **Production**: `https://your-app.run.app/api`

---

## Authentication

Most endpoints support both **authenticated** and **guest** users:

- **Authenticated**: Include session cookie (set after OAuth login)
- **Guest**: No authentication required, recipes stored as anonymous (user_id = NULL)

---

## Endpoints

### List Recipes

Get all recipes for the current user (or anonymous recipes for guests).

**Request:**
```http
GET /api/recipes
```

**Response:**
```json
{
  "recipes": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Vegan Pancakes",
      "created_at": "2026-03-01T10:30:00",
      "updated_at": "2026-03-01T10:30:00"
    }
  ],
  "count": 1,
  "user_id": 123
}
```

**Status Codes:**
- `200 OK` - Success
- `500 Internal Server Error` - Database error

---

### Get Recipe by ID

Retrieve a specific recipe. Only returns if the recipe belongs to the current user.

**Request:**
```http
GET /api/recipes/:id
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": 123,
  "name": "Vegan Pancakes",
  "data": {
    "name": "Vegan Pancakes",
    "description": "Fluffy vegan pancakes",
    "prepTime": 10,
    "cookTime": 15,
    "servings": 4,
    "difficulty": "Easy",
    "ingredients": [
      {
        "name": "flour",
        "amount": "2",
        "unit": "cups"
      }
    ],
    "instructions": [
      "Mix dry ingredients",
      "Add wet ingredients",
      "Cook on griddle"
    ],
    "tags": ["breakfast", "vegan"],
    "nutrition": {
      "calories": 250,
      "protein": 6,
      "carbs": 45,
      "fat": 5
    }
  },
  "created_at": "2026-03-01T10:30:00",
  "updated_at": "2026-03-01T10:30:00"
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Recipe doesn't exist or doesn't belong to user
- `500 Internal Server Error` - Database error

---

### Create Recipe

Create a new recipe. Automatically associates with authenticated user or creates as anonymous.

**Request:**
```http
POST /api/recipes
Content-Type: application/json

{
  "name": "Vegan Pancakes",
  "description": "Fluffy vegan pancakes",
  "prepTime": 10,
  "cookTime": 15,
  "servings": 4,
  "difficulty": "Easy",
  "ingredients": [
    {
      "name": "flour",
      "amount": "2",
      "unit": "cups"
    },
    {
      "name": "plant milk",
      "amount": "1.5",
      "unit": "cups"
    }
  ],
  "instructions": [
    "Mix dry ingredients",
    "Add wet ingredients",
    "Cook on griddle until bubbles form",
    "Flip and cook other side"
  ],
  "tags": ["breakfast", "vegan"],
  "nutrition": {
    "calories": 250,
    "protein": 6,
    "carbs": 45,
    "fat": 5
  }
}
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": 123,
  "name": "Vegan Pancakes",
  "data": { ... },
  "created_at": "2026-03-01T10:30:00",
  "updated_at": "2026-03-01T10:30:00"
}
```

**Status Codes:**
- `201 Created` - Recipe created successfully
- `400 Bad Request` - Invalid JSON or missing required fields
- `500 Internal Server Error` - Database error

**Required Fields:**
- `name` (string)

---

### Update Recipe

Update an existing recipe. Only the recipe owner can update.

**Request:**
```http
PUT /api/recipes/:id
Content-Type: application/json

{
  "name": "Updated Recipe Name",
  "ingredients": [ ... ],
  "instructions": [ ... ]
}
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": 123,
  "name": "Updated Recipe Name",
  "data": { ... },
  "created_at": "2026-03-01T10:30:00",
  "updated_at": "2026-03-01T11:45:00"
}
```

**Status Codes:**
- `200 OK` - Recipe updated successfully
- `400 Bad Request` - Invalid JSON
- `404 Not Found` - Recipe doesn't exist or doesn't belong to user
- `500 Internal Server Error` - Database error

---

### Delete Recipe

Delete a recipe. Only the recipe owner can delete.

**Request:**
```http
DELETE /api/recipes/:id
```

**Response:**
```json
{
  "message": "Recipe deleted successfully"
}
```

**Status Codes:**
- `200 OK` - Recipe deleted successfully
- `404 Not Found` - Recipe doesn't exist or doesn't belong to user
- `500 Internal Server Error` - Database error

---

### Recipe Statistics

Get statistics about the current user's recipes.

**Request:**
```http
GET /api/recipes/stats
```

**Response:**
```json
{
  "total_recipes": 42,
  "user_id": 123
}
```

**Status Codes:**
- `200 OK` - Success
- `500 Internal Server Error` - Database error

---

## Authentication Endpoints

### Check Authentication Status

Check if the current session is authenticated.

**Request:**
```http
GET /api/auth/check
```

**Response (Authenticated):**
```json
{
  "authenticated": true,
  "user_id": 123,
  "email": "user@example.com",
  "name": "User Name",
  "picture": "https://..."
}
```

**Response (Guest):**
```json
{
  "authenticated": false,
  "user_id": null
}
```

---

### Get Current User

Get detailed information about the authenticated user.

**Request:**
```http
GET /api/auth/me
```

**Response:**
```json
{
  "id": 123,
  "email": "user@example.com",
  "name": "User Name",
  "google_id": "1234567890",
  "created_at": "2026-01-15T08:00:00",
  "picture": "https://...",
  "authenticated": true
}
```

**Status Codes:**
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated

---

### Logout

Clear the authentication session.

**Request:**
```http
POST /api/auth/logout
```

**Response:**
```json
{
  "message": "Logged out successfully",
  "authenticated": false
}
```

**Status Codes:**
- `200 OK` - Success

---

## System Endpoints

### API Status

Check API health and database connection.

**Request:**
```http
GET /api/status
```

**Response:**
```json
{
  "status": "running",
  "api_key_loaded": true,
  "default_model": "gemini-2.0-flash-exp",
  "database": {
    "status": "connected",
    "error": null
  }
}
```

**Database Status Values:**
- `"connected"` - Database is accessible
- `"error"` - Database connection failed
- `"unknown"` - Database status could not be determined

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "Description of what went wrong"
}
```

**Common Error Codes:**
- `400 Bad Request` - Invalid input data
- `401 Unauthorized` - Authentication required
- `404 Not Found` - Resource doesn't exist
- `500 Internal Server Error` - Server or database error

---

## Recipe Data Schema

### Full Recipe Object

```typescript
interface Recipe {
  id: string;                    // UUID
  user_id: number | null;        // Database user ID (null for anonymous)
  name: string;                  // Recipe name
  data: RecipeData;              // Full recipe details
  created_at: string;            // ISO 8601 timestamp
  updated_at: string;            // ISO 8601 timestamp
}

interface RecipeData {
  name: string;
  description?: string;
  prepTime?: number;             // Minutes
  cookTime?: number;             // Minutes
  servings?: number;
  difficulty?: string;           // "Easy", "Medium", "Hard"
  ingredients: Ingredient[];
  instructions: string[];
  tags?: string[];
  nutrition?: Nutrition;
  image_url?: string;            // AI-generated image
}

interface Ingredient {
  name: string;
  amount?: string;
  unit?: string;
}

interface Nutrition {
  calories?: number;
  protein?: number;              // Grams
  carbs?: number;                // Grams
  fat?: number;                  // Grams
  fiber?: number;                // Grams
}
```

---

## Usage Examples

### Create Recipe (cURL)

```bash
curl -X POST http://localhost:5000/api/recipes \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Vegan Tacos",
    "ingredients": [
      {"name": "black beans", "amount": "1", "unit": "can"},
      {"name": "corn tortillas", "amount": "8", "unit": "pieces"}
    ],
    "instructions": [
      "Heat beans",
      "Warm tortillas",
      "Assemble tacos"
    ]
  }'
```

### List Recipes (JavaScript)

```javascript
async function getRecipes() {
  const response = await fetch('/api/recipes', {
    credentials: 'include'  // Include session cookie
  });
  const data = await response.json();
  console.log(`You have ${data.count} recipes`);
  return data.recipes;
}
```

### Update Recipe (Python)

```python
import requests

response = requests.put(
    'http://localhost:5000/api/recipes/550e8400-e29b-41d4-a716-446655440000',
    json={
        'name': 'Updated Recipe Name',
        'ingredients': [...]
    },
    cookies={'session': 'your-session-cookie'}
)

print(response.json())
```

---

## Migration from File-Based Storage

If you have existing recipes stored as JSON files, use the migration script:

```bash
cd Backend
python scripts/migrate_recipes_to_db.py
```

This will import all `.json` files from `recipes/` into the database.

---

## Notes

- **Session Cookies**: Authentication uses HTTP-only session cookies set by the Flask backend
- **CORS**: The backend allows requests from `localhost:3000` (Angular dev) and `localhost:8080` (production)
- **Anonymous Recipes**: Recipes created without authentication have `user_id = NULL`
- **Ownership**: Users can only view/edit/delete their own recipes (or anonymous recipes for guests)

---

**Last Updated**: March 1, 2026  
**Phase**: 3 (Database Integration)
