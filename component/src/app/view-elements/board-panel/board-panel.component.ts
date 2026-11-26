import {
	ChangeDetectionStrategy, ChangeDetectorRef, Component, CUSTOM_ELEMENTS_SCHEMA, Input, signal, ViewEncapsulation, computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComparisonType, CrtInput, CrtViewElement, FilterGroup, Model, ModelParameterType } from '@creatio-devkit/common';
import { PropertyPanel, ViewNodeEditor, ViewNodePropertyValueType } from '@creatio/interface-designer';
import {
	COLORS, MAX_CARD_FIELDS, MAX_REQUIRED_FIELDS, MAX_STAGES, MAX_STATUS_VALUES, newStageId, toLimit, normalizeRefresh, normalizeSwimlanes,
	SwimlaneMode, normalizeEntities, normalizeObjectSettings, normalizeStages,
	ObjectSettings, Stage, VALUE_TYPES, FILTER_KEYS, FilterToggles, normalizeFilterToggles,
	TOTAL_MODES, TotalMode, normalizeTotalMode, normalizeDueSoonDays, stagesFromValues, CardItem, CardItemStyle, ICON_NAMES, iconUrl,
} from '../../board-logic';

interface EntityOption {
	name: string;
	caption: string;
}

interface ColumnOption {
	name: string;
	caption: string;
	numeric: boolean;
	/** Referenced object of a lookup column ('' for other types). */
	reference: string;
	/** Date or date/time: can be the card's due date. */
	date: boolean;
}

interface LookupOption {
	id: string;
	caption: string;
	/** The value's own colour (a Color column of the lookup, e.g. ActivityStatus), used by "Create stages". */
	color?: string;
}

/** A plain CSS length; anything else would end up in a style attribute. */
const CSS_LENGTH = /^(\d+(\.\d+)?(px|vh|%|rem|em)|calc\([\d\s.+\-*\/%a-z()]+\))$/i;
/** Lookup columns that hold the values' own order, tried in this order. */
const ORDER_COLUMNS = ['Position', 'Number', 'Order', 'SortOrder', 'StageNumber'];
/** Widget properties "Copy settings" exports and imports (never boardCode: every board keeps its own cards). */
const COPY_KEYS = ['boardTitle', 'height', 'stages', 'entities', 'objectSettings', 'filters', 'swimlanes', 'refreshSeconds',
	'totalMode', 'dueSoonDays'] as const;

const LOOKUP_LIMIT = 200;
/** Auto-add counts stop here: the board loads at most 1000 cards anyway. */
const COUNT_LIMIT = 1000;

/**
 * Properties panel of hp.KanbanBoard in the Freedom UI designer. Every change is written at once as a constant of the
 * view node (no Save button inside the panel; the page designer's Save persists it).
 */
@CrtViewElement({
	selector: 'hp-kanban-board-panel',
	type: 'hp.KanbanBoardPanel',
})
@Component({
	selector: 'hp-kanban-board-panel-internal',
	templateUrl: './board-panel.component.html',
	styleUrls: ['./board-panel.component.scss'],
	standalone: true,
	imports: [CommonModule],
	schemas: [CUSTOM_ELEMENTS_SCHEMA],
	encapsulation: ViewEncapsulation.None, // the designer requires it for panels (not ShadowDom)
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HpKanbanBoardPanelComponent implements PropertyPanel {
	readonly maxStages = MAX_STAGES;
	readonly colorKeys = Object.keys(COLORS);
	readonly colors = COLORS;
	readonly maxCardFields = MAX_CARD_FIELDS;
	readonly iconNames = ICON_NAMES;
	/** Open icon picker: "<object>|<row index>" or "<object>|due". */
	protected readonly iconPicker = signal<string | null>(null);
	protected readonly iconSearch = signal('');
	protected readonly objectSettings = signal<Record<string, ObjectSettings>>({});
	/** Columns per object, loaded from the object's schema when the panel opens or the object is added. */
	protected readonly columnsOf = signal<Record<string, ColumnOption[]>>({});
	/** Values of each object's status column, keyed by object name. */
	protected readonly statusOptions = signal<Record<string, LookupOption[] | 'loading' | 'error'>>({});
	/** Records per "object|value" (counted up to COUNT_LIMIT), shown next to the Auto-add tick. */
	protected readonly valueCounts = signal<Record<string, number | 'loading' | 'error'>>({});
	readonly maxRequired = MAX_REQUIRED_FIELDS;
	protected readonly isPanelReady = signal(false);
	protected readonly boardTitle = signal('');
	protected readonly stages = signal<Stage[]>([]);
	protected readonly entities = signal<string[]>([]);
	protected readonly height = signal('600px');
	protected readonly swimlanes = signal<SwimlaneMode>('none');
	protected readonly refreshSeconds = signal(30);
	protected readonly totalMode = signal<TotalMode>('sum');
	protected readonly dueSoonDays = signal(3);
	readonly totalModes = Object.entries(TOTAL_MODES) as Array<[TotalMode, string]>;
	/** Per object: the result of "Create stages", shown under the button. */
	protected readonly createMessage = signal<Record<string, string>>({});
	/** "Copy settings": 'export' shows the JSON, 'import' a box to paste it. */
	protected readonly copyMode = signal<'' | 'export' | 'import'>('');
	protected readonly copyText = signal('');
	protected readonly copyMessage = signal('');
	protected readonly filterToggles = signal<FilterToggles>(normalizeFilterToggles(undefined));
	readonly filterKeys = FILTER_KEYS;
	readonly filterLabels: Record<keyof FilterToggles, string> = {
		search: 'Search box', object: 'Object type', owner: 'Owner', stale: 'Stale only', due: 'Due soon / overdue', sort: 'Sort order',
		compact: 'Compact button', refresh: 'Refresh button', addCard: 'Add card buttons',
	};
	protected readonly options = signal<EntityOption[]>([]);
	protected readonly optionsFailed = signal(false);
	protected readonly entitySearch = signal('');
	protected readonly stageError = signal('');
	/** Objects whose "update a record field" box is ticked before a field is chosen. */
	protected readonly syncOpen = signal<Record<string, boolean>>({});
	/** Objects expanded under "Cards and totals": kept here so a redraw after a save does not fold them. */
	protected readonly openObjects = signal<Record<string, boolean>>({});

	onObjectToggle(name: string, event: Event): void {
		this.openObjects.set({ ...this.openObjects(), [name]: (event.target as HTMLDetailsElement).open });
	}
	/** The stage whose settings are open (one at a time). */
	protected readonly openStage = signal<string | null>(null);
	protected readonly filteredOptions = computed(() => {
		const text = this.entitySearch().trim().toLowerCase();
		const selected = new Set(this.entities());
		return this.options()
			.filter((o) => !text || o.caption.toLowerCase().includes(text) || o.name.toLowerCase().includes(text))
			.sort((a, b) => Number(selected.has(b.name)) - Number(selected.has(a.name)))
			.slice(0, 200);
	});

	private _editor: ViewNodeEditor | null = null;

	constructor(private _cdr: ChangeDetectorRef) {}

	@Input()
	@CrtInput()
	public set viewNodeEditor(nodeEditor: ViewNodeEditor) {
		this._editor = nodeEditor;
		this.isPanelReady.set(false);
		this._load()
			.then(() => this.isPanelReady.set(true))
			.catch((error) => console.error('hp-kanban-board-panel: cannot read the widget settings', error))
			.finally(() => this._render());
		void this._loadOptions();
	}

	private get _node(): ViewNodeEditor {
		if (!this._editor) {
			throw new Error('View node editor is not initialized');
		}
		return this._editor;
	}

	private async _constant(name: string): Promise<unknown> {
		const value = await this._node.getPropertyValue(name);
		return value?.type === ViewNodePropertyValueType.Constant ? value.value : undefined;
	}

	private async _load(): Promise<void> {
		const code = await this._constant('boardCode');
		if (typeof code !== 'string' || !code.trim()) {
			// Every dropped board gets its own identity the first time its settings open.
			await this._node.setPropertyValue('boardCode', { constant: crypto.randomUUID() });
		}
		const title = await this._constant('boardTitle');
		this.boardTitle.set(typeof title === 'string' ? title : '');
		this.stages.set(normalizeStages(await this._constant('stages')));
		this.entities.set(normalizeEntities(await this._constant('entities')));
		this.objectSettings.set(normalizeObjectSettings(await this._constant('objectSettings'), this.entities()));
		this.entities().forEach((name) => void this._loadColumns(name));
		this.swimlanes.set(normalizeSwimlanes(await this._constant('swimlanes')));
		this.refreshSeconds.set(normalizeRefresh(await this._constant('refreshSeconds')));
		this.filterToggles.set(normalizeFilterToggles(await this._constant('filters')));
		const height = await this._constant('height');
		this.height.set(typeof height === 'string' && height ? height : '600px');
		this.totalMode.set(normalizeTotalMode(await this._constant('totalMode')));
		this.dueSoonDays.set(normalizeDueSoonDays(await this._constant('dueSoonDays')));
	}

	private async _loadOptions(): Promise<void> {
		try {
			const model = await Model.create('VwSysEntitySchemaInWorkspace');
			const filters = new FilterGroup();
			filters.addSchemaColumnFilterWithParameter(ComparisonType.Equal, 'ExtendParent', false);
			const rows = await model.load({
				attributes: ['Name', 'Caption'],
				parameters: [{ type: ModelParameterType.Filter, value: filters }],
				options: { pagingConfig: { rowCount: 5000, rowsOffset: 0 } },
			} as never) as unknown as Array<{ Name: string; Caption: string }>;
			const byName = new Map<string, EntityOption>();
			for (const row of rows) {
				if (row.Name && !byName.has(row.Name)) {
					byName.set(row.Name, { name: row.Name, caption: row.Caption || row.Name });
				}
			}
			this.options.set([...byName.values()].sort((a, b) => a.caption.localeCompare(b.caption)));
		} catch (e) {
			console.warn('hp-kanban-board-panel: object list unavailable, falling back to a text field', e);
			this.optionsFailed.set(true);
		}
		this._render();
	}

	// ---- title / height ------------------------------------------------------------------------------------

	async onTitle(event: Event): Promise<void> {
		const value = (event.target as HTMLInputElement).value;
		this.boardTitle.set(value);
		await this._node.setPropertyValue('boardTitle', { constant: value });
	}

	async onHeight(event: Event): Promise<void> {
		const value = (event.target as HTMLInputElement).value.trim();
		if (!CSS_LENGTH.test(value)) {
			return;
		}
		this.height.set(value);
		await this._node.setPropertyValue('height', { constant: value });
	}

	async onFilterToggle(key: keyof FilterToggles, event: Event): Promise<void> {
		const value = { ...this.filterToggles(), [key]: (event.target as HTMLInputElement).checked };
		this.filterToggles.set(value);
		await this._node.setPropertyValue('filters', { constant: value as never });
	}

	async onSwimlanes(event: Event): Promise<void> {
		const value = normalizeSwimlanes((event.target as HTMLSelectElement).value);
		this.swimlanes.set(value);
		await this._node.setPropertyValue('swimlanes', { constant: value });
	}

	/** 0 (off) to 600 seconds; anything else is put back to the current value. */
	async onRefresh(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		const n = Number(input.value);
		if (!input.value.trim() || !Number.isInteger(n) || n < 0 || n > 600) {
			input.value = String(this.refreshSeconds());
			return;
		}
		this.refreshSeconds.set(n);
		await this._node.setPropertyValue('refreshSeconds', { constant: n });
	}

	// ---- stages --------------------------------------------------------------------------------------------

	async renameStage(index: number, event: Event): Promise<void> {
		const caption = (event.target as HTMLInputElement).value.trim();
		if (!caption) {
			this.stageError.set('A stage needs a name.');
			this._render();
			return;
		}
		await this._saveStages(this.stages().map((s, i) => (i === index ? { ...s, caption } : s)));
	}

	toggleStage(id: string): void {
		this.openStage.set(this.openStage() === id ? null : id);
		this._render();
	}

	/** "limit 8 · stale 3 d · 2 rules" for the closed stage row; '' when nothing is set. */
	stageSummary(stage: Stage): string {
		const rules = Object.keys(stage.statusValues ?? {}).length
			+ Object.values(stage.requiredFields ?? {}).reduce((n, list) => n + list.length, 0);
		return [
			stage.wipLimit ? `limit ${stage.wipLimit}` : '',
			stage.rotDays ? `stale ${stage.rotDays} d` : '',
			rules ? `${rules} rule${rules === 1 ? '' : 's'}` : '',
		].filter(Boolean).join(' · ');
	}

	columnCaption(name: string, column: string): string {
		return this.columns(name).find((c) => c.name === column)?.caption ?? column;
	}

	requiredOf(stage: Stage, name: string): string[] {
		return stage.requiredFields?.[name] ?? [];
	}

	async addRequired(index: number, name: string, event: Event): Promise<void> {
		const select = event.target as HTMLSelectElement;
		const column = select.value;
		select.value = '';
		const stage = this.stages()[index];
		if (!column || !stage || this.requiredOf(stage, name).includes(column)) {
			return;
		}
		const list = [...this.requiredOf(stage, name), column].slice(0, MAX_REQUIRED_FIELDS);
		await this._saveStages(this.stages().map((s, i) => (i === index ? this._withStageMap(s, 'requiredFields', name, list) : s)));
	}

	async removeRequired(index: number, name: string, column: string): Promise<void> {
		const stage = this.stages()[index];
		const list = this.requiredOf(stage, name).filter((c) => c !== column);
		await this._saveStages(this.stages().map((s, i) => (i === index ? this._withStageMap(s, 'requiredFields', name, list.length ? list : undefined) : s)));
	}

	async setStageColor(index: number, color: string): Promise<void> {
		await this._applyStageColor(index, color);
	}

	private async _applyStageColor(index: number, color: string): Promise<void> {
		await this._saveStages(this.stages().map((s, i) => {
			if (i !== index) {
				return s;
			}
			const { color: _old, ...rest } = s;
			return color ? { ...rest, color } : rest;
		}));
	}

	/** WIP limit (1-999) or stale-after days (1-3650); empty or invalid clears it. */
	async onStageNumber(index: number, key: 'wipLimit' | 'rotDays', event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		const value = toLimit(input.value, key === 'wipLimit' ? 999 : 3650);
		input.value = value === null ? '' : String(value);
		await this._saveStages(this.stages().map((s, i) => {
			if (i !== index) {
				return s;
			}
			const next = { ...s };
			delete next[key];
			return value === null ? next : { ...next, [key]: value };
		}));
	}

	async addStage(): Promise<void> {
		if (this.stages().length >= MAX_STAGES) {
			return;
		}
		const stage = { id: newStageId(), caption: `Stage ${this.stages().length + 1}` };
		this.openStage.set(stage.id);
		await this._saveStages([...this.stages(), stage]);
	}

	async removeStage(index: number): Promise<void> {
		if (this.stages().length <= 1) {
			return;
		}
		await this._saveStages(this.stages().filter((_, i) => i !== index));
	}

	async moveStage(index: number, delta: number): Promise<void> {
		const list = [...this.stages()];
		const target = index + delta;
		if (target < 0 || target >= list.length) {
			return;
		}
		[list[index], list[target]] = [list[target], list[index]];
		await this._saveStages(list);
	}

	private async _saveStages(list: Stage[]): Promise<void> {
		this.stageError.set('');
		this.stages.set(list);
		this._render();
		// Only the keys a stage has: an unset colour or limit is left out, not written as null.
		await this._node.setPropertyValue('stages', {
			constant: list.map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== ''))) as never,
		});
	}

	// ---- objects -------------------------------------------------------------------------------------------

	onEntitySearch(event: Event): void {
		this.entitySearch.set((event.target as HTMLInputElement).value);
		this._render();
	}

	isSelected(name: string): boolean {
		return this.entities().includes(name);
	}

	captionOf(name: string): string {
		return this.options().find((o) => o.name === name)?.caption ?? name;
	}

	async toggleEntity(name: string, event: Event): Promise<void> {
		const checked = (event.target as HTMLInputElement).checked;
		const list = checked ? [...this.entities(), name] : this.entities().filter((n) => n !== name);
		await this._saveEntities(normalizeEntities(list));
	}

	async onEntitiesText(event: Event): Promise<void> {
		await this._saveEntities(normalizeEntities((event.target as HTMLInputElement).value));
	}

	private async _saveEntities(list: string[]): Promise<void> {
		this.entities.set(list);
		list.forEach((name) => void this._loadColumns(name));
		this._render();
		await this._node.setPropertyValue('entities', { constant: list });
		await this._saveObjectSettings(normalizeObjectSettings(this.objectSettings(), list));
	}

	// ---- per-object settings -------------------------------------------------------------------------------

	settingsOf(name: string): ObjectSettings {
		return this.objectSettings()[name] ?? { fields: [], sumField: '', color: '' };
	}

	columns(name: string): ColumnOption[] {
		return this.columnsOf()[name] ?? [];
	}

	numericColumns(name: string): ColumnOption[] {
		return this.columns(name).filter((c) => c.numeric);
	}

	// ---- card layout --------------------------------------------------------------------------------------

	layoutOf(name: string): CardItem[] {
		return this.settingsOf(name).layout;
	}

	/** Columns that can still be added to the card (each field once). */
	freeColumns(name: string, keep?: string): ColumnOption[] {
		const used = new Set(this.layoutOf(name).map((l) => l.field));
		return this.columns(name).filter((c) => c.name === keep || !used.has(c.name));
	}

	private async _saveLayout(name: string, layout: CardItem[]): Promise<void> {
		await this._updateObject(name, { layout: layout.slice(0, MAX_CARD_FIELDS) });
	}

	/** "+ field": a column as a line, or ("due:<column>") a date column as the object's due date row. */
	async addLayoutField(name: string, event: Event): Promise<void> {
		const select = event.target as HTMLSelectElement;
		const value = select.value;
		select.value = '';
		const due = value.startsWith('due:');
		const field = due ? value.slice(4) : value;
		if (field) {
			await this._saveLayout(name, [...this.layoutOf(name), { field, icon: due ? 'calendar-icon' : '', style: due ? 'due' : 'line' }]);
		}
	}

	hasDueRow(name: string): boolean {
		return this.layoutOf(name).some((l) => l.style === 'due');
	}

	freeDateColumns(name: string): ColumnOption[] {
		return this.freeColumns(name).filter((c) => c.date);
	}

	async setLayoutField(name: string, index: number, event: Event): Promise<void> {
		const field = (event.target as HTMLSelectElement).value;
		await this._saveLayout(name, this.layoutOf(name).map((l, i) => (i !== index ? l
			: { ...l, field, style: l.style === 'due' && !this.isDateColumn(name, field) ? 'tag' as const : l.style })));
	}

	/** One due row per object: choosing Due on a row turns the previous due row into a tag. */
	async setLayoutStyle(name: string, index: number, style: CardItemStyle): Promise<void> {
		await this._saveLayout(name, this.layoutOf(name).map((l, i) => (i === index ? { ...l, style }
			: style === 'due' && l.style === 'due' ? { ...l, style: 'tag' as const } : l)));
	}

	isDateColumn(name: string, field: string): boolean {
		return this.columns(name).some((c) => c.name === field && c.date);
	}

	/** The other object that already has the board's one total field ('' = none, or this object has it). */
	totalOwner(name: string): string {
		return this.entities().find((n) => n !== name && !!this.settingsOf(n).sumField) ?? '';
	}

	async moveLayout(name: string, index: number, delta: number): Promise<void> {
		const list = [...this.layoutOf(name)];
		const target = index + delta;
		if (target < 0 || target >= list.length) {
			return;
		}
		[list[index], list[target]] = [list[target], list[index]];
		this.iconPicker.set(null);
		await this._saveLayout(name, list);
	}

	async removeLayout(name: string, index: number): Promise<void> {
		this.iconPicker.set(null);
		await this._saveLayout(name, this.layoutOf(name).filter((_, i) => i !== index));
	}

	toggleIconPicker(key: string): void {
		this.iconPicker.set(this.iconPicker() === key ? null : key);
		this.iconSearch.set('');
		this._render();
	}

	onIconSearch(event: Event): void {
		this.iconSearch.set((event.target as HTMLInputElement).value.trim().toLowerCase());
		this._render();
	}

	filteredIcons(): readonly string[] {
		const q = this.iconSearch();
		return q ? this.iconNames.filter((n) => n.includes(q)) : this.iconNames;
	}

	/** Sets the icon of a layout row; '' removes it. */
	async pickIcon(name: string, index: number, icon: string): Promise<void> {
		this.iconPicker.set(null);
		await this._saveLayout(name, this.layoutOf(name).map((l, i) => (i === index ? { ...l, icon } : l)));
	}


	iconMask(icon: string | undefined): string | null {
		const url = iconUrl(icon, location.pathname);
		return url ? `url("${url}")` : null;
	}

	iconLabel(icon: string): string {
		return icon.replace(/-(button-)?icon$/, '').replace(/-/g, ' ');
	}

	async onSumField(name: string, event: Event): Promise<void> {
		await this._updateObject(name, { sumField: (event.target as HTMLSelectElement).value });
	}

	async onTotalMode(event: Event): Promise<void> {
		const value = normalizeTotalMode((event.target as HTMLSelectElement).value);
		this.totalMode.set(value);
		await this._node.setPropertyValue('totalMode', { constant: value });
	}

	/** The object's "due soon" days; boards saved before this was per object use the board-wide value. */
	dueSoonOf(name: string): number {
		return this.settingsOf(name).dueSoonDays ?? this.dueSoonDays();
	}

	/** 1-365 days; anything else is put back to the current value. */
	async onDueSoonDays(name: string, event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		const n = Number(input.value);
		if (!input.value.trim() || !Number.isInteger(n) || n < 1 || n > 365) {
			input.value = String(this.dueSoonOf(name));
			return;
		}
		await this._updateObject(name, { dueSoonDays: n });
	}

	async onLocked(name: string, event: Event): Promise<void> {
		await this._updateObject(name, { locked: !(event.target as HTMLInputElement).checked });
	}

	/** One stage per value of the object's field that no stage has yet, in the lookup's own order. */
	async createStages(name: string): Promise<void> {
		const options = this.statusOptions()[name];
		if (!Array.isArray(options)) {
			return;
		}
		const result = stagesFromValues(this.stages(), name, options);
		const field = this.columnCaption(name, this.settingsOf(name).statusColumn);
		this.createMessage.set({ ...this.createMessage(), [name]: !result.added
			? `Every ${field} value already has a stage.`
			: `Added ${result.added} stage(s)` + (result.skipped ? `; ${result.skipped} value(s) left out (${MAX_STAGES} stages at most).` : '.') });
		if (result.added) {
			await this._saveStages(result.stages);
		}
		this._render();
	}

	// ---- copy settings -------------------------------------------------------------------------------------

	async showExport(): Promise<void> {
		const settings: Record<string, unknown> = {};
		for (const key of COPY_KEYS) {
			const value = await this._constant(key);
			if (value !== undefined) {
				settings[key] = value;
			}
		}
		this.copyText.set(JSON.stringify(settings, null, 2));
		this.copyMessage.set('');
		this.copyMode.set('export');
		this._render();
	}

	showImport(): void {
		this.copyText.set('');
		this.copyMessage.set('');
		this.copyMode.set('import');
		this._render();
	}

	closeCopy(): void {
		this.copyMode.set('');
		this._render();
	}

	async copyToClipboard(): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.copyText());
			this.copyMessage.set('Copied.');
		} catch {
			this.copyMessage.set('Select the text and copy it (Ctrl+C).');
		}
		this._render();
	}

	onCopyText(event: Event): void {
		this.copyText.set((event.target as HTMLTextAreaElement).value);
	}

	/**
	 * Applies pasted settings: every known property is cleaned by the same rules the board uses; unknown keys and
	 * invalid values are dropped. This board keeps its own code, so its cards stay its own.
	 */
	async applyImport(): Promise<void> {
		let raw: unknown;
		try {
			raw = JSON.parse(this.copyText());
		} catch {
			this.copyMessage.set('This is not valid settings text.');
			this._render();
			return;
		}
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			this.copyMessage.set('This is not valid settings text.');
			this._render();
			return;
		}
		const v = raw as Record<string, unknown>;
		const entities = normalizeEntities(v['entities'] ?? this.entities());
		const clean: Partial<Record<(typeof COPY_KEYS)[number], unknown>> = {
			stages: v['stages'] === undefined ? undefined : normalizeStages(v['stages']),
			entities: v['entities'] === undefined ? undefined : entities,
			objectSettings: v['objectSettings'] === undefined ? undefined : normalizeObjectSettings(v['objectSettings'], entities),
			filters: v['filters'] === undefined ? undefined : normalizeFilterToggles(v['filters']),
			swimlanes: v['swimlanes'] === undefined ? undefined : normalizeSwimlanes(v['swimlanes']),
			refreshSeconds: v['refreshSeconds'] === undefined ? undefined : normalizeRefresh(v['refreshSeconds']),
			totalMode: v['totalMode'] === undefined ? undefined : normalizeTotalMode(v['totalMode']),
			dueSoonDays: v['dueSoonDays'] === undefined ? undefined : normalizeDueSoonDays(v['dueSoonDays']),
			boardTitle: typeof v['boardTitle'] === 'string' ? v['boardTitle'].slice(0, 200) : undefined,
			height: typeof v['height'] === 'string' && CSS_LENGTH.test(v['height']) ? v['height'] : undefined,
		};
		const keys = COPY_KEYS.filter((k) => clean[k] !== undefined);
		if (!keys.length) {
			this.copyMessage.set('Nothing to import: no known settings in this text.');
			this._render();
			return;
		}
		for (const key of keys) {
			await this._node.setPropertyValue(key, { constant: clean[key] as never });
		}
		await this._load();
		this.columnsOf.set({});
		this.entities().forEach((name) => void this._loadColumns(name));
		this.copyMessage.set(`Imported: ${keys.join(', ')}.`);
		this._render();
	}

	lookupColumns(name: string): ColumnOption[] {
		return this.columns(name).filter((c) => c.reference);
	}

	/** Objects that have a status column: the ones a stage can map a status value for. */
	statusObjects(): string[] {
		return this.entities().filter((n) => this.settingsOf(n).statusColumn);
	}

	statusValuesOf(name: string): LookupOption[] | 'loading' | 'error' | undefined {
		return this.statusOptions()[name];
	}

	isRequired(stage: Stage, name: string, column: string): boolean {
		return !!stage.requiredFields?.[name]?.includes(column);
	}

	isSyncOn(name: string): boolean {
		return !!this.settingsOf(name).statusColumn || !!this.syncOpen()[name];
	}

	async onSyncToggle(name: string, event: Event): Promise<void> {
		const on = (event.target as HTMLInputElement).checked;
		this.syncOpen.set({ ...this.syncOpen(), [name]: on });
		if (!on) {
			await this._setStatusColumn(name, ''); // unticked: stages stop touching the record
		}
		this._render();
	}

	async onStatusColumn(name: string, event: Event): Promise<void> {
		await this._setStatusColumn(name, (event.target as HTMLSelectElement).value);
	}

	private async _setStatusColumn(name: string, column: string): Promise<void> {
		await this._updateObject(name, { statusColumn: column });
		if (column) {
			this.statusOptions.set({ ...this.statusOptions(), [name]: 'loading' });
			await this._loadStatusOptions(name);
		}
		// Values of the previous column mean nothing for the new one.
		await this._saveStages(this.stages().map((s) =>
			this._withStageMap(this._withStageMap(s, 'statusValues', name, undefined), 'autoAdd', name, undefined)));
	}

	/** Values this stage stands for (several allowed); empty = "don't change". */
	valuesOf(stage: Stage, name: string): string[] {
		return stage.statusValues?.[name] ?? [];
	}

	valueCaption(name: string, id: string): string {
		const options = this.statusOptions()[name];
		return (Array.isArray(options) ? options.find((o) => o.id === id)?.caption : undefined) ?? id;
	}

	async addStageValue(index: number, name: string, event: Event): Promise<void> {
		const select = event.target as HTMLSelectElement;
		const value = select.value;
		select.value = '';
		const stage = this.stages()[index];
		if (!value || !stage || this.valuesOf(stage, name).includes(value)) {
			return;
		}
		void this._loadCount(name, value);
		const list = [...this.valuesOf(stage, name), value].slice(0, MAX_STATUS_VALUES);
		await this._saveStages(this.stages().map((s, i) => (i === index ? this._withStageMap(s, 'statusValues', name, list) : s)));
	}

	/** The last value removed means "don't change", which also switches auto-add off for the stage. */
	async removeStageValue(index: number, name: string, value: string): Promise<void> {
		const stage = this.stages()[index];
		const list = this.valuesOf(stage, name).filter((v) => v !== value);
		await this._saveStages(this.stages().map((s, i) => (i !== index ? s
			: this._withStageMap(this._withStageMap(s, 'statusValues', name, list.length ? list : undefined), 'autoAdd', name,
				list.length ? s.autoAdd?.[name] : undefined))));
	}

	async onStageAutoAdd(index: number, name: string, event: Event): Promise<void> {
		const on = (event.target as HTMLInputElement).checked || undefined;
		await this._saveStages(this.stages().map((s, i) => (i === index ? this._withStageMap(s, 'autoAdd', name, on) : s)));
	}

	/** A copy of the stage with one object's entry of statusValues / requiredFields set or removed. */
	private _withStageMap<K extends 'statusValues' | 'requiredFields' | 'autoAdd'>(stage: Stage, key: K, name: string,
		value: NonNullable<Stage[K]>[string] | undefined): Stage {
		const map = { ...(stage[key] ?? {}) } as Record<string, unknown>;
		if (value === undefined) {
			delete map[name];
		} else {
			map[name] = value;
		}
		const next = { ...stage };
		if (Object.keys(map).length) {
			(next as Record<string, unknown>)[key] = map;
		} else {
			delete next[key];
		}
		return next;
	}

	private async _loadStatusOptions(name: string): Promise<void> {
		const column = this.columns(name).find((c) => c.name === this.settingsOf(name).statusColumn);
		if (!column?.reference) {
			return;
		}
		try {
			const model = await Model.create(column.reference);
			const schema = await model.getSchema();
			const display = schema.primaryDisplayAttributeName || 'Name';
			const has = (n: string) => (schema.attributes ?? []).find((a) => a.name === n);
			const color = has('Color') ? 'Color' : '';
			// The lookup's own order (e.g. a stage number) when it has one: "Create stages" follows it.
			const order = ORDER_COLUMNS.find((n) => VALUE_TYPES.numeric.has(Number(has(n)?.dataValueType))) ?? '';
			const rows = await model.load({
				attributes: ['Id', display, ...(color ? [color] : []), ...(order ? [order] : [])],
				options: { pagingConfig: { rowCount: LOOKUP_LIMIT, rowsOffset: 0 } },
			} as never) as unknown as Array<Record<string, unknown>>;
			const list = rows.slice(0, LOOKUP_LIMIT)
				.map((r) => ({ id: String(r['Id']).toLowerCase(), caption: String(r[display] ?? r['Id']),
					color: color && typeof r[color] === 'string' ? r[color] as string : undefined, order: Number(r[order] ?? 0) }))
				.sort((a, b) => (order ? a.order - b.order : 0) || a.caption.localeCompare(b.caption))
				.map(({ order: _, ...option }) => option);
			this.statusOptions.set({ ...this.statusOptions(), [name]: list });
			const values = new Set(this.stages().flatMap((s) => s.statusValues?.[name] ?? []));
			values.forEach((v) => void this._loadCount(name, v));
		} catch (e) {
			console.warn(`hp-kanban-board-panel: values of ${name}.${column.name} unavailable`, e);
			this.statusOptions.set({ ...this.statusOptions(), [name]: 'error' });
		}
		this._render();
	}

	/** "75", "1000+", "…" - how many records auto-add would put into the stage. */
	/** Records having any of the values (each counted up to COUNT_LIMIT). */
	countText(name: string, valueIds: string[]): string {
		const counts = valueIds.map((id) => this.valueCounts()[`${name}|${id}`]);
		if (counts.some((c) => c === 'error')) {
			return '?';
		}
		if (counts.some((c) => typeof c !== 'number')) {
			return '…';
		}
		const sum = (counts as number[]).reduce((a, b) => a + b, 0);
		return counts.some((c) => (c as number) >= COUNT_LIMIT) ? `${sum}+` : String(sum);
	}

	private async _loadCount(name: string, valueId: string): Promise<void> {
		const key = `${name}|${valueId}`;
		const column = this.settingsOf(name).statusColumn;
		if (!column || this.valueCounts()[key] !== undefined) {
			return;
		}
		this.valueCounts.set({ ...this.valueCounts(), [key]: 'loading' });
		try {
			const filters = new FilterGroup();
			filters.addSchemaColumnFilterWithParameter(ComparisonType.Equal, column, valueId);
			const rows = await (await Model.create(name)).load({
				attributes: ['Id'],
				parameters: [{ type: ModelParameterType.Filter, value: filters }],
				options: { pagingConfig: { rowCount: COUNT_LIMIT, rowsOffset: 0 } },
			} as never) as unknown as unknown[];
			this.valueCounts.set({ ...this.valueCounts(), [key]: rows.length });
		} catch (e) {
			console.warn(`hp-kanban-board-panel: cannot count ${name} records`, e);
			this.valueCounts.set({ ...this.valueCounts(), [key]: 'error' });
		}
		this._render();
	}

	/** Caption of an earlier stage that maps the same value: record sync and auto-add use that one. */
	duplicateOf(index: number, name: string): string {
		const values = this.stages()[index]?.statusValues?.[name] ?? [];
		return this.stages().slice(0, index).find((s) => s.statusValues?.[name]?.some((v) => values.includes(v)))?.caption ?? '';
	}

	async onObjectColor(name: string, event: Event): Promise<void> {
		await this._updateObject(name, { color: (event.target as HTMLSelectElement).value });
	}

	private async _updateObject(name: string, change: Partial<ObjectSettings>): Promise<void> {
		// The layout is the truth here: dueField/dueIcon are derived from its due row, and passing them back would make
		// the normalizer read them as an old board's separate due date and restore a row the user just changed.
		const { dueField: _f, dueIcon: _i, ...current } = this.settingsOf(name);
		const next = { ...this.objectSettings(), [name]: { ...current, ...change } };
		await this._saveObjectSettings(normalizeObjectSettings(next, this.entities()));
	}

	private async _saveObjectSettings(value: Record<string, ObjectSettings>): Promise<void> {
		this.objectSettings.set(value);
		this._render();
		await this._node.setPropertyValue('objectSettings', { constant: value as never });
	}

	private async _loadColumns(name: string): Promise<void> {
		if (this.columnsOf()[name]) {
			return;
		}
		try {
			const schema = await (await Model.create(name)).getSchema();
			const list = (schema.attributes ?? [])
				.filter((a) => !VALUE_TYPES.hidden.has(Number(a.dataValueType)) && a.name !== 'ProcessListeners')
				.map((a) => ({
					name: a.name,
					caption: typeof a.caption === 'string' && a.caption ? a.caption : a.name,
					numeric: VALUE_TYPES.numeric.has(Number(a.dataValueType)),
					reference: Number(a.dataValueType) === VALUE_TYPES.lookup && a.referenceSchemaName ? a.referenceSchemaName : '',
					date: Number(a.dataValueType) === VALUE_TYPES.date || Number(a.dataValueType) === VALUE_TYPES.dateTime,
				}))
				.sort((a, b) => a.caption.localeCompare(b.caption));
			this.columnsOf.set({ ...this.columnsOf(), [name]: list });
			void this._loadStatusOptions(name);
		} catch (e) {
			console.warn(`hp-kanban-board-panel: columns of "${name}" unavailable`, e);
			this.columnsOf.set({ ...this.columnsOf(), [name]: [] });
		}
		this._render();
	}

	trackIndex(index: number): number {
		return index;
	}

	private _render(): void {
		this._cdr.markForCheck();
		this._cdr.detectChanges();
	}
}
