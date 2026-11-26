// Pure board logic: no Angular, no Creatio. Checked by board-logic.test.ts (node).

export interface Stage {
	id: string;
	caption: string;
	/** A key of COLORS, or absent. */
	color?: string;
	/** Work-in-progress limit: the header flags the stage when it holds more cards. */
	wipLimit?: number;
	/** A card older than this many days in the stage is "stale". */
	rotDays?: number;
	/**
	 * Per object: the lookup values (Ids) this stage stands for. A record with any of them belongs here; moving a card
	 * here writes the first one unless the record already has one of them.
	 */
	statusValues?: Record<string, string[]>;
	/** Per object: columns that must be filled before a card may enter this stage. */
	requiredFields?: Record<string, string[]>;
	/** Per object: true = every record with this stage's status value gets a card here by itself. */
	autoAdd?: Record<string, true>;
}

export interface CardValue {
	label: string;
	text: string;
	/** A Creatio icon name (ICON_NAMES) or ''. */
	icon?: string;
	style?: CardItemStyle;
}

/**
 * line: "Label: value" on its own row; tag: a chip with the value; due: the object's due date as a chip that turns
 * amber when due soon and red when overdue (one per object, date columns only).
 */
export type CardItemStyle = 'line' | 'tag' | 'due';

/** One row of an object's card layout. */
export interface CardItem {
	field: string;
	icon: string;
	style: CardItemStyle;
}

/**
 * Freedom UI icons the shell ships as /0/Shell/assets/themes/freedom/icons/<name>.svg (read from Creatio 10.1's own
 * icon list). shortcut: a fixed list; a name another Creatio version lacks simply draws nothing.
 */
export const ICON_NAMES: readonly string[] = [
	'contact-icon', 'contact-call-center-icon', 'contact-group-icon', 'employee-icon', 'document-new-icon',
	'document-icon', 'document-edit-icon', 'folder-icon', 'book-open-icon', 'pen', 'coins-icon', 'money-icon',
	'trolley-icon', 'gift-icon', 'diagram-icon', 'flowchart-icon', 'timeline-icon', 'organizational-structure-icon',
	'calendar-icon', 'goal-icon', 'message-warning-icon', 'problem-icon', 'home-icon', 'work-icon', 'bag-icon',
	'mail-icon', 'phone-icon', 'feed-icon', 'flag-icon', 'settings', 'star-icon', 'magnifying-glass-icon', 'tiles-icon',
	'horn-icon', 'bell-icon', 'clock-icon', 'history-icon', 'info-icon', 'checkbox-icon', 'log-icon', 'lock',
	'attachments-icon', 'landingi-icon', 'landing-page-icon', 'instapage-icon', 'globe-icon', 'wordpress-icon',
	'catalog-icon', 'air-balloon-icon', 'circles-icon', 'contact-filter-icon', 'fire-icon', 'level-icon',
	'subscribe-icon', 'hourglass-icon', 'contact-leads-icon', 'like-icon', 'at-icon', 'reload-icon',
	'filter-column-icon', 'calculator-icon', 'sum-icon', 'checkmark-icon', 'checkmark-filled-icon', 'close-link',
	'copilot-action-button-icon', 'gallery', 'catalog', 'send-email-icon', 'confirm-scheduling-icon',
	'schedule-time-icon', 'translate-icon', 'checkbox-rocket-icon', 'checkbox-arrow-right-icon', 'folder-rocket-icon',
	'folder-arrow-right-icon', 'warning-filled-icon', 'change-contact-icon', 'scale-camera-icon', 'dashboards-icon',
	'list-icon', 'cloud-arrow-down-icon', 'cloud-arrow-up-icon', 'document-contact-icon', 'merge-icon',
	'download-button-icon', 'edit-button-icon', 'flag-button-icon', 'folder-plus-icon', 'folder-button-icon',
	'expand-icon', 'import-button-icon', 'system-notifications', 'more-vertical-button-icon', 'more-button-icon',
	'add-button-icon', 'close-button-icon', 'message-warn-button-icon', 'chat-icon', 'tag-icon', 'eraser-icon',
	'checkmark-lined-icon', 'exclamation-lined-icon', 'exclamation-filled-icon', 'excel-icon', 'folder-search-icon',
	'warning-icon', 'question-icon', 'lock-button-icon', 'business-contact-icon', 'feeds-icon', 'home-panel-icon',
	'leads-icon', 'map-with-pin-icon', 'segments-icon', 'door-cross-icon', 'filter-cross-icon',
];
const ICON_SET = new Set(ICON_NAMES);

/** URL of a Creatio icon under the site's path (works from /0/Shell and the designer's /0/ClientApp); '' if unknown. */
export function iconUrl(name: string | undefined, pathname: string): string {
	if (!name || !ICON_SET.has(name)) {
		return '';
	}
	return `${pathname.split('/0/')[0]}/0/Shell/assets/themes/freedom/icons/${name}.svg`;
}

export interface Card {
	/** hpKanbanCard.Id */
	id: string;
	stageCode: string;
	entityName: string;
	recordId: string;
	position: number;
	title: string;
	ownerId: string | null;
	ownerName: string;
	/** Chosen card fields, already formatted. */
	values?: CardValue[];
	/** Value of the object's total field; null when the object has none or the record leaves it empty. */
	sum?: number | null;
	/** hpKanbanCard.CreatedOn as ISO text, for "Newest added". */
	addedOn?: string;
	/** When the card entered its stage (ISO text): hpStageChangedOn, or addedOn for older rows. */
	stageSince?: string;
	/** Past its stage's rotDays (computed by markStale). */
	stale?: boolean;
	/** Value of the object's status column on the record (lookup Id), when the object has one configured. */
	statusId?: string | null;
	/** The record's due date as shown on the card, and how close it is (see dueStateOf). */
	dueText?: string;
	dueState?: DueState;
}

/** overdue: past the due date; soon: due within the board's "due soon" days; ok: later; '': no due date. */
export type DueState = 'overdue' | 'soon' | 'ok' | '';

/** Per allowed object: which columns its cards show, which one is summed, its colour. */
export interface ObjectSettings {
	fields: string[];
	sumField: string;
	color: string;
	/** Lookup column whose value follows the card's stage ('' = board-own stages only). */
	statusColumn: string;
	/** The layout's due row: its column ('' = none) and icon. Derived from `layout`; kept for readers of older boards. */
	dueField: string;
	dueIcon: string;
	/** "Due soon" this many days ahead; absent = the board's dueSoonDays (boards saved before it was per object). */
	dueSoonDays?: number;
	/** Cards of this object cannot be moved (no drag and drop, no move actions). */
	locked: boolean;
	/** What the card shows, in order (up to MAX_CARD_FIELDS); `fields` is the same list of column names. */
	layout: CardItem[];
}

/** Lookup values one stage may stand for, per object. */
export const MAX_STATUS_VALUES = 20;
export const MAX_REQUIRED_FIELDS = 10;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SortMode = 'manual' | 'title' | 'total' | 'newest';

export const MAX_CARD_FIELDS = 8;

/** The only colours a board can use: stored by key, so no free CSS value reaches a style attribute. */
export const COLORS: Record<string, string> = {
	blue: '#0058ef',
	teal: '#00a3a3',
	green: '#1e9e4a',
	yellow: '#e0a800',
	orange: '#f26b1d',
	red: '#d92d20',
	purple: '#7a42d1',
	grey: '#7d8794',
};

/** DataValueType codes of @creatio/base (enum ɵDataValueType), the subset the board cares about. */
export const VALUE_TYPES = {
	numeric: new Set([4, 5, 6, 31, 32, 33, 34, 40, 47, 48, 49, 50]),
	integer: new Set([4]),
	dateTime: 7,
	date: 8,
	time: 9,
	lookup: 10,
	boolean: 12,
	/** Never shown on a card: guid, binary, image, file, rich text, collections and other internal types. */
	hidden: new Set([0, 13, 14, 16, 17, 20, 21, 22, 23, 24, 25, 26, 35, 36, 38, 39, 41, 43, 46]),
};

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface CardFilter {
	text: string;
	entityName: string;
	/** Owner to show: null = any owner, '' = cards without an owner, otherwise the owner's contact id. */
	ownerId: string | null;
	staleOnly?: boolean;
	/** Only cards that are overdue or due soon. */
	dueOnly?: boolean;
}

export const MAX_STAGES = 12;

export const DEFAULT_STAGES: Stage[] = [
	{ id: 'todo', caption: 'To do' },
	{ id: 'inprogress', caption: 'In progress' },
	{ id: 'done', caption: 'Done' },
];

/** Stage id: short, unique enough per board, stored in hpKanbanCard.hpStageCode (50 chars). */
export function newStageId(): string {
	return 's' + Math.random().toString(36).slice(2, 10);
}

/**
 * The designer stores the property as a constant; accept the array, a JSON string of it, or plain strings.
 * Invalid entries are dropped, duplicate ids are made unique, the list is capped at MAX_STAGES.
 * Falls back to the default stages when nothing usable is left.
 */
export function normalizeStages(raw: unknown): Stage[] {
	let value = raw;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return DEFAULT_STAGES.map((s) => ({ ...s }));
		}
	}
	if (!Array.isArray(value)) {
		return DEFAULT_STAGES.map((s) => ({ ...s }));
	}
	const seen = new Set<string>();
	const result: Stage[] = [];
	for (const item of value) {
		const caption = typeof item === 'string' ? item : item?.caption;
		if (typeof caption !== 'string' || !caption.trim()) {
			continue;
		}
		let id = typeof item === 'object' && typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : '';
		if (!id || seen.has(id)) {
			id = typeof item === 'string' && !seen.has(caption.trim()) ? caption.trim() : newStageId();
		}
		seen.add(id);
		const stage: Stage = { id: id.slice(0, 50), caption: caption.trim() };
		if (typeof item === 'object' && typeof item?.color === 'string' && Object.hasOwn(COLORS, item.color)) {
			stage.color = item.color;
		}
		const wip = typeof item === 'object' ? toLimit(item?.wipLimit, 999) : null;
		if (wip !== null) {
			stage.wipLimit = wip;
		}
		const rot = typeof item === 'object' ? toLimit(item?.rotDays, 3650) : null;
		if (rot !== null) {
			stage.rotDays = rot;
		}
		const statusValues = typeof item === 'object' ? cleanStatusValues(item?.statusValues) : null;
		if (statusValues) {
			stage.statusValues = statusValues;
		}
		const requiredFields = typeof item === 'object' ? cleanRequiredFields(item?.requiredFields) : null;
		if (requiredFields) {
			stage.requiredFields = requiredFields;
		}
		const autoAdd = typeof item === 'object' ? plainMap(item?.autoAdd) : null;
		const autoNames = Object.keys(autoAdd ?? {}).filter((n) => NAME.test(n) && autoAdd![n] === true && statusValues?.[n]?.length);
		if (autoNames.length) {
			stage.autoAdd = Object.fromEntries(autoNames.map((n) => [n, true as const]));
		}
		result.push(stage);
		if (result.length === MAX_STAGES) {
			break;
		}
	}
	return result.length ? result : DEFAULT_STAGES.map((s) => ({ ...s }));
}

/** Entity names: array or comma-separated string; trimmed, unique, order kept. */
export function normalizeEntities(raw: unknown): string[] {
	const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
	const result: string[] = [];
	for (const item of list) {
		const name = typeof item === 'string' ? item.trim() : '';
		if (NAME.test(name) && !result.includes(name)) {
			result.push(name);
		}
	}
	return result;
}

export function matchesFilter(card: Card, filter: CardFilter): boolean {
	const text = filter.text.trim().toLowerCase();
	if (text && !card.title.toLowerCase().includes(text)) {
		return false;
	}
	if (filter.entityName && card.entityName !== filter.entityName) {
		return false;
	}
	if (filter.ownerId !== null && filter.ownerId !== undefined && (card.ownerId ?? '') !== filter.ownerId) {
		return false;
	}
	if (filter.dueOnly && card.dueState !== 'overdue' && card.dueState !== 'soon') {
		return false;
	}
	if (filter.staleOnly && !card.stale) {
		return false;
	}
	return true;
}

function byPosition(a: Card, b: Card): number {
	return a.position - b.position || a.title.localeCompare(b.title);
}

/**
 * Columns in stage order. A card whose stage no longer exists goes to the first stage (its row is not changed
 * until the card is moved). Within a column: by position, then title.
 */
export function groupByStage(cards: Card[], stages: Stage[]): Map<string, Card[]> {
	const columns = new Map<string, Card[]>(stages.map((s) => [s.id, []]));
	const first = stages[0]?.id;
	for (const card of cards) {
		const column = columns.get(card.stageCode) ?? (first !== undefined ? columns.get(first) : undefined);
		column?.push(card);
	}
	for (const column of columns.values()) {
		column.sort(byPosition);
	}
	return columns;
}

/**
 * Moves a card to `toStage` at `toIndex` (clamped) inside the given columns (mutated in place).
 * Renumbers the source and target columns 0..n-1 and returns the cards whose stage or position changed:
 * only those rows need a save.
 */
export function moveCard(columns: Map<string, Card[]>, cardId: string, toStage: string, toIndex: number): Card[] {
	const target = columns.get(toStage);
	if (!target) {
		return [];
	}
	let source: Card[] | undefined;
	let card: Card | undefined;
	let fromIndex = -1;
	for (const column of columns.values()) {
		fromIndex = column.findIndex((c) => c.id === cardId);
		if (fromIndex >= 0) {
			source = column;
			card = column.splice(fromIndex, 1)[0];
			break;
		}
	}
	if (!card || !source) {
		return [];
	}
	const index = Math.max(0, Math.min(toIndex, target.length));
	target.splice(index, 0, card);
	if (source === target && index === fromIndex && card.stageCode === toStage) {
		return []; // dropped where it was
	}
	card.stageCode = toStage;
	// Positions have gaps (POSITION_STEP): the moved card takes a value between its neighbours and nothing else is
	// written. Only when there is no room left is the column renumbered.
	const prev = target[index - 1]?.position;
	const next = target[index + 1]?.position;
	if (prev === undefined && next === undefined) {
		card.position = 0;
	} else if (next === undefined) {
		card.position = prev! + POSITION_STEP;
	} else if (prev === undefined) {
		card.position = next - POSITION_STEP;
	} else if (next - prev >= 2) {
		card.position = Math.floor((prev + next) / 2);
	} else {
		const before = new Map(target.map((c) => [c.id, c.position]));
		target.forEach((c, i) => (c.position = i * POSITION_STEP));
		return target.filter((c) => c === card || before.get(c.id) !== c.position);
	}
	return [card];
}

/** Distance between neighbouring positions, so a move between two cards writes only the moved one. */
export const POSITION_STEP = 1000;

/** Next position at the end of a column. */
export function nextPosition(column: Array<{ position: number }> | undefined): number {
	return column?.length ? Math.max(...column.map((c) => c.position)) + POSITION_STEP : 0;
}

/**
 * Settings of every allowed object (others dropped). Accepts the map or its JSON text; anything invalid falls back
 * to "no fields, no total, no colour", so a board saved before this setting existed renders as before.
 */
export function normalizeObjectSettings(raw: unknown, entities: string[]): Record<string, ObjectSettings> {
	let value = raw;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			value = null;
		}
	}
	const map = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
	const result: Record<string, ObjectSettings> = {};
	for (const name of entities) {
		const item = map[name] && typeof map[name] === 'object' ? map[name] : {};
		// Boards saved before the layout editor have `fields` only: each becomes a plain line without an icon.
		const rawLayout: unknown[] = Array.isArray(item.layout) ? [...item.layout]
			: (Array.isArray(item.fields) ? item.fields : []).map((field: unknown) => ({ field }));
		// Boards saved before the due date became a layout row keep it as a separate dueField: it becomes the last row.
		const legacyDue = typeof item.dueField === 'string' && NAME.test(item.dueField) ? item.dueField : '';
		if (legacyDue && !rawLayout.some((e) => (e as Record<string, unknown>)?.['style'] === 'due')) {
			rawLayout.push({ field: legacyDue, icon: item.dueIcon, style: 'due' });
		}
		const layout: CardItem[] = [];
		for (const entry of rawLayout) {
			const e = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
			const field = e['field'];
			const existing = layout.find((l) => l.field === field);
			if (existing && e['style'] === 'due' && !layout.some((l) => l.style === 'due')) {
				existing.style = 'due'; // the legacy due field was also a plain card field: one row, shown as the due date
				continue;
			}
			if (typeof field === 'string' && NAME.test(field) && !existing && layout.length < MAX_CARD_FIELDS) {
				const style: CardItemStyle = e['style'] === 'due' && !layout.some((l) => l.style === 'due') ? 'due'
					: e['style'] === 'tag' || e['style'] === 'due' ? 'tag' : 'line';
				layout.push({ field, icon: typeof e['icon'] === 'string' && ICON_SET.has(e['icon']) ? e['icon'] : '', style });
			}
		}
		const fields = layout.map((l) => l.field);
		const due = layout.find((l) => l.style === 'due');
		result[name] = {
			fields,
			sumField: typeof item.sumField === 'string' && NAME.test(item.sumField) ? item.sumField : '',
			color: typeof item.color === 'string' && Object.hasOwn(COLORS, item.color) ? item.color : '',
			statusColumn: typeof item.statusColumn === 'string' && NAME.test(item.statusColumn) ? item.statusColumn : '',
			dueField: due?.field ?? '',
			dueIcon: due?.icon ?? '',
			...(item.dueSoonDays === undefined || item.dueSoonDays === null ? {} : { dueSoonDays: normalizeDueSoonDays(item.dueSoonDays) }),
			locked: item.locked === true,
			layout,
		};
	}
	return result;
}

/**
 * Card text of a column value by its DataValueType. Dates arrive as ISO-like text; a date-only value is shown as is
 * (no time zone shift). `locale` is for tests; the board passes undefined (the browser's locale).
 */
export function formatValue(value: unknown, dataValueType: number, locale?: string): string {
	if (value === null || value === undefined || value === '') {
		return '';
	}
	if (dataValueType === VALUE_TYPES.lookup || (typeof value === 'object' && 'displayValue' in (value as object))) {
		const text = (value as { displayValue?: unknown }).displayValue;
		return typeof text === 'string' ? text : '';
	}
	if (dataValueType === VALUE_TYPES.boolean) {
		return value === true || value === 'true' ? 'Yes' : 'No';
	}
	if (VALUE_TYPES.numeric.has(dataValueType)) {
		const n = typeof value === 'number' ? value : Number(value);
		if (!Number.isFinite(n)) {
			return '';
		}
		const digits = VALUE_TYPES.integer.has(dataValueType) ? 0 : 2;
		return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
	}
	if (value instanceof Date) {
		// sdk.Model returns date columns as Date objects already in the user's time zone: format them locally.
		if (Number.isNaN(value.getTime())) {
			return '';
		}
		if (dataValueType === VALUE_TYPES.time) {
			return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(value);
		}
		const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
		if (dataValueType !== VALUE_TYPES.date) {
			options.hour = '2-digit';
			options.minute = '2-digit';
		}
		return new Intl.DateTimeFormat(locale, options).format(value);
	}
	if (dataValueType === VALUE_TYPES.date || dataValueType === VALUE_TYPES.dateTime) {
		const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value));
		if (!m) {
			return String(value);
		}
		// Built from the parts in UTC and formatted in UTC: what the record holds is what the card shows.
		const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)));
		const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' };
		if (dataValueType === VALUE_TYPES.dateTime) {
			options.hour = '2-digit';
			options.minute = '2-digit';
		}
		return new Intl.DateTimeFormat(locale, options).format(date);
	}
	if (dataValueType === VALUE_TYPES.time) {
		const m = /(\d{2}):(\d{2})/.exec(String(value));
		return m ? `${m[1]}:${m[2]}` : String(value);
	}
	return typeof value === 'object' ? '' : String(value);
}

/** Sortable text of a date value (Date object or ISO-like text); '' when empty or invalid. */
export function toSortableDate(value: unknown): string {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? '' : value.toISOString();
	}
	return typeof value === 'string' ? value : '';
}

/** Number of a total-field value, or null when it is empty or not a number. */
export function toNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') {
		return null;
	}
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : null;
}

/** Sum of the cards' totals, or null when none of them has one (the header then shows the count only). */
export type TotalMode = 'sum' | 'avg' | 'min' | 'max';

export const TOTAL_MODES: Record<TotalMode, string> = { sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum' };

export function normalizeTotalMode(raw: unknown): TotalMode {
	return typeof raw === 'string' && Object.hasOwn(TOTAL_MODES, raw) ? raw as TotalMode : 'sum';
}

/** The column total in the chosen mode over the cards that have a value; null when none has. */
export function totalOf(cards: Card[], mode: TotalMode): number | null {
	const values = cards.map((c) => c.sum).filter((v): v is number => typeof v === 'number');
	if (!values.length) {
		return null;
	}
	const raw = mode === 'avg' ? values.reduce((a, b) => a + b, 0) / values.length
		: mode === 'min' ? Math.min(...values) : mode === 'max' ? Math.max(...values) : values.reduce((a, b) => a + b, 0);
	return Math.round(raw * 100) / 100;
}

/**
 * How close a due date is. A date-only value is due at the end of that day; `soonDays` 0 = never "soon".
 */
export function dueStateOf(value: unknown, dateOnly: boolean, now: number, soonDays: number): DueState {
	const date = value instanceof Date ? new Date(value.getTime()) : typeof value === 'string' && value ? new Date(value) : null;
	if (!date || Number.isNaN(date.getTime())) {
		return '';
	}
	if (dateOnly) {
		date.setHours(23, 59, 59, 999);
	}
	const left = date.getTime() - now;
	return left < 0 ? 'overdue' : left <= soonDays * 86400000 ? 'soon' : 'ok';
}

/** 0-365 days, default 3. */
export function normalizeDueSoonDays(raw: unknown): number {
	return toLimit(raw, 365) ?? 3;
}

/** The palette colour closest to a hex colour (lookup values such as ActivityStatus.Color); '' for anything else. */
export function nearestColor(hex: unknown): string {
	const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
	if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex.trim())) {
		return '';
	}
	const [r, g, b] = rgb(hex.trim());
	let best = '';
	let bestDistance = Infinity;
	for (const [key, value] of Object.entries(COLORS)) {
		const [r2, g2, b2] = rgb(value);
		const distance = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
		if (distance < bestDistance) {
			best = key;
			bestDistance = distance;
		}
	}
	return best;
}

/**
 * Stages for the values of an object's field that no stage maps yet, appended in the given order (one value each,
 * colour from the value when it has one). Stops at MAX_STAGES; `skipped` counts the values left out.
 */
export function stagesFromValues(stages: Stage[], entityName: string,
	values: Array<{ id: string; caption: string; color?: string }>): { stages: Stage[]; added: number; skipped: number } {
	const mapped = new Set(stages.flatMap((s) => s.statusValues?.[entityName] ?? []));
	const result = [...stages];
	let added = 0;
	let skipped = 0;
	for (const value of values) {
		const id = value.id.toLowerCase();
		if (mapped.has(id)) {
			continue;
		}
		if (result.length >= MAX_STAGES) {
			skipped++;
			continue;
		}
		const stage: Stage = { id: newStageId(), caption: value.caption.slice(0, 100), statusValues: { [entityName]: [id] } };
		const color = nearestColor(value.color);
		if (color) {
			stage.color = color;
		}
		result.push(stage);
		mapped.add(id);
		added++;
	}
	return { stages: result, added, skipped };
}

export function sumCards(cards: Card[]): number | null {
	let total: number | null = null;
	for (const card of cards) {
		if (typeof card.sum === 'number') {
			total = (total ?? 0) + card.sum;
		}
	}
	return total === null ? null : Math.round(total * 100) / 100;
}

export function formatTotal(total: number, locale?: string): string {
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(total);
}

/** A sorted copy. Manual = the stored order; Total = largest first, cards without a total last; Newest = latest added. */
export function sortCards(cards: Card[], mode: SortMode): Card[] {
	const copy = [...cards];
	switch (mode) {
		case 'title':
			return copy.sort((a, b) => a.title.localeCompare(b.title) || a.position - b.position);
		case 'total':
			return copy.sort((a, b) => (b.sum ?? -Infinity) - (a.sum ?? -Infinity) || a.position - b.position);
		case 'newest':
			return copy.sort((a, b) => (b.addedOn ?? '').localeCompare(a.addedOn ?? '') || a.position - b.position);
		default:
			return copy.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
	}
}

export function isSortMode(value: unknown): value is SortMode {
	return value === 'manual' || value === 'title' || value === 'total' || value === 'newest';
}

/** A whole number from 1 to max, or null (empty, zero, negative, fraction, text). */
export function toLimit(value: unknown, max: number): number | null {
	const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
	return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between `since` (ISO text) and `now`; 0 when unknown or in the future. */
export function daysInStage(since: string | undefined, now: number): number {
	const t = since ? Date.parse(since) : NaN;
	return Number.isNaN(t) || t > now ? 0 : Math.floor((now - t) / DAY_MS);
}

export function formatAge(days: number): string {
	return days <= 0 ? 'today' : `${days} d`;
}

/**
 * Sets `stale` on every card: past the rotDays of the stage it is shown in (an orphan is shown in the first stage).
 * A stage without rotDays never makes a card stale.
 */
export function markStale(cards: Card[], stages: Stage[], now: number): void {
	const byId = new Map(stages.map((s) => [s.id, s]));
	for (const card of cards) {
		const stage = byId.get(card.stageCode) ?? stages[0];
		card.stale = !!stage?.rotDays && daysInStage(card.stageSince, now) >= stage.rotDays;
	}
}

export type WipState = 'none' | 'ok' | 'full' | 'over';

/** none: no limit; ok: below; full: at the limit; over: above it. */
export function wipState(count: number, limit: number | undefined): WipState {
	if (!limit) {
		return 'none';
	}
	return count > limit ? 'over' : count === limit ? 'full' : 'ok';
}

function plainMap(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** { object: lookupId } with valid object names and GUIDs only; null when nothing is left. */
function cleanStatusValues(value: unknown): Record<string, string[]> | null {
	const map = plainMap(value);
	if (!map) {
		return null;
	}
	const result: Record<string, string[]> = {};
	for (const [name, raw] of Object.entries(map)) {
		// A board saved before several values were allowed stores one Id as a string.
		const ids = (Array.isArray(raw) ? raw : [raw])
			.filter((id): id is string => typeof id === 'string' && GUID.test(id)).map((id) => id.toLowerCase());
		if (NAME.test(name) && ids.length) {
			result[name] = [...new Set(ids)].slice(0, MAX_STATUS_VALUES);
		}
	}
	return Object.keys(result).length ? result : null;
}

/** { object: [column, ...] } with valid names, unique, at most MAX_REQUIRED_FIELDS each; null when nothing is left. */
function cleanRequiredFields(value: unknown): Record<string, string[]> | null {
	const map = plainMap(value);
	if (!map) {
		return null;
	}
	const result: Record<string, string[]> = {};
	for (const [name, list] of Object.entries(map)) {
		if (!NAME.test(name) || !Array.isArray(list)) {
			continue;
		}
		const fields = [...new Set(list.filter((f): f is string => typeof f === 'string' && NAME.test(f)))].slice(0, MAX_REQUIRED_FIELDS);
		if (fields.length) {
			result[name] = fields;
		}
	}
	return Object.keys(result).length ? result : null;
}

/** The first stage (left to right) that maps this object's status value, or undefined. */
export function stageForStatus(stages: Stage[], entityName: string, statusId: string | null | undefined): Stage | undefined {
	if (!statusId) {
		return undefined;
	}
	const id = statusId.toLowerCase();
	return stages.find((s) => s.statusValues?.[entityName]?.includes(id));
}

/**
 * The value to write when a card enters `stage`: none when the stage maps no value for the object or the record already
 * has one of the stage's values (`current` unknown = undefined: the first value is written).
 */
export function statusToWrite(stage: Stage | undefined, entityName: string, current: string | null | undefined): string | undefined {
	const values = stage?.statusValues?.[entityName];
	if (!values?.length || (current && values.includes(current.toLowerCase()))) {
		return undefined;
	}
	return values[0];
}

/** Status values whose records are put on the board by themselves (stages with auto-add for this object). */
export function autoAddValues(stages: Stage[], entityName: string): string[] {
	return [...new Set(stages.filter((s) => s.autoAdd?.[entityName]).flatMap((s) => s.statusValues?.[entityName] ?? []))];
}

/**
 * Records not on the board whose status maps to an auto-add stage, with that stage, at most `limit`.
 * The first stage mapped to a status decides (as in reconcileStages); `onBoard` holds lower-case record ids.
 */
export function autoAddTargets(stages: Stage[], entityName: string, records: Array<{ id: string; statusId: string | null }>,
	onBoard: Set<string>, limit: number): Array<{ recordId: string; stageCode: string }> {
	const result: Array<{ recordId: string; stageCode: string }> = [];
	for (const record of records) {
		const stage = stageForStatus(stages, entityName, record.statusId);
		if (result.length < limit && stage?.autoAdd?.[entityName] && !onBoard.has(record.id.toLowerCase())) {
			onBoard.add(record.id.toLowerCase());
			result.push({ recordId: record.id, stageCode: stage.id });
		}
	}
	return result;
}

/**
 * The same board, object and record always give the same card Id, so two viewers auto-adding one record at once
 * collide on the primary key instead of creating a duplicate card.
 */
export function cardIdFor(boardCode: string, entityName: string, recordId: string): string {
	return stableId(boardCode, entityName, recordId.toLowerCase());
}

/** A GUID that depends only on the parts: rows several boards would write for one event share it. Not a security hash. */
export function stableId(...parts: string[]): string {
	const text = parts.join('|');
	const hex = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map((seed) => {
		let h = seed;
		for (let i = 0; i < text.length; i++) {
			h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
		}
		h = Math.imul(h ^ (h >>> 16), 0x2c1b3c6d);
		h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
		return ((h ^ (h >>> 16)) >>> 0).toString(16).padStart(8, '0');
	}).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The record is the truth: a card whose record status maps to another stage is moved there (stageCode set, placed at
 * the end of that stage). Returns the moved cards with the stage they came from; their rows must be saved.
 * A status no stage maps, a card already in its mapped stage, and a card in a stage that maps no value for its
 * object ("don't change": put there on purpose) are left alone.
 */
export function reconcileStages(cards: Card[], stages: Stage[]): Array<{ card: Card; fromCode: string }> {
	const moved: Array<{ card: Card; fromCode: string }> = [];
	const nextInStage = new Map<string, number>();
	for (const card of cards) {
		nextInStage.set(card.stageCode, Math.max(nextInStage.get(card.stageCode) ?? 0, card.position + POSITION_STEP));
	}
	for (const card of cards) {
		const target = stageForStatus(stages, card.entityName, card.statusId);
		const current = stages.find((s) => s.id === card.stageCode);
		const currentValues = current?.statusValues?.[card.entityName];
		// Stays: no stage has the value, the card's own stage has it too, or its stage is "don't change" (put there on purpose).
		if (!target || target.id === card.stageCode || (current && (!currentValues?.length
			|| currentValues.includes(String(card.statusId).toLowerCase())))) {
			continue;
		}
		moved.push({ card, fromCode: card.stageCode });
		card.stageCode = target.id;
		card.position = nextInStage.get(target.id) ?? 0;
		nextInStage.set(target.id, card.position + POSITION_STEP);
	}
	return moved;
}

/** Required columns of `stage` for this object that are empty in `record` (null, '', empty lookup, NaN). */
export function missingRequired(stage: Stage | undefined, entityName: string, record: Record<string, unknown>): string[] {
	const required = stage?.requiredFields?.[entityName] ?? [];
	return required.filter((name) => isEmptyValue(record[name]));
}

export function isEmptyValue(value: unknown): boolean {
	if (value === null || value === undefined) {
		return true;
	}
	if (typeof value === 'string') {
		return !value.trim();
	}
	if (typeof value === 'number') {
		return Number.isNaN(value);
	}
	if (value instanceof Date) {
		return Number.isNaN(value.getTime());
	}
	if (typeof value === 'object' && 'value' in (value as object)) {
		const v = (value as { value?: unknown }).value;
		return v === null || v === undefined || v === '';
	}
	return false;
}

/** Lookup value Id of a lookup attribute as sdk.Model returns it ({ value, displayValue }) or a plain Id. */
export function lookupId(value: unknown): string | null {
	const id = value && typeof value === 'object' ? (value as { value?: unknown }).value : value;
	return typeof id === 'string' && GUID.test(id) ? id.toLowerCase() : null;
}

export type SwimlaneMode = 'none' | 'owner' | 'object';

export interface Lane {
	key: string;
	caption: string;
	count: number;
}

export const NO_OWNER = 'No owner';

export function normalizeSwimlanes(value: unknown): SwimlaneMode {
	return value === 'owner' || value === 'object' ? value : 'none';
}

/** Refresh interval in seconds: 0 (off) to 600; anything invalid gives the default 30. */
export function normalizeRefresh(value: unknown): number {
	const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
	return Number.isInteger(n) && n >= 0 && n <= 600 ? n : 30;
}

/** The lane a card belongs to: its owner's contact id ('' = no owner) or its object name. */
export function laneKey(card: Card, mode: SwimlaneMode): string {
	return mode === 'owner' ? (card.ownerId ?? '') : mode === 'object' ? card.entityName : '';
}

/**
 * Lanes of the given cards, sorted by caption; the "No owner" lane is last. `caption` names an object lane
 * (its object caption). Mode 'none' gives one lane with all cards.
 */
export function lanesOf(cards: Card[], mode: SwimlaneMode, caption: (entityName: string) => string): Lane[] {
	if (mode === 'none') {
		return [{ key: '', caption: '', count: cards.length }];
	}
	const lanes = new Map<string, Lane>();
	for (const card of cards) {
		const key = laneKey(card, mode);
		const lane = lanes.get(key) ?? {
			key,
			caption: mode === 'owner' ? (key ? card.ownerName || key : NO_OWNER) : caption(card.entityName),
			count: 0,
		};
		lane.count++;
		lanes.set(key, lane);
	}
	return [...lanes.values()].sort((a, b) =>
		Number(mode === 'owner' && !a.key) - Number(mode === 'owner' && !b.key) || a.caption.localeCompare(b.caption));
}

/** Owner filter as the user picked it: 'any', 'me', 'none' or an owner's contact id. */
export type OwnerChoice = string;

export function isOwnerChoice(value: unknown): value is OwnerChoice {
	return value === 'any' || value === 'me' || value === 'none' || (typeof value === 'string' && GUID.test(value));
}

export interface StoredFilters {
	text: string;
	entityName: string;
	owner: OwnerChoice;
	staleOnly: boolean;
	dueOnly: boolean;
	sortMode: SortMode;
}

/** Filters read back from storage: anything malformed falls back to "no filter". */
export function parseStoredFilters(raw: string | null): StoredFilters {
	const empty: StoredFilters = { text: '', entityName: '', owner: 'any', staleOnly: false, dueOnly: false, sortMode: 'manual' };
	if (!raw) {
		return empty;
	}
	try {
		const v = JSON.parse(raw);
		if (!v || typeof v !== 'object') {
			return empty;
		}
		return {
			text: typeof v.text === 'string' ? v.text.slice(0, 200) : '',
			entityName: typeof v.entityName === 'string' && NAME.test(v.entityName) ? v.entityName : '',
			// `mine` is the boolean saved before the owner filter became a list.
			owner: isOwnerChoice(v.owner) ? v.owner : v.mine === true ? 'me' : 'any',
			staleOnly: v.staleOnly === true,
			dueOnly: v.dueOnly === true,
			sortMode: isSortMode(v.sortMode) ? v.sortMode : 'manual',
		};
	} catch {
		return empty;
	}
}

export function hasActiveFilter(f: StoredFilters): boolean {
	return !!f.text.trim() || !!f.entityName || f.owner !== 'any' || f.staleOnly || f.dueOnly || f.sortMode !== 'manual';
}

export interface OwnerOption {
	id: string;
	name: string;
}

/** Distinct owners of the cards, sorted by name (cards without an owner are not listed; see hasUnowned). */
export function ownerOptions(cards: Card[]): OwnerOption[] {
	const byId = new Map<string, string>();
	for (const card of cards) {
		if (card.ownerId && !byId.has(card.ownerId)) {
			byId.set(card.ownerId, card.ownerName || card.ownerId);
		}
	}
	return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function hasUnowned(cards: Card[]): boolean {
	return cards.some((c) => !c.ownerId);
}

/** Which filter controls the board shows; each can be switched off in the widget settings. */
export interface FilterToggles {
	search: boolean;
	object: boolean;
	owner: boolean;
	stale: boolean;
	due: boolean;
	sort: boolean;
	/** Toolbar actions next to the filters: switched off like them. */
	compact: boolean;
	refresh: boolean;
	addCard: boolean;
}

export const FILTER_KEYS: Array<keyof FilterToggles> = ['search', 'object', 'owner', 'stale', 'due', 'sort', 'compact', 'refresh', 'addCard'];

/** Every filter on unless explicitly false; anything malformed shows all. */
export function normalizeFilterToggles(raw: unknown): FilterToggles {
	const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
	const result = {} as FilterToggles;
	for (const key of FILTER_KEYS) {
		result[key] = map[key] !== false;
	}
	return result;
}

/** A switched-off filter must not keep filtering: its stored value is reset. */
export function applyToggles(f: StoredFilters, t: FilterToggles): StoredFilters {
	return {
		text: t.search ? f.text : '',
		entityName: t.object ? f.entityName : '',
		owner: t.owner ? f.owner : 'any',
		staleOnly: t.stale ? f.staleOnly : false,
		dueOnly: t.due ? f.dueOnly : false,
		sortMode: t.sort ? f.sortMode : 'manual',
	};
}

/** dd.mm.yy HH:mm in local time (history rows); '' for an empty or invalid value. */
export function formatShortDateTime(value: unknown): string {
	const date = value instanceof Date ? value : typeof value === 'string' && value ? new Date(value) : null;
	if (!date || Number.isNaN(date.getTime())) {
		return '';
	}
	const two = (n: number) => String(n).padStart(2, '0');
	return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${two(date.getFullYear() % 100)} ${two(date.getHours())}:${two(date.getMinutes())}`;
}
