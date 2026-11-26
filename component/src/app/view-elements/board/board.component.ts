import {
	ChangeDetectorRef, Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
	ComparisonType, CrtInput, CrtInterfaceDesignerItem, CrtOutput, CrtViewElement, FilterGroup, HandlerChainService, Model,
	ModelParameterType, SysValuesService,
} from '@creatio-devkit/common';
import {
	Card, CardFilter, CardValue, COLORS, DEFAULT_STAGES, formatTotal, formatValue, groupByStage, isSortMode, matchesFilter,
	moveCard, nextPosition, normalizeEntities, normalizeObjectSettings, normalizeStages, ObjectSettings, sortCards, SortMode,
	Stage, sumCards, toNumber, toSortableDate, VALUE_TYPES, daysInStage, formatAge, markStale, wipState, WipState,
	lookupId, missingRequired, reconcileStages, autoAddTargets, autoAddValues, cardIdFor, POSITION_STEP, stageForStatus, stableId,
	statusToWrite, totalOf, normalizeTotalMode, TotalMode, dueStateOf, normalizeDueSoonDays, iconUrl,
	hasActiveFilter, Lane, laneKey, lanesOf, normalizeRefresh, normalizeSwimlanes, parseStoredFilters, StoredFilters,
	SwimlaneMode, formatShortDateTime, applyToggles, FilterToggles, hasUnowned, normalizeFilterToggles, OwnerChoice, OwnerOption, ownerOptions,
} from '../../board-logic';
import { BOARD_ICON } from './board.icon';

const CARD_SCHEMA = 'hpKanbanCard';
const MOVE_SCHEMA = 'hpKanbanCardMove';
const HISTORY_LIMIT = 10;
// shortcut: one board loads at most this many cards and filters them on the client; add server-side paging past that.
const MAX_CARDS = 1000;
const SEARCH_LIMIT = 20;
const BULK_LIMIT = 100;

/** DataService answers a refused write (rights, business rule, required column, duplicate key) with success: false
 * instead of an error, and sdk.Model passes that on: turn it into an exception so callers roll back. */
function saved<T>(result: T): T {
	const r = result as { success?: boolean; responseStatus?: { Message?: string }; errorInfo?: unknown } | null;
	if (r?.success === false) {
		// sdk.Model gives the platform's message as `errorInfo` text (DataSourceSaveResult); raw DataService as responseStatus.
		const info = r.errorInfo as { message?: unknown } | string | undefined;
		const text = typeof info === 'string' ? info : typeof info?.message === 'string' ? info.message : r.responseStatus?.Message;
		throw new Error(text || '');
	}
	return result;
}

/** Runs `fn` over the items, `size` at a time: parallel enough for slow sites, without flooding the server. */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
	for (let i = 0; i < items.length; i += size) {
		await Promise.all(items.slice(i, i + size).map(fn));
	}
}

const PARALLEL = 6;
/** Cards rendered per column (or lane cell) before "Show more". */
const SHOW_STEP = 50;
const LOAD_ERROR = 'Cannot load the board.';
const TOTAL_LABELS: Record<TotalMode, string> = { sum: 'Σ', avg: 'avg', min: 'min', max: 'max' };
/** shortcut: auto-add creates at most this many cards per load (sequential inserts), the rest come with the next loads. */
const AUTO_LIMIT = 100;

interface Lookup { value: string; displayValue: string }

interface EntityInfo {
	name: string;
	caption: string;
	displayColumn: string;
	hasOwner: boolean;
	/** Column name -> caption and DataValueType, from getSchema(). */
	columns: Map<string, { caption: string; dataValueType: number }>;
}

interface CardRow {
	Id: string;
	hpStageCode: string;
	hpEntityName: string;
	hpRecordId: string;
	hpPosition: number | null;
	hpStageChangedOn: Date | string | null;
	CreatedOn: Date | string | null;
}

interface HistoryRow {
	when: string;
	who: string;
	from: string;
	to: string;
}

interface SearchHit {
	id: string;
	title: string;
	onBoard: boolean;
}

@Component({
	selector: 'hp-kanban-board',
	templateUrl: './board.component.html',
	styleUrls: ['./board.component.scss'],
	standalone: true,
	imports: [CommonModule],
	encapsulation: ViewEncapsulation.ShadowDom,
})
@CrtViewElement({
	selector: 'hp-kanban-board',
	type: 'hp.KanbanBoard',
})
@CrtInterfaceDesignerItem({
	toolbarConfig: {
		caption: 'Kanban board',
		icon: BOARD_ICON,
		hint: 'Cards of Tasks, Accounts and other records moved through your own stages',
		defaultPropertyValues: {
			boardTitle: 'Kanban board',
			stages: DEFAULT_STAGES as unknown as Record<string, unknown>[],
			entities: ['Activity'],
			height: '600px',
		},
	},
	propertiesPanel: 'hp.KanbanBoardPanel',
})
export class HpKanbanBoardComponent implements OnChanges, OnDestroy {
	/** Identity of the board in hpKanbanCard.hpBoardCode; the properties panel writes a new one on the first open. */
	@Input() @CrtInput()
	boardCode: string = '';

	@Input() @CrtInput()
	boardTitle: string = 'Kanban board';

	/** [{ id, caption }] in display order (a JSON string or plain strings are accepted too). */
	@Input() @CrtInput()
	stages: unknown = DEFAULT_STAGES;

	/** Entity schema names whose records may be put on the board. */
	@Input() @CrtInput()
	entities: unknown = ['Activity'];

	@Input() @CrtInput()
	height: string = '600px';

	/** Which filter controls show: { search, object, owner, stale, sort }; each defaults to true. */
	@Input() @CrtInput()
	filters: unknown = {};

	/** Swimlanes: 'none' | 'owner' | 'object'. */
	@Input() @CrtInput()
	swimlanes: unknown = 'none';

	/** Quiet reload interval in seconds while the board is visible; 0 = off. */
	@Input() @CrtInput()
	refreshSeconds: unknown = 30;

	/** Per object: { fields: string[≤4], sumField, color }. Missing or invalid -> plain cards, as before. */
	@Input() @CrtInput()
	objectSettings: unknown = {};

	/** Column total: 'sum' | 'avg' | 'min' | 'max' of the objects' total fields. */
	@Input() @CrtInput()
	totalMode: unknown = 'sum';

	/** A card is "due soon" this many days before its due date (0 = only overdue is flagged). */
	@Input() @CrtInput()
	dueSoonDays: unknown = 3;

	/** Optional page binding; the element opens records itself through crt.UpdateRecordRequest. */
	@Output() @CrtOutput()
	openRecord = new EventEmitter<{ entityName: string; recordId: string }>();

	stageList: Stage[] = DEFAULT_STAGES;
	entityInfos: EntityInfo[] = [];
	columns = new Map<string, Card[]>();
	filter: CardFilter = { text: '', entityName: '', ownerId: null };
	ownerChoice: OwnerChoice = 'any';
	toggles: FilterToggles = normalizeFilterToggles(undefined);
	sortMode: SortMode = 'manual';
	settings: Record<string, ObjectSettings> = {};
	loading = false;
	error = '';
	cardCount = 0;

	addOpen = false;
	addEntity = '';
	addStage = '';
	addQuery = '';
	addHits: SearchHit[] = [];
	addSearching = false;
	addMessage = '';

	draggedId: string | null = null;
	dropStage: string | null = null;
	collapsed = new Set<string>();
	/** Card id -> its last moves, while its History is open. */
	history = new Map<string, HistoryRow[] | 'loading' | 'error'>();
	/** Announced to screen readers when a stage goes over its limit. */
	wipNotice = '';
	swimlaneMode: SwimlaneMode = 'none';
	/** A refresh in progress: no dimming, so the board does not flicker every interval. */
	quiet = false;
	addHitsCapped = false;
	addBulkRunning = false;
	/** The record an error is about (shows an "Open record" button next to the message). */
	errorRecord: { entityName: string; recordId: string } | null = null;
	/** Title-only cards; remembered per board in this browser. */
	compact = false;
	/** Card whose ⋯ menu is open, and where the menu is drawn (fixed: no column can clip it). */
	menuCardId: string | null = null;
	menuPos: { top: number; left: number } | null = null;
	/** In manual order: the card a dragged card would land above (null = end of the column). */
	dropBeforeId: string | null = null;
	/** Cards shown per column / lane cell (key `stage` or `stage|lane`); more come with "Show more". */
	shown = new Map<string, number>();

	private _infos = new Map<string, EntityInfo>();
	private _onBoard = new Set<string>();
	private _myContactId: string | null = null;
	private _reloadTimer?: ReturnType<typeof setTimeout>;
	private _searchTimer?: ReturnType<typeof setTimeout>;
	private _searchSeq = 0;
	private _loadSeq = 0;
	/** Cards whose stage change is still being written: shown in the new stage, locked until the save ends. */
	private _saving = new Set<string>();
	private _toastTimer?: ReturnType<typeof setTimeout>;
	private _refreshTimer?: ReturnType<typeof setInterval>;
	private _lastLoad = 0;
	private _restoredFiltersFor: string | null = null;
	private readonly _onVisible = (): void => {
		const seconds = normalizeRefresh(this.refreshSeconds);
		if (document.visibilityState === 'visible' && seconds && Date.now() - this._lastLoad > seconds * 1000) {
			void this._autoRefresh();
		}
	};
	private _subscriptions: Array<{ unsubscribe?: () => void }> = [];
	private _destroyed = false;

	/** A fixed menu would float away from its card when anything scrolls: close it instead. */
	private readonly _onAnyScroll = (): void => this.closeMenu();

	constructor(private _cdr: ChangeDetectorRef) {
		document.addEventListener('scroll', this._onAnyScroll, true);
	}

	ngOnChanges(changes: SimpleChanges): void {
		this._debug('changes', Object.keys(changes), 'stages', JSON.stringify(this.stages)?.slice(0, 80));
		// Several inputs arrive together: reload once.
		clearTimeout(this._reloadTimer);
		this._reloadTimer = setTimeout(() => void this.reload(), 0);
		this.swimlaneMode = normalizeSwimlanes(this.swimlanes);
		this.toggles = normalizeFilterToggles(this.filters);
		this._startRefresh();
	}

	ngOnDestroy(): void {
		this._destroyed = true;
		clearTimeout(this._reloadTimer);
		clearTimeout(this._searchTimer);
		clearInterval(this._refreshTimer);
		document.removeEventListener('visibilitychange', this._onVisible);
		document.removeEventListener('scroll', this._onAnyScroll, true);
		this._subscriptions.forEach((s) => s.unsubscribe?.());
	}

	// ---- team board: lanes, refresh, remembered filters -----------------------------------------------------

	/** Lanes of the visible cards (all stages). */
	lanes(): Lane[] {
		const cards = [...this.columns.values()].flat().filter((c) => matchesFilter(c, this.filter));
		return lanesOf(cards, this.swimlaneMode, (name) => this.entityCaption(name));
	}

	cellCards(stageId: string, lane: string): Card[] {
		return this.visible(stageId).filter((c) => laneKey(c, this.swimlaneMode) === lane);
	}

	gridColumns(): string {
		return this.stageList.map((s) => (this.isCollapsed(s.id) ? '44px' : 'minmax(240px, 1fr)')).join(' ');
	}

	filtersActive(): boolean {
		return hasActiveFilter(this._currentFilters());
	}

	async clearFilters(): Promise<void> {
		await this._setFilters({ text: '', entityName: '', owner: 'any', staleOnly: false, dueOnly: false, sortMode: 'manual' });
		this._saveFilters();
		this._render();
	}

	/** Owners of the cards on the board, plus the chosen one if it no longer has cards (so the list still shows it). */
	owners(): OwnerOption[] {
		const list = ownerOptions([...this.columns.values()].flat());
		const chosen = this.ownerChoice;
		if (chosen !== 'any' && chosen !== 'me' && chosen !== 'none' && !list.some((o) => o.id === chosen)) {
			list.push({ id: chosen, name: 'Selected owner (no cards)' });
		}
		return list;
	}

	unowned(): boolean {
		return hasUnowned([...this.columns.values()].flat()) || this.ownerChoice === 'none';
	}

	async onOwner(event: Event): Promise<void> {
		await this._setFilters({ ...this._currentFilters(), owner: (event.target as HTMLSelectElement).value });
		this._saveFilters();
		this._render();
	}

	/** Applies a full filter state; "me" is resolved to the current user's contact. */
	private async _setFilters(f: StoredFilters): Promise<void> {
		let ownerId: string | null = null;
		if (f.owner === 'none') {
			ownerId = '';
		} else if (f.owner === 'me') {
			// No contact known: an impossible id hides every card rather than showing all.
			ownerId = (await this._myContact()) ?? '-';
		} else if (f.owner !== 'any') {
			ownerId = f.owner;
		}
		this.ownerChoice = f.owner;
		this.sortMode = f.sortMode;
		this.filter = { text: f.text, entityName: f.entityName, ownerId, staleOnly: f.staleOnly, dueOnly: f.dueOnly };
	}

	// shortcut: polling with a full quiet reload; a server push (MessageChannelService) needs a C# listener - upgrade
	// when boards get many viewers or 30 s is too slow.
	private _startRefresh(): void {
		clearInterval(this._refreshTimer);
		document.removeEventListener('visibilitychange', this._onVisible);
		const seconds = normalizeRefresh(this.refreshSeconds);
		if (seconds) {
			this._refreshTimer = setInterval(() => void this._autoRefresh(), seconds * 1000);
			document.addEventListener('visibilitychange', this._onVisible);
		}
	}

	/** A quiet reload, skipped while the user is in the middle of something or the page is hidden. */
	private async _autoRefresh(): Promise<void> {
		if (document.visibilityState !== 'visible' || this.loading || this.draggedId || this.addOpen
			|| this.addBulkRunning || this._saving.size || !this.configured) {
			return;
		}
		await this._quietReload();
	}

	/** Reload without dimming the board or closing a message the user has not read yet. */
	private async _quietReload(): Promise<void> {
		this.quiet = true;
		try {
			await this.reload();
		} finally {
			this.quiet = false;
			this._render();
		}
	}

	private _currentFilters(): StoredFilters {
		return {
			text: this.filter.text,
			entityName: this.filter.entityName,
			owner: this.ownerChoice,
			staleOnly: !!this.filter.staleOnly,
			dueOnly: !!this.filter.dueOnly,
			sortMode: this.sortMode,
		};
	}

	private _filtersKey(): string {
		return `hpKanban.filters.${this.boardCode}`;
	}

	private _saveFilters(): void {
		try {
			const value = this._currentFilters();
			if (hasActiveFilter(value)) {
				localStorage.setItem(this._filtersKey(), JSON.stringify(value));
			} else {
				localStorage.removeItem(this._filtersKey());
			}
		} catch {
			// Storage blocked: filters work for this page view only.
		}
	}

	/** Once per board: the filters this user left on it in this browser. */
	private async _restoreFilters(): Promise<void> {
		if (this._restoredFiltersFor === this.boardCode) {
			return;
		}
		this._restoredFiltersFor = this.boardCode;
		let stored: StoredFilters;
		try {
			stored = parseStoredFilters(localStorage.getItem(this._filtersKey()));
		} catch {
			return;
		}
		await this._setFilters(stored);
	}

	private async _myContact(): Promise<string | null> {
		if (!this._myContactId) {
			try {
				const values = await new SysValuesService().loadSysValues();
				this._myContactId = values.userContact?.value ?? null;
			} catch (e) {
				console.error('hp-kanban-board: cannot read the current user', e);
			}
		}
		return this._myContactId;
	}

	get configured(): boolean {
		return !!this.boardCode?.trim();
	}

	visible(stageId: string): Card[] {
		return sortCards((this.columns.get(stageId) ?? []).filter((c) => matchesFilter(c, this.filter)), this.sortMode);
	}

	/** "Σ 1,234" (or "avg / min / max …") over the visible cards of the column; '' when no card there has a total. */
	columnTotal(stageId: string): string {
		const mode = normalizeTotalMode(this.totalMode);
		const total = totalOf(this.visible(stageId), mode);
		return total === null ? '' : `${TOTAL_LABELS[mode]} ${formatTotal(total)}`;
	}

	/** CSS mask of a Creatio icon (drawn in the text colour); null when the card item has none. */
	iconMask(name: string | undefined): string | null {
		const url = iconUrl(name, location.pathname);
		return url ? `url("${url}")` : null;
	}

	/** The card's items in layout order; compact cards keep only a due date that needs attention. */
	shownItems(card: Card): CardValue[] {
		const values = card.values ?? [];
		return this.compact
			? values.filter((v) => v.style === 'due' && (card.dueState === 'overdue' || card.dueState === 'soon'))
			: values;
	}

	/** The due filter only makes sense when an object on the board has a due date field. */
	hasDueField(): boolean {
		return Object.values(this.settings).some((o) => !!o.dueField);
	}

	onDueOnly(event: Event): void {
		this.filter = { ...this.filter, dueOnly: (event.target as HTMLInputElement).checked };
		this._saveFilters();
		this._render();
	}

	toggleCompact(): void {
		this.compact = !this.compact;
		try {
			if (this.compact) {
				localStorage.setItem(this._compactKey(), '1');
			} else {
				localStorage.removeItem(this._compactKey());
			}
		} catch {
			// Storage blocked: compact mode works for this page view only.
		}
		this._render();
	}

	private _compactKey(): string {
		return `hpKanban.compact.${this.boardCode}`;
	}

	wip(stage: Stage): WipState {
		return wipState(this.columns.get(stage.id)?.length ?? 0, stage.wipLimit);
	}

	age(card: Card): string {
		return formatAge(daysInStage(card.stageSince, Date.now()));
	}

	isCollapsed(stageId: string): boolean {
		return this.collapsed.has(stageId);
	}

	toggleCollapsed(stageId: string): void {
		if (!this.collapsed.delete(stageId)) {
			this.collapsed.add(stageId);
		}
		try {
			localStorage.setItem(this._collapseKey(), JSON.stringify([...this.collapsed]));
		} catch {
			// Storage blocked (private window, policy): collapsing still works for this page view.
		}
		this._render();
	}

	onStaleOnly(event: Event): void {
		this.filter = { ...this.filter, staleOnly: (event.target as HTMLInputElement).checked };
		this._saveFilters();
		this._render();
	}

	stageColor(stage: Stage): string | null {
		return stage.color ? COLORS[stage.color] ?? null : null;
	}

	cardColor(card: Card): string | null {
		const key = this.settings[card.entityName]?.color;
		return key ? COLORS[key] ?? null : null;
	}

	onSort(event: Event): void {
		const value = (event.target as HTMLSelectElement).value;
		this.sortMode = isSortMode(value) ? value : 'manual';
		this._saveFilters();
		this._render();
	}

	entityCaption(name: string): string {
		return this._infos.get(name)?.caption ?? name;
	}

	trackCard(_: number, card: Card): string {
		return card.id;
	}

	async reload(): Promise<void> {
		// Inputs arrive in several steps, so loads overlap: only the latest one may apply its result.
		const seq = ++this._loadSeq;
		const stageList = normalizeStages(this.stages);
		this._debug('reload', seq, 'stages', stageList.map((st) => st.caption).join('/'), 'entities', JSON.stringify(this.entities));
		if (!this.quiet || this.error === LOAD_ERROR) {
			this.error = '';
			this.errorRecord = null;
		}
		if (!this.configured) {
			this.stageList = stageList;
			this.columns = groupByStage([], stageList);
			this._render();
			return;
		}
		this.loading = true;
		this._render();
		try {
			await this._restoreFilters();
			const allowedFilters = applyToggles(this._currentFilters(), this.toggles);
			if (JSON.stringify(allowedFilters) !== JSON.stringify(this._currentFilters())) {
				await this._setFilters(allowedFilters);
				this._saveFilters();
			}
			const allowed = normalizeEntities(this.entities);
			const settings = normalizeObjectSettings(this.objectSettings, allowed);
			const infos = (await Promise.all(allowed.map((name) => this._entityInfo(name))))
				.filter((info): info is EntityInfo => !!info);
			const rows = await this._loadCardRows();
			rows.push(...await this._autoAdd(infos, rows, stageList, settings));
			const cards: Card[] = [];
			for (const info of infos) {
				cards.push(...await this._cardsOf(info, rows.filter((r) => r.hpEntityName === info.name), settings));
			}
			if (seq !== this._loadSeq) {
				this._debug('reload', seq, 'superseded');
				return; // a newer load is running with newer inputs
			}
			this._debug('reload', seq, 'applied', infos.length, 'objects', cards.length, 'cards');
			// The record is the truth: a status changed elsewhere moves its card to the mapped stage.
			// `since` is read before it is overwritten: every board that sees this change computes the same history Id.
			const synced = reconcileStages(cards, stageList).map((s) => ({ ...s, since: s.card.stageSince ?? '' }));
			const now = new Date();
			synced.forEach(({ card }) => (card.stageSince = now.toISOString()));
			markStale(cards, stageList, now.getTime());
			this.stageList = stageList;
			this.settings = settings;
			this.entityInfos = infos;
			this._onBoard = new Set(rows.map((r) => this._key(r.hpEntityName, r.hpRecordId)));
			this.columns = groupByStage(cards, stageList);
			this.cardCount = cards.length;
			this._restoreCollapsed();
			try {
				this.compact = this.toggles.compact && localStorage.getItem(this._compactKey()) === '1';
			} catch {
				this.compact = false;
			}
			if (!infos.some((i) => i.name === this.filter.entityName)) {
				this.filter = { ...this.filter, entityName: '' };
			}
			void this._saveSynced(synced, now);
			this._lastLoad = Date.now();
		} catch (e) {
			if (seq === this._loadSeq) {
				console.error('hp-kanban-board: cannot load the board', e);
				this.error = LOAD_ERROR;
			}
		} finally {
			if (seq === this._loadSeq) {
				this.loading = false;
				this._render();
			}
		}
	}

	// ---- filters -------------------------------------------------------------------------------------------

	onSearch(event: Event): void {
		this.filter = { ...this.filter, text: (event.target as HTMLInputElement).value };
		this._saveFilters();
		this._render();
	}

	onEntityFilter(event: Event): void {
		this.filter = { ...this.filter, entityName: (event.target as HTMLSelectElement).value };
		this._saveFilters();
		this._render();
	}

	// ---- move ----------------------------------------------------------------------------------------------

	onDragStart(event: DragEvent, card: Card): void {
		this.draggedId = card.id;
		event.dataTransfer?.setData('text/plain', card.id);
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	onDragEnd(): void {
		this.draggedId = null;
		this.dropStage = null;
		this.dropBeforeId = null;
		this._render();
	}

	/** Over a card (manual order): the line shows above that card; over the empty part of a column: at its end. */
	onDragOver(event: DragEvent, stageId: string, overCard?: Card): void {
		if (!this.draggedId) {
			return;
		}
		event.preventDefault();
		if (overCard) {
			event.stopPropagation(); // the column's own handler would reset the line to the end
		}
		const before = this.sortMode === 'manual' && overCard && overCard.id !== this.draggedId ? overCard.id : null;
		if (this.dropStage !== stageId || this.dropBeforeId !== before) {
			this.dropStage = stageId;
			this.dropBeforeId = before;
			this._render();
		}
	}

	/** Dropped on a card: insert before it; dropped on the column: append. */
	async onDrop(event: DragEvent, stageId: string, beforeCard?: Card): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		const id = this.draggedId ?? event.dataTransfer?.getData('text/plain') ?? '';
		this.draggedId = null;
		this.dropStage = null;
		this.dropBeforeId = null;
		if (!id || id === beforeCard?.id) {
			this._render();
			return;
		}
		const column = this.columns.get(stageId) ?? [];
		// In a sorted view the screen order is not the stored order: a drop there only changes the stage.
		if (this.sortMode !== 'manual') {
			if (column.some((c) => c.id === id)) {
				this._render();
				return;
			}
			beforeCard = undefined;
		}
		let index = beforeCard ? column.findIndex((c) => c.id === beforeCard!.id) : column.length;
		const from = column.findIndex((c) => c.id === id);
		if (from >= 0 && from < index) {
			index--; // the card leaves its old slot above the target first
		}
		await this._move(id, stageId, index < 0 ? column.length : index);
	}

	/** Stage next to the card's column (-1 left, +1 right), or undefined at the edge. */
	neighbour(stageId: string, delta: number): Stage | undefined {
		return this.stageList[this.stageList.findIndex((s) => s.id === stageId) + delta];
	}

	/** Keyboard alternative to drag and drop: buttons, not a <select> (arrow keys on a closed select fire change). */
	async step(card: Card, stageId: string, delta: number): Promise<void> {
		const target = this.neighbour(stageId, delta);
		if (target) {
			await this._move(card.id, target.id, Number.MAX_SAFE_INTEGER);
		}
	}

	isSaving(card: Card): boolean {
		return this._saving.has(card.id);
	}

	/** Its object's cards may not be moved (setting per object). */
	isLocked(card: Card): boolean {
		return !!this.settings[card.entityName]?.locked;
	}

	/**
	 * Why × is not available: auto-add would put the card back on the next load while the record keeps its value.
	 * '' when the card can be removed.
	 */
	autoKept(card: Card): string {
		const stage = stageForStatus(this.stageList, card.entityName, card.statusId);
		if (!stage?.autoAdd?.[card.entityName]) {
			return '';
		}
		const column = this.settings[card.entityName]?.statusColumn ?? '';
		const field = this._infos.get(card.entityName)?.columns.get(column)?.caption ?? column;
		return `Added automatically: every ${this.entityCaption(card.entityName)} with this ${field} goes to "${stage.caption}". `
			+ `Change the ${field} or switch off auto-add to take it off the board.`;
	}

	// ---- card menu ---------------------------------------------------------------------------------------------

	toggleMenu(card: Card, event: Event): void {
		event.stopPropagation();
		const toggle = event.currentTarget as HTMLElement;
		this.menuCardId = this.menuCardId === card.id ? null : card.id;
		this.menuPos = null;
		this._render();
		const menu = toggle.parentElement?.querySelector<HTMLElement>('.menu');
		if (this.menuCardId && menu) {
			// Below the ⋯ button, right edges aligned; kept inside the window, above the button when there is no room below.
			const r = toggle.getBoundingClientRect();
			const width = menu.offsetWidth;
			const height = menu.offsetHeight;
			this.menuPos = {
				left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
				top: r.bottom + 2 + height > window.innerHeight - 8 ? Math.max(8, r.top - 2 - height) : r.bottom + 2,
			};
			this._render();
			menu.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus(); // as in any menu
		}
	}

	closeMenu(): void {
		if (this.menuCardId) {
			this.menuCardId = null;
			this._render();
		}
	}

	/** The scrolling box a card sits in: its column, or the lanes grid. Read before the menu closes. */
	scrollBoxOf(event: Event): HTMLElement | null {
		return (event.target as HTMLElement).closest('.column-body, .lanes');
	}

	scrollToBottom(box: HTMLElement | null): void {
		box?.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
	}

	/** Runs a menu action and closes the menu, focus back on its ⋯ button. */
	async menuAction(event: Event, action: () => Promise<void> | void): Promise<void> {
		event.stopPropagation();
		this._closeMenu(event);
		await action();
	}

	/** Arrow keys walk the items, Escape and Tab close the menu. */
	onMenuKey(event: KeyboardEvent): void {
		const items = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])'));
		const index = items.indexOf(event.target as HTMLElement);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
		} else if (event.key === 'Escape' || event.key === 'Tab') {
			this._closeMenu(event);
		}
	}

	private _closeMenu(event: Event): void {
		const toggle = (event.target as HTMLElement).closest('.card-menu')?.querySelector<HTMLElement>('.menu-toggle');
		this.menuCardId = null;
		this._render();
		toggle?.focus();
	}

	/** A click anywhere else closes the open menu (clicks inside the menu stop before reaching the document). */
	@HostListener('document:click')
	onDocumentClick(): void {
		this.closeMenu();
	}

	/** The first cards of a list; the rest come with "Show more". */
	limited(list: Card[], key: string): Card[] {
		return list.slice(0, this.shown.get(key) ?? SHOW_STEP);
	}

	hiddenCount(list: Card[], key: string): number {
		return Math.max(0, list.length - (this.shown.get(key) ?? SHOW_STEP));
	}

	showMore(key: string): void {
		this.shown.set(key, (this.shown.get(key) ?? SHOW_STEP) + SHOW_STEP);
		this._render();
	}

	/** Manual order: one place up (-1) or down (+1) among the cards shown with it (keyboard alternative to drag). */
	async shift(card: Card, stageId: string, delta: number): Promise<void> {
		const list = this._listOf(card, stageId);
		const neighbour = list[list.indexOf(card) + delta];
		if (neighbour) {
			await this._move(card.id, stageId, (this.columns.get(stageId) ?? []).indexOf(neighbour));
		}
	}

	private _listOf(card: Card, stageId: string): Card[] {
		return this.swimlaneMode === 'none' ? this.visible(stageId) : this.cellCards(stageId, laneKey(card, this.swimlaneMode));
	}

	/**
	 * The card moves on screen at once; the record (required fields, mapped status) and the card row are written
	 * afterwards. When any of that fails the card goes back to where it was and the reason is shown.
	 */
	private async _move(cardId: string, stageId: string, index: number): Promise<void> {
		if (this._saving.has(cardId)) {
			return;
		}
		const all = [...this.columns.values()].flat();
		const moving = all.find((c) => c.id === cardId);
		if (moving && this.isLocked(moving)) {
			return; // a dropped or keyboard-moved card of a locked object stays where it is
		}
		const fromCode = moving?.stageCode ?? '';
		// What a refusal must restore: stage and position before the move (a renumbered column included).
		const snapshot = new Map(all.map((c) => [c.id, { stageCode: c.stageCode, position: c.position }]));
		const before = moving && { stageSince: moving.stageSince, stale: moving.stale, statusId: moving.statusId };
		const changed = moveCard(this.columns, cardId, stageId, index);
		const stageChanged = !!moving && fromCode !== moving.stageCode;
		const now = new Date();
		if (stageChanged) {
			moving.stageSince = now.toISOString();
			markStale([moving], this.stageList, now.getTime());
			this._saving.add(cardId);
		}
		this._announceWip(stageId);
		this._render();
		if (!changed.length) {
			this._saving.delete(cardId);
			return;
		}
		let statusWritten = false;
		try {
			if (stageChanged) {
				const blocked = await this._enterStage(moving.entityName, moving.recordId, stageId, moving.statusId);
				if (blocked) {
					// Only the cards this move changed: others may have been moved meanwhile.
					changed.forEach((c) => Object.assign(c, snapshot.get(c.id)));
					Object.assign(moving, before);
					this.columns = groupByStage([...this.columns.values()].flat(), this.stageList);
					this._showError(blocked, moving);
					return;
				}
				const status = this._statusFor(moving.entityName, stageId, moving.statusId);
				statusWritten = !!status;
				moving.statusId = status ?? moving.statusId;
			}
			const model = await Model.create(CARD_SCHEMA);
			await inBatches(changed, PARALLEL, async (card) => {
				const dto: Record<string, unknown> = { hpStageCode: card.stageCode, hpPosition: card.position };
				if (stageChanged && card === moving) {
					dto['hpStageChangedOn'] = now; // a reorder inside a stage keeps the age
				}
				saved(await model.update(dto as never, [{ type: ModelParameterType.PrimaryColumnValue, value: card.id }]));
			});
			if (stageChanged) {
				await this._writeHistory(moving, fromCode, moving.stageCode);
			}
		} catch (e) {
			console.error('hp-kanban-board: cannot save the move', e);
			this._saving.delete(cardId);
			await this.reload();
			this._showError('The card could not be moved. The board was reloaded.');
			return;
		} finally {
			this._saving.delete(cardId);
			this._render();
		}
		if (statusWritten && !this._saving.size) {
			await this._quietReload(); // the record changed: its fields on the card (and totals) are refreshed
		}
	}

	// ---- record sync / rules ---------------------------------------------------------------------------------

	/** The value entering the stage writes to the record (none: "don't change", or it already has one of the stage's values). */
	private _statusFor(entityName: string, stageId: string, current: string | null | undefined): string | undefined {
		const column = this.settings[entityName]?.statusColumn;
		return column ? statusToWrite(this.stageList.find((s) => s.id === stageId), entityName, current) : undefined;
	}

	/**
	 * Everything that must hold before a record's card enters a stage: its required fields are filled, then the mapped
	 * status is written to the record. Returns the message to show when the card may not enter, or null.
	 * `current` is the record's value of the status field; undefined = not known yet (Add card): it is read when the
	 * stage has several values, since a record that already has one of them is left alone.
	 */
	private async _enterStage(entityName: string, recordId: string, stageId: string,
		current?: string | null): Promise<string | null> {
		const stage = this.stageList.find((s) => s.id === stageId);
		const info = this._infos.get(entityName);
		const column = this.settings[entityName]?.statusColumn;
		const required = (stage?.requiredFields?.[entityName] ?? []).filter((f) => info?.columns.has(f));
		const readStatus = !!column && current === undefined && (stage?.statusValues?.[entityName]?.length ?? 0) > 1;
		if (stage && (required.length || readStatus)) {
			try {
				const model = await Model.create(entityName);
				const filters = new FilterGroup();
				filters.addSchemaColumnFilterWithParameter(ComparisonType.Equal, 'Id', recordId);
				const rows = await model.load({
					attributes: ['Id', ...required, ...(readStatus ? [column!] : [])],
					parameters: [{ type: ModelParameterType.Filter, value: filters }],
				} as never) as unknown as Array<Record<string, unknown>>;
				const missing = missingRequired({ ...stage, requiredFields: { [entityName]: required } }, entityName, rows[0] ?? {});
				if (missing.length) {
					const names = missing.map((f) => info?.columns.get(f)?.caption ?? f).join(', ');
					return `Fill ${names} first: "${stage.caption}" requires it.`;
				}
				if (readStatus) {
					current = lookupId(rows[0]?.[column!]);
				}
			} catch (e) {
				console.error('hp-kanban-board: cannot check the required fields', e);
				return 'The required fields could not be checked.';
			}
		}
		const status = this._statusFor(entityName, stageId, current);
		if (status && column) {
			try {
				const model = await Model.create(entityName);
				saved(await model.update({ [column]: { value: status, displayValue: '' } } as never,
					[{ type: ModelParameterType.PrimaryColumnValue, value: recordId }]));
			} catch (e) {
				console.error('hp-kanban-board: the record rejected the status change', e);
				const reason = this._errorText(e);
				const field = info?.columns.get(column)?.caption ?? column;
				return `"${stage?.caption ?? stageId}" changes ${field}, and Creatio refused it: `
					+ (reason || `no reason was given (check your edit rights and the rules of ${info?.caption ?? entityName}).`);
			}
		}
		return null;
	}

	/** Saves cards moved by the record-wins sync; a failure is logged and fixed by the next load. */
	private async _saveSynced(synced: Array<{ card: Card; fromCode: string; since: string }>, now: Date): Promise<void> {
		if (!synced.length) {
			return;
		}
		try {
			const model = await Model.create(CARD_SCHEMA);
			await inBatches(synced, PARALLEL, async ({ card, fromCode, since }) => {
				saved(await model.update({ hpStageCode: card.stageCode, hpPosition: card.position, hpStageChangedOn: now } as never,
					[{ type: ModelParameterType.PrimaryColumnValue, value: card.id }]));
				// Every open board runs this sync. The history Id depends only on the change itself, so exactly one row is
				// written (and processes listening for card moves start once); the other boards hit the primary key.
				await this._writeHistory(card, fromCode, card.stageCode, stableId('sync', card.id, fromCode, card.stageCode, since));
			});
		} catch (e) {
			console.error('hp-kanban-board: cannot save the status sync', e);
		}
	}

	/** Shown as a toast; one without an "Open record" action goes away by itself after 8 s. */
	private _showError(message: string, record?: { entityName: string; recordId: string }): void {
		this.error = message;
		this.errorRecord = record ? { entityName: record.entityName, recordId: record.recordId } : null;
		clearTimeout(this._toastTimer);
		if (!record) {
			this._toastTimer = setTimeout(() => this.error === message && this.dismissError(), 8000);
		}
		this._render();
	}

	openErrorRecord(): void {
		if (this.errorRecord) {
			void this.open({ ...this.errorRecord } as Card);
		}
	}

	dismissError(): void {
		this.error = '';
		this.errorRecord = null;
		this._render();
	}

	/** Message of a platform error (business rule, rights) when it has one. */
	private _errorText(e: unknown): string {
		const any = e as { message?: unknown; error?: { message?: unknown }; errorInfo?: { message?: unknown } } | null;
		const text = any?.errorInfo?.message ?? any?.error?.message ?? any?.message;
		// The first paragraph is the reason; database errors add a technical DETAIL block after a blank line.
		return typeof text === 'string' ? text.split(/\r?\n\s*\r?\n/)[0].trim().slice(0, 300) : '';
	}

	// ---- history -------------------------------------------------------------------------------------------

	historyOf(card: Card): HistoryRow[] | 'loading' | 'error' | undefined {
		return this.history.get(card.id);
	}

	async toggleHistory(card: Card): Promise<void> {
		if (this.history.delete(card.id)) {
			this._render();
			return;
		}
		this.history.set(card.id, 'loading');
		this._render();
		try {
			const model = await Model.create(MOVE_SCHEMA);
			const filters = new FilterGroup();
			filters.addSchemaColumnFilterWithParameter(ComparisonType.Equal, 'hpBoardCode', this.boardCode);
			filters.addSchemaColumnFilterWithParameter(ComparisonType.Equal, 'hpEntityName', card.entityName);
			filters.addSchemaColumnFilterWithParameter(ComparisonType.Equal, 'hpRecordId', card.recordId);
			const rows = await model.load({
				attributes: ['Id', 'CreatedOn', 'CreatedBy', 'hpFromStageCaption', 'hpToStageCaption'],
				parameters: [{ type: ModelParameterType.Filter, value: filters }],
				options: {
					pagingConfig: { rowCount: HISTORY_LIMIT, rowsOffset: 0 },
					sortingConfig: { columns: [{ columnName: 'CreatedOn', direction: 'desc' }] },
				},
			} as never) as unknown as Array<Record<string, unknown>>;
			this.history.set(card.id, rows.slice(0, HISTORY_LIMIT).map((r) => ({
				when: formatShortDateTime(r['CreatedOn']),
				who: this._text(r['CreatedBy']),
				from: this._text(r['hpFromStageCaption']),
				to: this._text(r['hpToStageCaption']),
			})));
		} catch (e) {
			console.error('hp-kanban-board: cannot load the history', e);
			this.history.set(card.id, 'error');
		}
		this._render();
	}

	/** One history row per stage change (or add). A failure is logged and never undoes the move. */
	private async _writeHistory(card: { entityName: string; recordId: string }, fromCode: string, toCode: string,
		id?: string): Promise<void> {
		const caption = (code: string) => this.stageList.find((s) => s.id === code)?.caption ?? code;
		try {
			const model = await Model.create(MOVE_SCHEMA);
			saved(await model.insert({
				...(id ? { Id: id } : {}),
				hpBoardCode: this.boardCode,
				hpEntityName: card.entityName,
				hpRecordId: card.recordId,
				hpFromStageCode: fromCode,
				hpToStageCode: toCode,
				hpFromStageCaption: fromCode ? caption(fromCode) : '',
				hpToStageCaption: caption(toCode),
			}));
		} catch (e) {
			if (id) {
				this._debug('history row already written by another board', id); // expected, see _saveSynced
			} else {
				console.error('hp-kanban-board: cannot write the move history', e);
			}
		}
	}

	private _announceWip(stageId: string): void {
		const stage = this.stageList.find((s) => s.id === stageId);
		const count = this.columns.get(stageId)?.length ?? 0;
		this.wipNotice = stage && wipState(count, stage.wipLimit) === 'over'
			? `${stage.caption} is over its limit: ${count} of ${stage.wipLimit}.` : '';
	}

	private _collapseKey(): string {
		return `hpKanban.collapsed.${this.boardCode}`;
	}

	private _restoreCollapsed(): void {
		try {
			const saved = JSON.parse(localStorage.getItem(this._collapseKey()) ?? '[]');
			this.collapsed = new Set(Array.isArray(saved) ? saved.filter((id) => this.stageList.some((s) => s.id === id)) : []);
		} catch {
			this.collapsed = new Set();
		}
	}

	// ---- remove / open -------------------------------------------------------------------------------------

	async removeCard(card: Card): Promise<void> {
		if (this.autoKept(card) || this._saving.has(card.id)) {
			return;
		}
		try {
			const model = await Model.create(CARD_SCHEMA);
			saved(await model.delete([{ type: ModelParameterType.PrimaryColumnValue, value: card.id }]));
			const column = this.columns.get(card.stageCode) ?? [...this.columns.values()].find((c) => c.includes(card));
			column?.splice(column.indexOf(card), 1);
			this._onBoard.delete(this._key(card.entityName, card.recordId));
			this.cardCount--;
		} catch (e) {
			console.error('hp-kanban-board: cannot remove the card', e);
			this._showError('The card could not be removed.');
		}
		this._render();
	}

	async open(card: Card, event?: Event): Promise<void> {
		event?.preventDefault();
		this.openRecord.emit({ entityName: card.entityName, recordId: card.recordId });
		try {
			// shortcut: the element has no view model. On 10.1 crt.UpdateRecordHandler reads only
			// `$context._subscriptions.add(...)` (it watches for the card closing), so a stand-in collects those
			// subscriptions and drops them on destroy. Re-check this if a platform update breaks "open record".
			await HandlerChainService.instance.process({
				type: 'crt.UpdateRecordRequest',
				entityName: card.entityName,
				recordId: card.recordId,
				$context: { _subscriptions: { add: (s: { unsubscribe?: () => void }) => this._subscriptions.push(s) } },
			} as never);
		} catch (e) {
			console.error('hp-kanban-board: cannot open the record', e);
			this._showError('The record could not be opened.');
		}
	}

	// ---- add -----------------------------------------------------------------------------------------------

	/** From the toolbar (first stage) or a column's "+" (that stage). */
	openAdd(stageId?: string): void {
		this.addOpen = true;
		this.addEntity = this.entityInfos[0]?.name ?? '';
		this.addStage = stageId ?? this.stageList[0]?.id ?? '';
		this.addQuery = '';
		this.addHits = [];
		this.addMessage = '';
		this._render();
	}

	closeAdd(): void {
		this.addOpen = false;
		this._render();
	}

	onAddEntity(event: Event): void {
		this.addEntity = (event.target as HTMLSelectElement).value;
		this._scheduleSearch();
	}

	onAddStage(event: Event): void {
		this.addStage = (event.target as HTMLSelectElement).value;
	}

	onAddQuery(event: Event): void {
		this.addQuery = (event.target as HTMLInputElement).value;
		this._scheduleSearch();
	}

	async addCard(hit: SearchHit): Promise<void> {
		if (hit.onBoard || !this.addEntity || !this.addStage) {
			return;
		}
		if (this._onBoard.has(this._key(this.addEntity, hit.id))) {
			hit.onBoard = true;
			this._render();
			return;
		}
		const blocked = await this._enterStage(this.addEntity, hit.id, this.addStage);
		if (blocked) {
			this.addMessage = blocked;
			this._render();
			return;
		}
		try {
			const row = await this._insertCard(this.addEntity, hit.id, this.addStage, nextPosition(this.columns.get(this.addStage)));
			hit.onBoard = true;
			this.addMessage = `Added "${hit.title}".`;
			// Only the new card is read, not the whole board.
			const info = this._infos.get(this.addEntity);
			const [card] = info ? await this._cardsOf(info, [row], this.settings) : [];
			if (card && !this.columns.get(card.stageCode)?.some((c) => c.id === card.id)) {
				markStale([card], this.stageList, Date.now());
				this.columns.get(card.stageCode)?.push(card);
				this.cardCount++;
			}
			this._render();
		} catch (e) {
			console.error('hp-kanban-board: cannot add the card', e);
			this.addMessage = 'The card could not be added.';
			this._render();
		}
	}

	private _scheduleSearch(): void {
		clearTimeout(this._searchTimer);
		this.addHits = [];
		this.addMessage = '';
		this._render();
		if (this.addQuery.trim().length < 2) {
			return;
		}
		this._searchTimer = setTimeout(() => void this._search(), 300);
	}

	private async _search(): Promise<void> {
		const info = this._infos.get(this.addEntity);
		if (!info) {
			return;
		}
		const seq = ++this._searchSeq;
		this.addSearching = true;
		this._render();
		try {
			// One more than shown tells whether "Add all" may find more than the list.
			const hits = await this._findRecords(info, this.addQuery.trim(), SEARCH_LIMIT + 1);
			if (seq !== this._searchSeq) {
				return; // a newer search is running
			}
			this.addHitsCapped = hits.length > SEARCH_LIMIT;
			this.addHits = hits.slice(0, SEARCH_LIMIT);
			this.addMessage = this.addHits.length ? '' : 'Nothing found.';
		} catch (e) {
			console.error('hp-kanban-board: search failed', e);
			this.addMessage = 'Search failed.';
		} finally {
			if (seq === this._searchSeq) {
				this.addSearching = false;
				this._render();
			}
		}
	}

	/** Records of the object whose display column contains `query`, sorted by it, at most `limit`. */
	private async _findRecords(info: EntityInfo, query: string, limit: number): Promise<SearchHit[]> {
		const model = await Model.create(info.name);
		const filters = new FilterGroup();
		filters.addSchemaColumnFilterWithParameter(ComparisonType.Contain, info.displayColumn, query);
		const rows = await model.load({
			attributes: ['Id', info.displayColumn],
			parameters: [{ type: ModelParameterType.Filter, value: filters }],
			options: {
				pagingConfig: { rowCount: limit, rowsOffset: 0 },
				sortingConfig: { columns: [{ columnName: info.displayColumn, direction: 'asc' }] },
			},
		} as never) as unknown as Array<Record<string, unknown>>;
		return rows.slice(0, limit).map((row) => ({
			id: String(row['Id']),
			title: this._text(row[info.displayColumn]) || '(no name)',
			onBoard: this._onBoard.has(this._key(info.name, String(row['Id']))),
		}));
	}

	/** Hits in the list not yet on the board. */
	newHits(): number {
		return this.addHits.filter((h) => !h.onBoard).length;
	}

	/** Every record the search finds (up to BULK_LIMIT) into the chosen stage, each through the stage's rules. */
	async addAll(): Promise<void> {
		const info = this._infos.get(this.addEntity);
		if (!info || !this.addStage || this.addBulkRunning) {
			return;
		}
		this.addBulkRunning = true;
		this.addMessage = 'Adding…';
		this._render();
		let added = 0;
		let skipped = 0;
		let refused = 0;
		let firstRefusal = '';
		try {
			const hits = await this._findRecords(info, this.addQuery.trim(), BULK_LIMIT);
			const fresh = hits.filter((hit) => !this._onBoard.has(this._key(info.name, hit.id)));
			skipped = hits.length - fresh.length;
			let position = nextPosition(this.columns.get(this.addStage));
			const stage = this.addStage;
			await inBatches(fresh.map((hit) => ({ hit, position: (position += POSITION_STEP) })), PARALLEL, async ({ hit, position }) => {
				const blocked = await this._enterStage(info.name, hit.id, stage);
				if (blocked) {
					refused++;
					firstRefusal ||= `${hit.title}: ${blocked}`;
					return;
				}
				try {
					await this._insertCard(info.name, hit.id, stage, position);
					added++;
				} catch {
					skipped++; // the same card Id: someone else added it a moment ago
				}
			});
		} catch (e) {
			console.error('hp-kanban-board: bulk add stopped', e);
			firstRefusal ||= 'The rest could not be added.';
		} finally {
			this.addBulkRunning = false;
		}
		this.addMessage = `Added ${added}, ${skipped} already on board` + (refused ? `, ${refused} refused (${firstRefusal})` : '')
			+ (!refused && firstRefusal ? `. ${firstRefusal}` : '.');
		this.addHits = this.addHits.map((h) => ({ ...h, onBoard: this._onBoard.has(this._key(info.name, h.id)) }));
		await this.reload();
	}

	// ---- data ----------------------------------------------------------------------------------------------

	private async _entityInfo(name: string): Promise<EntityInfo | null> {
		const cached = this._infos.get(name);
		if (cached) {
			return cached;
		}
		try {
			const schema = await (await Model.create(name)).getSchema();
			const attributes = schema.attributes ?? [];
			const info: EntityInfo = {
				name,
				caption: this._text(schema.caption) || name,
				displayColumn: schema.primaryDisplayAttributeName || 'Id',
				hasOwner: attributes.some((a) => a.name === 'Owner'),
				columns: new Map(attributes.map((a) => [a.name, {
					caption: this._text(a.caption) || a.name, dataValueType: Number(a.dataValueType),
				}])),
			};
			this._infos.set(name, info);
			return info;
		} catch (e) {
			console.warn(`hp-kanban-board: object "${name}" is not available and is skipped`, e);
			return null;
		}
	}

	/**
	 * One card row plus its history row. The Id comes from board + object + record, so the same record added twice at
	 * the same moment (two users, auto-add) fails on the primary key instead of making a second card.
	 */
	private async _insertCard(entityName: string, recordId: string, stageCode: string, position: number): Promise<CardRow> {
		const now = new Date();
		const row: CardRow = {
			Id: cardIdFor(this.boardCode, entityName, recordId), hpStageCode: stageCode, hpEntityName: entityName,
			hpRecordId: recordId, hpPosition: position, hpStageChangedOn: now, CreatedOn: now,
		};
		const model = await Model.create(CARD_SCHEMA);
		const { CreatedOn: _, ...dto } = { ...row, hpBoardCode: this.boardCode }; // CreatedOn is set by the platform
		saved(await model.insert(dto as never));
		this._onBoard.add(this._key(entityName, recordId));
		await this._writeHistory({ entityName, recordId }, '', stageCode);
		return row;
	}

	/**
	 * Records whose mapped field value has "auto-add" on its stage get a card there. The card Id is derived from the
	 * record, so a second viewer adding the same record at the same moment fails on the key and skips it.
	 * Required fields do not apply: the record is the truth, as for the status sync. A failure never stops the load.
	 */
	private async _autoAdd(infos: EntityInfo[], rows: CardRow[], stages: Stage[],
		settings: Record<string, ObjectSettings>): Promise<CardRow[]> {
		const added: CardRow[] = [];
		for (const info of infos) {
			const column = settings[info.name]?.statusColumn;
			const values = autoAddValues(stages, info.name);
			if (!column || !values.length || info.columns.get(column)?.dataValueType !== VALUE_TYPES.lookup
				|| rows.length + added.length >= MAX_CARDS) {
				continue;
			}
			try {
				const filters = new FilterGroup();
				filters.addSchemaColumnInFilterWithParameters(ComparisonType.Equal, column, values);
				const records = await (await Model.create(info.name)).load({
					attributes: ['Id', column],
					parameters: [{ type: ModelParameterType.Filter, value: filters }],
					options: { pagingConfig: { rowCount: MAX_CARDS, rowsOffset: 0 } },
				} as never) as unknown as Array<Record<string, unknown>>;
				const onBoard = new Set(rows.filter((r) => r.hpEntityName === info.name).map((r) => String(r.hpRecordId).toLowerCase()));
				const targets = autoAddTargets(stages, info.name,
					records.map((r) => ({ id: String(r['Id']), statusId: lookupId(r[column]) })), onBoard,
					Math.min(AUTO_LIMIT - added.length, MAX_CARDS - rows.length - added.length));
				const next = new Map<string, number>();
				const planned = targets.map((t) => {
					const position = next.get(t.stageCode) ?? nextPosition([...rows, ...added]
						.filter((r) => r.hpStageCode === t.stageCode).map((r) => ({ position: r.hpPosition ?? 0 })));
					next.set(t.stageCode, position + POSITION_STEP);
					return { ...t, position };
				});
				await inBatches(planned, PARALLEL, async (t) => {
					try {
						added.push(await this._insertCard(info.name, t.recordId, t.stageCode, t.position));
					} catch (e) {
						console.warn('hp-kanban-board: auto-add skipped (added by someone else, or no rights)', t.recordId, e);
					}
				});
			} catch (e) {
				console.error(`hp-kanban-board: auto-add for "${info.name}" stopped`, e);
			}
		}
		return added;
	}

	private async _loadCardRows(): Promise<CardRow[]> {
		const model = await Model.create(CARD_SCHEMA);
		const filters = new FilterGroup();
		filters.addSchemaColumnFilterWithParameter(ComparisonType.Equal, 'hpBoardCode', this.boardCode);
		const rows = await model.load({
			attributes: ['Id', 'hpStageCode', 'hpEntityName', 'hpRecordId', 'hpPosition', 'hpStageChangedOn', 'CreatedOn'],
			parameters: [{ type: ModelParameterType.Filter, value: filters }],
			options: { pagingConfig: { rowCount: MAX_CARDS, rowsOffset: 0 } },
		} as never) as unknown as CardRow[];
		return rows.slice(0, MAX_CARDS);
	}

	/** Cards whose record no longer exists (or cannot be read) are left out. */
	private async _cardsOf(info: EntityInfo, rows: CardRow[], allSettings: Record<string, ObjectSettings>): Promise<Card[]> {
		if (!rows.length) {
			return [];
		}
		const model = await Model.create(info.name);
		const filters = new FilterGroup();
		filters.addSchemaColumnInFilterWithParameters(ComparisonType.Equal, 'Id', rows.map((r) => r.hpRecordId));
		const settings = allSettings[info.name];
		// Only columns the object still has: a renamed or removed column in the settings is skipped, never an error.
		const layout = (settings?.layout ?? []).filter((item) => {
			const column = info.columns.get(item.field);
			return !!column && !VALUE_TYPES.hidden.has(column.dataValueType);
		});
		const fields = layout.map((item) => item.field);
		const sumColumn = settings?.sumField && VALUE_TYPES.numeric.has(info.columns.get(settings.sumField)?.dataValueType ?? -1)
			? settings.sumField : '';
		const statusColumn = settings?.statusColumn && info.columns.get(settings.statusColumn)?.dataValueType === VALUE_TYPES.lookup
			? settings.statusColumn : '';
		const dueType = settings?.dueField ? info.columns.get(settings.dueField)?.dataValueType : undefined;
		const dueColumn = dueType === VALUE_TYPES.date || dueType === VALUE_TYPES.dateTime ? settings!.dueField : '';
		const now = Date.now();
		const soonDays = settings?.dueSoonDays ?? normalizeDueSoonDays(this.dueSoonDays);
		const attributes = ['Id', info.displayColumn, ...(info.hasOwner ? ['Owner'] : []), ...fields,
			...(sumColumn ? [sumColumn] : []), ...(statusColumn ? [statusColumn] : []), ...(dueColumn ? [dueColumn] : [])];
		const records = await model.load({
			attributes: [...new Set(attributes)],
			parameters: [{ type: ModelParameterType.Filter, value: filters }],
			options: { pagingConfig: { rowCount: rows.length, rowsOffset: 0 } },
		} as never) as unknown as Array<Record<string, unknown>>;
		const byId = new Map(records.map((r) => [String(r['Id']).toLowerCase(), r]));
		const cards: Card[] = [];
		for (const row of rows) {
			const record = byId.get(String(row.hpRecordId).toLowerCase());
			if (!record) {
				continue;
			}
			const owner = record['Owner'] as Lookup | null | undefined;
			cards.push({
				id: row.Id,
				stageCode: row.hpStageCode,
				entityName: info.name,
				recordId: row.hpRecordId,
				position: row.hpPosition ?? 0,
				title: this._text(record[info.displayColumn]) || '(no name)',
				ownerId: owner?.value ?? null,
				ownerName: owner?.displayValue ?? '',
				values: layout
					.map((item): CardValue => ({
						label: info.columns.get(item.field)!.caption,
						text: formatValue(record[item.field], info.columns.get(item.field)!.dataValueType),
						icon: item.icon,
						style: item.style,
					}))
					.filter((v) => v.text),
				sum: sumColumn ? toNumber(record[sumColumn]) : null,
				addedOn: toSortableDate(row.CreatedOn),
				stageSince: toSortableDate(row.hpStageChangedOn) || toSortableDate(row.CreatedOn),
				statusId: statusColumn ? lookupId(record[statusColumn]) : null,
				dueText: dueColumn ? formatValue(record[dueColumn], dueType!) : '',
				dueState: dueColumn ? dueStateOf(record[dueColumn], dueType === VALUE_TYPES.date, now, soonDays) : '',
			});
		}
		return cards;
	}

	private _key(entityName: string, recordId: string): string {
		return `${entityName}|${String(recordId).toLowerCase()}`;
	}

	/** Text of a plain value, a lookup ({ displayValue }) or a localizable caption ({ "en-US": ... }). */
	private _text(value: unknown): string {
		if (value == null) {
			return '';
		}
		if (typeof value === 'object') {
			const v = value as Record<string, unknown>;
			const text = v['displayValue'] ?? v['value'] ?? Object.values(v).find((x) => typeof x === 'string');
			return typeof text === 'string' ? text : '';
		}
		return String(value);
	}

	/** Diagnostics, off unless localStorage "hpKanban.debug" is "1". */
	private _debug(...args: unknown[]): void {
		try {
			if (localStorage.getItem('hpKanban.debug') === '1') {
				console.info('hp-kanban-board[debug]', ...args);
			}
		} catch {
			// storage blocked: no diagnostics
		}
	}

	/** The shell runs the element outside Angular's zone: changes are pushed by hand. */
	private _render(): void {
		if (!this._destroyed) {
			this._cdr.detectChanges();
		}
	}
}
