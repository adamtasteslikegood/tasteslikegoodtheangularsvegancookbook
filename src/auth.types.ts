import { Recipe } from "./recipe.types";

export type AuthProvider = "google" | "guest";

export interface Cookbook {
  id: string;
  name: string;
  description: string;
  recipeIds: string[];
  coverImage?: string;
}

export interface User {
  id: string;
  email?: string;
  name: string;
  picture?: string;
  isGuest?: boolean;
  authProvider?: AuthProvider;
  savedRecipes: Recipe[];
  cookbooks: Cookbook[];
}
