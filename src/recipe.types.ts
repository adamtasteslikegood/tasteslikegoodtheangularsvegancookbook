export interface Ingredient {
  name: string;
  amount: number | number[];
  units: string;
  notes?: string;
}

export interface IngredientGroup {
  wet?: Ingredient[];
  dry?: Ingredient[];
  other?: Ingredient[];
  [key: string]: Ingredient[] | undefined;
}

export interface InstructionStep {
  step: number;
  description: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  prepTime: number;
  cookTime: number;
  servings: number;
  ingredients: IngredientGroup;
  instructions: (string | InstructionStep)[];
  notes?: string;
  tags?: string[];
  image_keywords?: string[];
  stock_image_url?: string;
  ai_image_url?: string;
  user_id?: string;
  image?: string;
}
