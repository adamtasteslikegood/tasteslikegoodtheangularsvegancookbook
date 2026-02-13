import { Injectable } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';
import { Recipe } from '../recipe.types';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env['API_KEY']! });
  }

  async generateRecipe(userPrompt: string): Promise<Recipe> {
    const schema = {
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
                  notes: { type: Type.STRING }
                },
                required: ["name", "amount", "units"]
              }
            },
            dry: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  amount: { type: Type.NUMBER },
                  units: { type: Type.STRING },
                  notes: { type: Type.STRING }
                },
                required: ["name", "amount", "units"]
              }
            },
            other: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  amount: { type: Type.NUMBER },
                  units: { type: Type.STRING },
                  notes: { type: Type.STRING }
                },
                required: ["name", "amount", "units"]
              }
            }
          },
          required: ["wet", "dry"]
        },
        instructions: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
        notes: { type: Type.STRING },
        tags: { type: Type.ARRAY, items: { type: Type.STRING } },
        image_keywords: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ["name", "description", "prepTime", "cookTime", "servings", "ingredients", "instructions", "image_keywords"]
    } as any;

    const systemPrompt = `
      You are a world-class vegan chef. Generate a creative, delicious vegan recipe based on the user's request.
      Follow the JSON schema strictly.
      For the 'instructions', provide a simple array of strings describing the steps in order.
      For 'image_keywords', provide 3-5 visual keywords that describe the finished dish for an image generator (e.g., 'golden crust', 'rustic wooden table', 'steam rising').
    `;

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    });

    if (response.text) {
      const recipe = JSON.parse(response.text) as Recipe;
      recipe.id = crypto.randomUUID(); // Assign a client-side ID
      return recipe;
    }
    throw new Error('No recipe generated');
  }

  async generateImage(keywords: string[], recipeName: string): Promise<string> {
    const prompt = `Professional food photography of ${recipeName}. ${keywords.join(', ')}. High resolution, photorealistic, natural lighting, overhead shot, delicious plating.`;
    
    const response = await this.ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '4:3',
        outputMimeType: 'image/jpeg'
      }
    });

    const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
    if (imageBytes) {
      return `data:image/jpeg;base64,${imageBytes}`;
    }
    throw new Error('No image generated');
  }
}