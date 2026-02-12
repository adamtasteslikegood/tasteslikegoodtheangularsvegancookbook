import { Recipe } from './recipe.types';

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
  isGuest?: boolean;
  savedRecipes: Recipe[];
  cookbooks: Cookbook[];
}
