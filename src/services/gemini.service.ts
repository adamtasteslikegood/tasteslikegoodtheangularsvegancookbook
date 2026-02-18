import { Injectable } from "@angular/core";
import { Recipe } from "../recipe.types";

@Injectable({
  providedIn: "root",
})
export class GeminiService {
  constructor() {
    // Lazily initialized so missing env doesn't crash app bootstrap.
  }

  async generateRecipe(userPrompt: string): Promise<Recipe> {
    const response = await fetch("/api/recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userPrompt }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Recipe generation failed.");
    }

    const recipe = (await response.json()) as Recipe;
    recipe.id = recipe.id || crypto.randomUUID();
    return recipe;
  }

  async generateImage(keywords: string[], recipeName: string): Promise<string> {
    const response = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords, recipeName }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Image generation failed.");
    }

    const payload = (await response.json()) as { imageDataUrl?: string };
    if (!payload.imageDataUrl) {
      throw new Error("No image generated");
    }

    return payload.imageDataUrl;
  }
}
