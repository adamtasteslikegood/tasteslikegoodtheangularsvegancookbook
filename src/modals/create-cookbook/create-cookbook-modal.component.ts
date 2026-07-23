import { Component, inject, model, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PersistenceService } from '../../services/persistence.service';

@Component({
  selector: 'app-create-cookbook-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './create-cookbook-modal.component.html',
})
export class CreateCookbookModalComponent {
  private readonly persistenceService = inject(PersistenceService);

  isOpen = model<boolean>(false);
  readonly cookbookCreated = output<string>();
  readonly closed = output<void>();

  newCookbookName = signal('');
  newCookbookDesc = signal('');
  isCreatingCookbook = signal<boolean>(false);

  open() {
    this.newCookbookName.set('');
    this.newCookbookDesc.set('');
    this.isOpen.set(true);
  }

  close() {
    this.isOpen.set(false);
    this.closed.emit();
  }

  async create() {
    if (!this.newCookbookName().trim()) return;
    if (this.isCreatingCookbook()) return;
    this.isCreatingCookbook.set(true);
    try {
      const cookbookId = await this.persistenceService.createCookbook(
        this.newCookbookName(),
        this.newCookbookDesc()
      );
      if (!cookbookId) return;
      this.cookbookCreated.emit(cookbookId);
      this.isOpen.set(false);
    } finally {
      this.isCreatingCookbook.set(false);
    }
  }
}
