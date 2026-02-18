import express from "express";
import { GoogleGenAI, Type } from "@google/genai";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number.parseInt(process.env.PORT || "8080", 10);

app.use(express.json({ limit: "15mb" }));

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
  res.status(200).json({ status: "ok" });
});

app.post("/api/recipe", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) {
      res.status(400).json({ error: "Missing prompt." });
      return;
    }

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
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.post("/api/image", async (req, res) => {
  try {
    const keywords = Array.isArray(req.body?.keywords)
      ? (req.body.keywords as string[])
      : [];
    const recipeName = String(req.body?.recipeName || "").trim();

    if (!recipeName || keywords.length === 0) {
      res.status(400).json({ error: "Missing keywords or recipeName." });
      return;
    }

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
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "..", "..", "dist");

app.use(express.static(distPath));

app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
