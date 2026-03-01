<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1w9LViQc2JzP_kEmp0tyb5CpuqaiKD-bT

## Run Locally

**Prerequisites:** Node.js, Python 3.9+

### Frontend & Express Server

1. Install dependencies:
   `npm install`
2. Set your API key in the environment for the backend server:
   - `VITE_GEMINI_API_KEY=...` (preferred)
   - `VITE_API_KEY=...` (fallback)
3. Build the app and backend:
   `npm run build`
4. Start the server (serves the UI + /api endpoints):
   `npm start`

### Flask Backend (Phase 3 - Database Support)

The Flask backend provides Google OAuth authentication and database-backed recipe storage.

**This project uses `uv` for Python dependency management** - it's significantly faster than pip and handles virtual environments automatically.

1. Install uv (if not already installed):
   ```sh
   curl -LsSf https://astral.sh/uv/install.sh | sh
   # Or on Arch: yay -S uv
   ```

2. Set up Python environment:
   ```sh
   cd Backend
   uv sync  # Installs all dependencies, creates .venv automatically
   ```

3. Configure environment variables (copy `.env.example` to `.env`):
   ```sh
   cp .env.example .env
   # Edit .env and set:
   # - GOOGLE_API_KEY (for Gemini)
   # - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (for OAuth)
   # - DATABASE_URL (optional, defaults to SQLite)
   ```

4. Initialize database (Phase 3):
   ```sh
   ./init_database.sh
   # OR manually:
   export FLASK_APP=app.py
   uv run flask db init
   uv run flask db migrate -m "Initial schema"
   uv run flask db upgrade
   ```

5. Start Flask backend:
   ```sh
   uv run python app.py
   ```
   The backend runs on `http://localhost:5000`

For detailed database setup, see [`Backend/DATABASE_SETUP.md`](Backend/DATABASE_SETUP.md).  
For uv usage guide, see [`Backend/UV_QUICK_REFERENCE.md`](Backend/UV_QUICK_REFERENCE.md).

### Full Stack Development

Run both servers simultaneously:
- **Angular dev server**: `ng serve` (port 3000)
- **Express server**: `npm run dev` (port 8080)
- **Flask backend**: `cd Backend && python app.py` (port 5000)

The Angular dev server proxies `/api/auth/*` requests to Flask (see `proxy.conf.json`).

## Docker (optional)

Build and run a production container locally:

```sh
docker build -t vegangenius-chef .
docker run --rm -p 8080:8080 \
  -e VITE_GEMINI_API_KEY=your_key_here \
  vegangenius-chef
```

## Cloud Build (optional)

A sample `cloudbuild.yaml` is included for building and deploying to Cloud Run. Update the substitutions at the top of the file to match your project, service name, and region.

## Contributing

See `CONTRIBUTING.md` for setup notes and workflow.

## License

This project is licensed under the MIT License. See `LICENSE`.