The agent hit a model issue — let me answer this directly since I have the full architecture context.

**Best approach: Serve from Express as a static HTML file, registered before the Angular catch-all.**

Here's exactly why and how:

---

### Why Express, not Angular or Flask

- **Not Angular** — building a whole component just for a static legal page adds build complexity and means the policy is inside the SPA bundle (requires JS to render, bad for Google's crawler)
- **Not Flask** — Flask is internal-only (no public access), and `/privacy-policy` is not an `/api/` route so it won't even reach Flask
- **Express** — already serves static files, sits on the public edge, zero additional infrastructure

---

### Implementation — 3 files to touch

**1. Create the HTML file** at `server/public/privacy-policy.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Privacy Policy — Vegangenius Chef</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
        max-width: 800px;
        margin: 2rem auto;
        padding: 0 1rem;
        line-height: 1.6;
        color: #333;
      }
      h1 {
        color: #2d6a4f;
      }
      h2 {
        color: #40916c;
        border-bottom: 1px solid #eee;
        padding-bottom: 0.5rem;
      }
      a {
        color: #2d6a4f;
      }
      footer {
        margin-top: 3rem;
        padding-top: 1rem;
        border-top: 1px solid #eee;
        font-size: 0.85rem;
        color: #666;
      }
    </style>
  </head>
  <body>
    <!-- paste full policy text here as HTML -->
    <a href="/">← Back to Vegangenius Chef</a>
  </body>
</html>
```

**2. Add the route in `server/index.ts`** — must be BEFORE the SPA catch-all `app.get('*', ...)`

```typescript
// Static legal pages — before SPA catch-all
app.get('/privacy-policy', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/privacy-policy.html'));
});
```

Make sure `import path from 'path'` is already in the file (it almost certainly is).

**3. No `cloudbuild.yaml` changes needed** — the Express `Dockerfile` at root just needs to copy `server/public/` into the image. Check that it doesn't explicitly exclude it; if it uses `COPY . .` it will pick it up automatically.

---

### Route ordering in `server/index.ts`

```typescript
// 1. Flask proxy (already first — do NOT move)
app.use('/api', createFlaskProxy(...));

// 2. Static Angular files
app.use(express.static(path.join(__dirname, '../dist')));

// 3. Static legal pages  ← ADD HERE
app.get('/privacy-policy', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/privacy-policy.html'));
});

// 4. SPA catch-all (must stay last)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});
```

---

Want me to implement this now? I can write the HTML file with the full policy content from the Confluence page and add the Express route.
