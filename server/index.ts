import express from "express";
import { GoogleGenAI, Type } from "@google/genai";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySecurityMiddleware,
  createApiLimiter,
  createExpensiveOperationLimiter,
  createRequestLogger,
  createErrorHandler,
} from "./security.js";
import {
  validateRecipeRequest,
  validateImageRequest,
  handleValidationErrors,
} from "./validation.js";
import { createAuthProxy } from "./proxy.js";

const app = express();
const port = Number.parseInt(process.env.PORT || "8080", 10);
const flaskUrl = process.env.FLASK_BACKEND_URL || "http://localhost:5000";

// ── Auth proxy ──────────────────────────────────────────────────
// Must be mounted BEFORE express.json() so the raw request body
// streams through to Flask without being consumed by the JSON parser.
app.use("/api/auth", createAuthProxy());

// Reduce default JSON payload limit to 50KB for security
app.use(express.json({ limit: "50kb" }));

// Apply security middleware
applySecurityMiddleware(app);

// Request logging
app.use(createRequestLogger());

// General API rate limiter (100 requests per 15 minutes)
const apiLimiter = createApiLimiter(15 * 60 * 1000, 100);
app.use("/api/", apiLimiter);

// Stricter rate limiter for expensive operations (20 requests per hour)
const expensiveOpLimiter = createExpensiveOperationLimiter(60 * 60 * 1000, 20);

let aiClient: GoogleGenAI | null = null;

const getClient = () => {
  if (aiClient) return aiClient;
  const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.VITE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing API key. Set VITE_GEMINI_API_KEY (preferred) or VITE_API_KEY in the service environment.",
    );
  }
  aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
};

const recipeSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    description: { type: Type.STRING },
    prepTime: { type: Type.INTEGER },
    cookTime: { type: Type.INTEGER },
    servings: { type: Type.INTEGER },
    ingredients: {
      type: Type.OBJECT,
      properties: {
        wet: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              units: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
            required: ["name", "amount", "units"],
          },
        },
        dry: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              units: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
            required: ["name", "amount", "units"],
          },
        },
        other: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              units: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
            required: ["name", "amount", "units"],
          },
        },
      },
      required: ["wet", "dry"],
    },
    instructions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    notes: { type: Type.STRING },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    image_keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    "name",
    "description",
    "prepTime",
    "cookTime",
    "servings",
    "ingredients",
    "instructions",
    "image_keywords",
  ],
} as const;

const systemPrompt = `
You are a world-class vegan chef. Generate a creative, delicious vegan recipe based on the user's request.
Follow the JSON schema strictly.
For the 'instructions', provide a simple array of strings describing the steps in order.
For 'image_keywords', provide 3-5 visual keywords that describe the finished dish for an image generator (e.g., 'golden crust', 'rustic wooden table', 'steam rising').
`;

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post(
  "/api/recipe",
  expensiveOpLimiter,
  validateRecipeRequest,
  handleValidationErrors,
  async (req: express.Request, res: express.Response) => {
    try {
      const prompt = req.body.prompt;

      const response = await getClient().models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: recipeSchema,
        },
      });

      if (!response.text) {
        res.status(502).json({ error: "No recipe generated." });
        return;
      }

      const recipe = JSON.parse(response.text) as Record<string, unknown>;
      if (!recipe.id) {
        (recipe as { id: string }).id = randomUUID();
      }

      res.status(200).json(recipe);
    } catch (error) {
      // Log detailed error server-side
      console.error("Recipe generation error:", error);

      // Send generic message to client
      const message =
        "An unexpected error occurred while generating the recipe.";
      res.status(500).json({ error: message });
    }
  },
);

app.post(
  "/api/image",
  expensiveOpLimiter,
  validateImageRequest,
  handleValidationErrors,
  async (req: express.Request, res: express.Response) => {
    try {
      const keywords = req.body.keywords as string[];
      const recipeName = req.body.recipeName as string;

      const prompt = `Professional food photography of ${recipeName}. ${keywords.join(", ")}. High resolution, photorealistic, natural lighting, overhead shot, delicious plating.`;

      const response = await getClient().models.generateImages({
        model: "imagen-4.0-generate-001",
        prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: "4:3",
          outputMimeType: "image/jpeg",
        },
      });

      const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
      if (!imageBytes) {
        res.status(502).json({ error: "No image generated." });
        return;
      }

      res.status(200).json({
        imageDataUrl: `data:image/jpeg;base64,${imageBytes}`,
      });
    } catch (error) {
      // Log detailed error server-side
      console.error("Image generation error:", error);

      // Send generic message to client
      const message =
        "An unexpected error occurred while generating the image.";
      res.status(500).json({ error: message });
    }
  },
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "..", "..", "dist");

app.use(express.static(distPath));

app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// Error handling middleware (must be last)
app.use(createErrorHandler());

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`Auth proxy → ${flaskUrl}`);
});
