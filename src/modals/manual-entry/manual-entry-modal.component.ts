import { Component, inject, model, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PersistenceService } from '../../services/persistence.service';
import type { Ingredient, IngredientGroup, Recipe } from '../../recipe.types';

@Component({
  selector: 'app-manual-entry-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manual-entry-modal.component.html',
})
export class ManualEntryModalComponent {
  private readonly persistenceService = inject(PersistenceService);

  isOpen = model<boolean>(false);
  readonly closed = output<void>();

  manualStep = signal<number>(1);
  manualRecipe = signal({
    name: '',
    description: '',
    prepTime: 15,
    cookTime: 30,
    servings: 4,
    notes: '',
    tags: '',
  });

  manualIngredients = signal<
    { name: string; amount: number; units: string; type: 'wet' | 'dry' | 'other' }[]
  >([]);
  newIngredient = signal({
    name: '',
    amount: 1,
    units: '',
    type: 'dry' as 'wet' | 'dry' | 'other',
  });

  manualInstructions = signal<string[]>([]);
  newInstruction = signal('');

  open() {
    this.manualStep.set(1);
    this.manualRecipe.set({
      name: '',
      description: '',
      prepTime: 15,
      cookTime: 30,
      servings: 4,
      notes: '',
      tags: '',
    });
    this.manualIngredients.set([]);
    this.manualInstructions.set([]);
    this.resetDrafts();
    this.isOpen.set(true);
  }

  close() {
    this.resetDrafts();
    this.isOpen.set(false);
    this.closed.emit();
  }

  private resetDrafts() {
    this.newIngredient.set({ name: '', amount: 1, units: '', type: 'dry' });
    this.newInstruction.set('');
  }

  nextStep() {
    if (this.manualStep() === 2) {
      this.addIngredient();
    }
    this.manualStep.update((s) => s + 1);
  }

  prevStep() {
    this.manualStep.update((s) => s - 1);
  }

  addIngredient() {
    const ing = this.newIngredient();
    if (!ing.name.trim()) return;
    this.manualIngredients.update((list) => [...list, { ...ing }]);
    this.newIngredient.set({ name: '', amount: 1, units: '', type: 'dry' });
  }

  removeIngredient(index: number) {
    this.manualIngredients.update((list) => list.filter((_, i) => i !== index));
  }

  addInstruction() {
    const txt = this.newInstruction();
    if (!txt.trim()) return;
    this.manualInstructions.update((list) => [...list, txt]);
    this.newInstruction.set('');
  }

  removeInstruction(index: number) {
    this.manualInstructions.update((list) => list.filter((_, i) => i !== index));
  }

  async save() {
    this.addIngredient();
    this.addInstruction();

    const info = this.manualRecipe();
    const ingredients: IngredientGroup = { wet: [], dry: [], other: [] };

    this.manualIngredients().forEach((ing) => {
      const formatted: Ingredient = { name: ing.name, amount: ing.amount, units: ing.units };
      if (ing.type === 'wet') ingredients.wet!.push(formatted);
      else if (ing.type === 'dry') ingredients.dry!.push(formatted);
      else ingredients.other!.push(formatted);
    });

    const newRecipe: Recipe = {
      id: crypto.randomUUID(),
      name: info.name,
      description: info.description,
      prepTime: info.prepTime,
      cookTime: info.cookTime,
      servings: info.servings,
      ingredients,
      instructions: this.manualInstructions(),
      notes: info.notes,
      tags: info.tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t),
      image_keywords: [info.name, 'homemade'],
    };

    await this.persistenceService.saveRecipe(newRecipe);
    this.close();
  }
}
