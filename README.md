<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1w9LViQc2JzP_kEmp0tyb5CpuqaiKD-bT

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set your API key in `.env` or `.env.local`.
   - Preferred: `VITE_GEMINI_API_KEY=...`
   - Also supported: `VITE_API_KEY=...`
   - Note: `GEMINI_API_KEY` without the `VITE_` prefix is not exposed to client code by Vite-based dev servers.
3. Run the app:
   `npm run dev`

## Docker (optional)

Build and run a production container locally:

```sh
docker build -t vegangenius-chef .
docker run --rm -p 8080:8080 vegangenius-chef
```

## Cloud Build (optional)

A sample `cloudbuild.yaml` is included for building and deploying to Cloud Run. Update the substitutions at the top of the file to match your project, service name, and region.

## Contributing

See `CONTRIBUTING.md` for setup notes and workflow.

## License

This project is licensed under the MIT License. See `LICENSE`.