import { createCustomElement } from '@angular/elements';
import { BrowserModule } from '@angular/platform-browser';
import { DoBootstrap, ErrorHandler, Injector, NgModule, ProviderToken, Type } from '@angular/core';
import { bootstrapCrtModule, CrtModule } from '@creatio-devkit/common';
import { HpKanbanBoardComponent } from './view-elements/board/board.component';
import { HpKanbanBoardPanelComponent } from './view-elements/board-panel/board-panel.component';

/** Silences NG0909 only: the shell drives the remote outside Angular's zone. */
class ZoneCompatErrorHandler implements ErrorHandler {
	handleError(err: unknown): void {
		if (err instanceof Error && err.message.includes('NG0909')) {
			return;
		}
		console.error(err);
	}
}

@CrtModule({
	viewElements: [HpKanbanBoardComponent, HpKanbanBoardPanelComponent],
})
@NgModule({
	declarations: [],
	imports: [BrowserModule, HpKanbanBoardComponent, HpKanbanBoardPanelComponent],
	providers: [{ provide: ErrorHandler, useClass: ZoneCompatErrorHandler }],
})
export class AppModule implements DoBootstrap {
	constructor(private _injector: Injector) {}

	ngDoBootstrap(): void {
		// The custom element names must match the @CrtViewElement selectors.
		this._define('hp-kanban-board', HpKanbanBoardComponent);
		this._define('hp-kanban-board-panel', HpKanbanBoardPanelComponent);

		// 'hp_kanban' = webpack name = folder under Files/src/js/.
		bootstrapCrtModule('hp_kanban', AppModule, {
			resolveDependency: (token) => this._injector.get(<ProviderToken<unknown>>token),
		});
	}

	private _define(selector: string, component: Type<unknown>): void {
		if (!customElements.get(selector)) {
			customElements.define(selector, createCustomElement(component, { injector: this._injector }));
		}
	}
}
