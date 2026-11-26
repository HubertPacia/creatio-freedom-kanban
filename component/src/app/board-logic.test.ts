// Run: node src/app/board-logic.test.ts (Node 22.6+ strips the types). Not part of the bundle.
import assert from 'node:assert/strict';
import {
	DEFAULT_STAGES, formatTotal, formatValue, groupByStage, isSortMode, matchesFilter, MAX_STAGES, moveCard, nextPosition,
	normalizeEntities, normalizeObjectSettings, normalizeStages, sortCards, sumCards, toNumber, toSortableDate,
	daysInStage, formatAge, markStale, toLimit, wipState, stageForStatus, reconcileStages, missingRequired, isEmptyValue, lookupId,
	lanesOf, laneKey, normalizeSwimlanes, normalizeRefresh, parseStoredFilters, hasActiveFilter, NO_OWNER,
	ownerOptions, hasUnowned, normalizeFilterToggles, applyToggles, formatShortDateTime,
	autoAddValues, autoAddTargets, cardIdFor, stableId, statusToWrite,
	totalOf, normalizeTotalMode, dueStateOf, normalizeDueSoonDays, nearestColor, stagesFromValues,
	MAX_CARD_FIELDS, ICON_NAMES, iconUrl,
} from './board-logic.ts';
import type { Card } from './board-logic.ts';

const card = (id: string, stageCode: string, position: number, extra: Partial<Card> = {}): Card => ({
	id, stageCode, position, entityName: 'Activity', recordId: 'r' + id, title: 'Card ' + id, ownerId: null, ownerName: '',
	...extra,
});

// normalizeStages
assert.deepEqual(normalizeStages(null), DEFAULT_STAGES);
assert.deepEqual(normalizeStages([]), DEFAULT_STAGES);
assert.deepEqual(normalizeStages('not json'), DEFAULT_STAGES);
assert.deepEqual(normalizeStages([{ id: 'a', caption: ' New ' }, { id: 'b', caption: 'Won' }]),
	[{ id: 'a', caption: 'New' }, { id: 'b', caption: 'Won' }]);
assert.deepEqual(normalizeStages(JSON.stringify([{ id: 'a', caption: 'New' }])), [{ id: 'a', caption: 'New' }]);
assert.deepEqual(normalizeStages(['Open', 'Closed']), [{ id: 'Open', caption: 'Open' }, { id: 'Closed', caption: 'Closed' }]);
const dup = normalizeStages([{ id: 'a', caption: 'One' }, { id: 'a', caption: 'Two' }, { id: 'x', caption: '  ' }]);
assert.equal(dup.length, 2);
assert.notEqual(dup[0].id, dup[1].id);
assert.equal(normalizeStages(Array.from({ length: 20 }, (_, i) => 'S' + i)).length, MAX_STAGES);

// normalizeEntities
assert.deepEqual(normalizeEntities(' Activity, Account ,Activity,, bad name ,1x'), ['Activity', 'Account']);
assert.deepEqual(normalizeEntities(['Case', 'Case', 7]), ['Case']);
assert.deepEqual(normalizeEntities(undefined), []);

// matchesFilter
const owned = card('1', 'a', 0, { title: 'Call Warsaw', entityName: 'Activity', ownerId: 'me' });
const none = { text: '', entityName: '', ownerId: null };
assert.ok(matchesFilter(owned, none));
assert.ok(matchesFilter(owned, { ...none, text: 'warsaw' }));
assert.ok(!matchesFilter(owned, { ...none, text: 'berlin' }));
assert.ok(!matchesFilter(owned, { ...none, entityName: 'Account' }));
assert.ok(matchesFilter(owned, { ...none, ownerId: 'me' }));
assert.ok(!matchesFilter(owned, { ...none, ownerId: 'other' }));
assert.ok(!matchesFilter(card('2', 'a', 0), { ...none, ownerId: 'me' }), 'no owner is not mine');
assert.ok(matchesFilter(card('2', 'a', 0), { ...none, ownerId: '' }), "'' = cards without an owner");
assert.ok(!matchesFilter(owned, { ...none, ownerId: '' }));

// groupByStage: order, orphans to the first stage
const stages = [{ id: 'a', caption: 'A' }, { id: 'b', caption: 'B' }];
const grouped = groupByStage([card('1', 'b', 1), card('2', 'b', 0), card('3', 'gone', 5), card('4', 'a', 0)], stages);
assert.deepEqual([...grouped.keys()], ['a', 'b']);
assert.deepEqual(grouped.get('a')!.map((c) => c.id), ['4', '3']);
assert.deepEqual(grouped.get('b')!.map((c) => c.id), ['2', '1']);
assert.equal(groupByStage([card('1', 'a', 0)], []).size, 0);

// moveCard across stages: only the moved card is written when its neighbours leave room
const cols = groupByStage([card('1', 'a', 0), card('2', 'a', 1000), card('3', 'b', 0)], stages);
const changed = moveCard(cols, '1', 'b', 0);
assert.deepEqual(cols.get('a')!.map((c) => c.id), ['2']);
assert.deepEqual(cols.get('b')!.map((c) => c.id), ['1', '3']);
assert.deepEqual(changed.map((c) => [c.id, c.stageCode, c.position]), [['1', 'b', -1000]], 'top: one step above');
assert.deepEqual(moveCard(cols, '2', 'b', 1).map((c) => [c.id, c.position]), [['2', -500]], 'between: the middle');
assert.deepEqual(moveCard(cols, '1', 'b', 9).map((c) => [c.id, c.position]), [['1', 1000]], 'end: one step below');
assert.deepEqual(cols.get('b')!.map((c) => c.id), ['2', '3', '1']);

// no room between neighbours (old rows 0,1,2): the column is renumbered once, index clamped, no-op moves write nothing
const same = groupByStage([card('1', 'a', 0), card('2', 'a', 1), card('3', 'a', 2)], stages);
assert.deepEqual(moveCard(same, '3', 'a', 1).map((c) => [c.id, c.position]), [['3', 1000], ['2', 2000]]);
assert.deepEqual(same.get('a')!.map((c) => c.id), ['1', '3', '2']);
assert.deepEqual(moveCard(same, '2', 'a', 99).map((c) => c.id), [], 'already last');
assert.deepEqual(moveCard(same, '1', 'a', 0).map((c) => c.id), [], 'dropped where it was');
assert.deepEqual(same.get('a')!.map((c) => c.id), ['1', '3', '2']);
assert.deepEqual(moveCard(groupByStage([card('1', 'a', 0)], stages), '1', 'b', 0).map((c) => c.position), [0], 'empty column');
assert.deepEqual(moveCard(same, 'nope', 'a', 0), []);
assert.deepEqual(moveCard(same, '1', 'nope', 0), []);

// an orphan moved within the first stage gets its stage fixed
const orphan = groupByStage([card('1', 'gone', 0)], stages);
assert.deepEqual(moveCard(orphan, '1', 'a', 0).map((c) => c.stageCode), ['a']);

// nextPosition
assert.equal(nextPosition(undefined), 0);
assert.equal(nextPosition([card('1', 'a', 4), card('2', 'a', 1)]), 1004);

// stage colours: palette keys only
assert.deepEqual(normalizeStages([{ id: 'a', caption: 'A', color: 'red' }, { id: 'b', caption: 'B', color: 'url(x)' }]),
	[{ id: 'a', caption: 'A', color: 'red' }, { id: 'b', caption: 'B' }]);

// normalizeObjectSettings
const settings = normalizeObjectSettings({
	Account: { fields: ['Owner', 'Owner', 'Bad name', 'Web', 'Phone', 'Type', 'Extra'], sumField: 'AnnualRevenue', color: 'teal' },
	Contact: { fields: ['Name'] },
	Activity: { sumField: 'x;y', color: '#fff' },
}, ['Account', 'Activity', 'Case']);
assert.deepEqual(Object.keys(settings), ['Account', 'Activity', 'Case'], 'only allowed objects, all present');
const line = (field: string) => ({ field, icon: '', style: 'line' });
assert.deepEqual(settings['Account'], { fields: ['Owner', 'Web', 'Phone', 'Type', 'Extra'], sumField: 'AnnualRevenue', color: 'teal',
	statusColumn: '', dueField: '', dueIcon: '', locked: false, layout: ['Owner', 'Web', 'Phone', 'Type', 'Extra'].map(line) }, 'old `fields` become plain lines');
assert.deepEqual(settings['Activity'], { fields: [], sumField: '', color: '', statusColumn: '', dueField: '', dueIcon: '', locked: false, layout: [] });
assert.deepEqual(settings['Case'], { fields: [], sumField: '', color: '', statusColumn: '', dueField: '', dueIcon: '', locked: false, layout: [] });
assert.deepEqual(normalizeObjectSettings('{"Account":{"color":"red"}}', ['Account'])['Account'].color, 'red');
assert.deepEqual(normalizeObjectSettings('nope', ['Account'])['Account'], { fields: [], sumField: '', color: '', statusColumn: '', dueField: '', dueIcon: '', locked: false, layout: [] });
assert.equal(normalizeObjectSettings({ Activity: { statusColumn: 'Status' } }, ['Activity'])['Activity'].statusColumn, 'Status');
assert.equal(normalizeObjectSettings({ Activity: { statusColumn: 'bad name' } }, ['Activity'])['Activity'].statusColumn, '');
assert.deepEqual(normalizeObjectSettings(['x'], ['Account'])['Account'].fields, []);

// formatValue
assert.equal(formatValue(null, 1), '');
assert.equal(formatValue('', 1), '');
assert.equal(formatValue('Hello', 1), 'Hello');
assert.equal(formatValue({ value: 'id', displayValue: 'Supervisor' }, 10), 'Supervisor');
assert.equal(formatValue({ value: 'id', displayValue: 'Mr' }, 1), 'Mr', 'lookup shape wins over the declared type');
assert.equal(formatValue(true, 12), 'Yes');
assert.equal(formatValue(false, 12), 'No');
assert.equal(formatValue(1234.5, 6, 'en-US'), '1,234.50');
assert.equal(formatValue('1234.5', 5, 'en-US'), '1,234.50');
assert.equal(formatValue(42, 4, 'en-US'), '42');
assert.equal(formatValue('abc', 6, 'en-US'), '');
assert.equal(formatValue('2026-11-22T00:00:00', 8, 'en-US'), 'Nov 22, 2026', 'date only, no time zone shift');
assert.equal(formatValue('2026-11-22T13:05:00.000', 7, 'en-GB'), '22 Nov 2026, 13:05');
assert.equal(formatValue('not a date', 8, 'en-US'), 'not a date');
assert.equal(formatValue('1970-01-01T09:30:00', 9), '09:30');
assert.equal(formatValue({ nested: true }, 1), '');
// sdk.Model gives Date objects (local time): formatted locally, never as Date.toString()
assert.equal(formatValue(new Date(2026, 10, 23, 10, 30), 7, 'en-GB'), '23 Nov 2026, 10:30');
assert.equal(formatValue(new Date(2026, 10, 23, 10, 30), 8, 'en-GB'), '23 Nov 2026');
assert.equal(formatValue(new Date(2026, 10, 23, 9, 5), 9, 'en-GB'), '09:05');
assert.equal(formatValue(new Date('nope'), 7, 'en-GB'), '');
assert.equal(toSortableDate(new Date(Date.UTC(2026, 10, 22, 10))), '2026-11-22T10:00:00.000Z');
assert.equal(toSortableDate('2026-11-22T10:00:00'), '2026-11-22T10:00:00');
assert.equal(toSortableDate(null), '');
assert.equal(toSortableDate(new Date('nope')), '');

// toNumber / sumCards / formatTotal
assert.equal(toNumber('12.5'), 12.5);
assert.equal(toNumber(''), null);
assert.equal(toNumber('x'), null);
assert.equal(toNumber(0), 0);
assert.equal(sumCards([card('1', 'a', 0), card('2', 'a', 1)]), null, 'no totals: null, header shows count only');
assert.equal(sumCards([card('1', 'a', 0, { sum: 10.1 }), card('2', 'a', 1, { sum: 0.2 }), card('3', 'a', 2, { sum: null })]), 10.3);
assert.equal(formatTotal(1234567.891, 'en-US'), '1,234,567.89');

// sortCards: copy, all modes
const sortable = [
	card('1', 'a', 2, { title: 'Bravo', sum: 5, addedOn: '2026-11-20T10:00:00' }),
	card('2', 'a', 0, { title: 'alpha', sum: null, addedOn: '2026-11-22T10:00:00' }),
	card('3', 'a', 1, { title: 'Charlie', sum: 50, addedOn: '2026-11-21T10:00:00' }),
];
assert.deepEqual(sortCards(sortable, 'manual').map((c) => c.id), ['2', '3', '1']);
assert.deepEqual(sortCards(sortable, 'title').map((c) => c.id), ['2', '1', '3']);
assert.deepEqual(sortCards(sortable, 'total').map((c) => c.id), ['3', '1', '2'], 'largest first, empty last');
assert.deepEqual(sortCards(sortable, 'newest').map((c) => c.id), ['2', '3', '1']);
assert.deepEqual(sortable.map((c) => c.id), ['1', '2', '3'], 'input not mutated');
assert.ok(isSortMode('total') && !isSortMode('random'));

// stage limits survive normalisation; bad values are dropped
assert.deepEqual(normalizeStages([{ id: 'a', caption: 'A', wipLimit: 5, rotDays: '7' }, { id: 'b', caption: 'B', wipLimit: 0, rotDays: 2.5 }]),
	[{ id: 'a', caption: 'A', wipLimit: 5, rotDays: 7 }, { id: 'b', caption: 'B' }]);
assert.equal(toLimit('12', 999), 12);
assert.equal(toLimit(-1, 999), null);
assert.equal(toLimit(1000, 999), null);
assert.equal(toLimit('', 999), null);
assert.equal(toLimit(null, 999), null);

// wipState
assert.equal(wipState(3, undefined), 'none');
assert.equal(wipState(3, 5), 'ok');
assert.equal(wipState(5, 5), 'full');
assert.equal(wipState(6, 5), 'over');

// ageing
const NOW = Date.parse('2026-11-22T12:00:00Z');
assert.equal(daysInStage('2026-11-22T11:00:00Z', NOW), 0);
assert.equal(daysInStage('2026-11-19T11:59:00Z', NOW), 3);
assert.equal(daysInStage(undefined, NOW), 0);
assert.equal(daysInStage('garbage', NOW), 0);
assert.equal(daysInStage('2026-11-30T00:00:00Z', NOW), 0, 'future (clock skew) is today');
assert.equal(formatAge(0), 'today');
assert.equal(formatAge(4), '4 d');

// markStale: per stage rotDays, orphans use the first stage, no rotDays never stale
const rotStages = [{ id: 'a', caption: 'A', rotDays: 3 }, { id: 'b', caption: 'B' }];
const aging = [
	card('1', 'a', 0, { stageSince: '2026-11-18T12:00:00Z' }),
	card('2', 'a', 1, { stageSince: '2026-11-21T12:00:00Z' }),
	card('3', 'b', 0, { stageSince: '2026-01-01T00:00:00Z' }),
	card('4', 'gone', 0, { stageSince: '2026-11-01T00:00:00Z' }),
];
markStale(aging, rotStages, NOW);
assert.deepEqual(aging.map((c) => c.stale), [true, false, false, true]);
assert.ok(matchesFilter(aging[0], { text: '', entityName: '', ownerId: null, staleOnly: true }));
assert.ok(!matchesFilter(aging[1], { text: '', entityName: '', ownerId: null, staleOnly: true }));

// status mapping and required fields survive normalisation; junk is dropped
const NS = '384D4B84-58E6-DF11-971B-001D60E938C6';
const IP = '394d4b84-58e6-df11-971b-001d60e938c6';
const DONE = '4bdbb88f-58e6-df11-971b-001d60e938c6';
const mapped = normalizeStages([
	{ id: 'a', caption: 'A', statusValues: { Activity: NS, Account: 'not-a-guid', 'bad name': IP }, requiredFields: { Activity: ['Result', 'Result', 'x y'], Bad: 'Result' } },
	{ id: 'b', caption: 'B', statusValues: { Activity: IP } },
	{ id: 'c', caption: 'C', statusValues: {}, requiredFields: { Activity: [] } },
	{ id: 'd', caption: 'D', statusValues: { Activity: DONE }, requiredFields: { Activity: ['DetailedResult'] } },
]);
assert.deepEqual(mapped[0].statusValues, { Activity: [NS.toLowerCase()] }, 'one Id (old boards) becomes a list');
assert.deepEqual(mapped[0].requiredFields, { Activity: ['Result'] });
assert.equal(mapped[2].statusValues, undefined);
assert.equal(mapped[2].requiredFields, undefined);

// stageForStatus: first mapped stage, case-insensitive; no mapping -> undefined
assert.equal(stageForStatus(mapped, 'Activity', IP.toUpperCase())?.id, 'b');
assert.equal(stageForStatus(mapped, 'Account', IP), undefined);
assert.equal(stageForStatus(mapped, 'Activity', null), undefined);
assert.equal(stageForStatus([...mapped, { id: 'e', caption: 'E', statusValues: { Activity: [IP] } }], 'Activity', IP)?.id, 'b', 'first wins');

// several values per stage: list kept (deduped, GUIDs only); any of them maps; the first is written unless one is there
const multi = normalizeStages([
	{ id: 'open', caption: 'Open', statusValues: { Case: [NS, IP, NS.toLowerCase(), 'x'] } },
	{ id: 'shut', caption: 'Shut', statusValues: { Case: [DONE] } },
	{ id: 'free', caption: 'Free' },
]);
assert.deepEqual(multi[0].statusValues, { Case: [NS.toLowerCase(), IP] });
assert.equal(stageForStatus(multi, 'Case', IP)?.id, 'open');
assert.equal(statusToWrite(multi[0], 'Case', DONE), NS.toLowerCase(), 'not one of them: the first');
assert.equal(statusToWrite(multi[0], 'Case', IP.toUpperCase()), undefined, 'already one of them: unchanged');
assert.equal(statusToWrite(multi[0], 'Case', undefined), NS.toLowerCase(), 'unknown: the first');
assert.equal(statusToWrite(multi[2], 'Case', DONE), undefined, "don't change");
const multiCards = [card('1', 'open', 0, { entityName: 'Case', statusId: IP }), card('2', 'open', 1000, { entityName: 'Case', statusId: DONE })];
assert.deepEqual(reconcileStages(multiCards, multi).map((m) => [m.card.id, m.card.stageCode]), [['2', 'shut']], 'IP stays in Open, DONE moves');
const twice = normalizeStages([{ id: 'p', caption: 'P', statusValues: { Case: [IP] } }, { id: 'q', caption: 'Q', statusValues: { Case: [IP, DONE] } }]);
assert.deepEqual(reconcileStages([card('3', 'q', 0, { entityName: 'Case', statusId: IP })], twice), [], 'its own stage has the value too: stays');

// reconcileStages: record wins, unmapped status stays, placed at the end of the target stage
const sync = [
	card('1', 'a', 0, { statusId: DONE }),
	card('2', 'a', 1, { statusId: NS }),
	card('3', 'd', 0, { statusId: null }),
	card('4', 'b', 0, { statusId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }),
	card('5', 'd', 1, { statusId: IP, entityName: 'Account' }),
	card('6', 'c', 0, { statusId: DONE }),
];
const moved = reconcileStages(sync, mapped);
assert.deepEqual(moved.map((m) => [m.card.id, m.fromCode, m.card.stageCode, m.card.position]), [['1', 'a', 'd', 1001]]);
assert.equal(sync[5].stageCode, 'c', '"don\'t change" stage: left where the user put it');
assert.equal(sync[1].stageCode, 'a', 'already in its mapped stage');
assert.equal(sync[2].stageCode, 'd', 'no status: stays');
assert.equal(sync[3].stageCode, 'b', 'unmapped status: stays');
assert.equal(sync[4].stageCode, 'd', 'other object without mapping: stays');
assert.deepEqual(reconcileStages(sync, mapped), [], 'idempotent');

// missingRequired / isEmptyValue / lookupId
assert.deepEqual(missingRequired(mapped[3], 'Activity', { DetailedResult: '' }), ['DetailedResult']);
assert.deepEqual(missingRequired(mapped[3], 'Activity', { DetailedResult: 'done' }), []);
assert.deepEqual(missingRequired(mapped[3], 'Account', {}), [], 'other object: no rule');
assert.deepEqual(missingRequired(undefined, 'Activity', {}), []);
assert.ok(isEmptyValue(null) && isEmptyValue('  ') && isEmptyValue({ value: '', displayValue: '' }) && isEmptyValue(new Date('x')));
assert.ok(!isEmptyValue(0) && !isEmptyValue(false) && !isEmptyValue({ value: IP }) && !isEmptyValue(new Date()));
assert.equal(lookupId({ value: NS, displayValue: 'Not started' }), NS.toLowerCase());
assert.equal(lookupId(IP), IP);
assert.equal(lookupId({ value: 'x' }), null);
assert.equal(lookupId(null), null);

// swimlanes
const laneCards = [
	card('1', 'a', 0, { ownerId: 'u2', ownerName: 'Zoe', entityName: 'Activity' }),
	card('2', 'a', 1, { ownerId: null, ownerName: '', entityName: 'Account' }),
	card('3', 'b', 0, { ownerId: 'u1', ownerName: 'Adam', entityName: 'Activity' }),
	card('4', 'b', 1, { ownerId: 'u2', ownerName: 'Zoe', entityName: 'Account' }),
];
const cap = (n: string) => (n === 'Activity' ? 'Task' : n);
assert.deepEqual(lanesOf(laneCards, 'owner', cap), [
	{ key: 'u1', caption: 'Adam', count: 1 }, { key: 'u2', caption: 'Zoe', count: 2 }, { key: '', caption: NO_OWNER, count: 1 },
]);
assert.deepEqual(lanesOf(laneCards, 'object', cap).map((l) => [l.key, l.caption, l.count]), [['Account', 'Account', 2], ['Activity', 'Task', 2]]);
assert.deepEqual(lanesOf(laneCards, 'none', cap), [{ key: '', caption: '', count: 4 }]);
assert.deepEqual(lanesOf([], 'owner', cap), []);
assert.equal(laneKey(laneCards[1], 'owner'), '');
assert.equal(laneKey(laneCards[1], 'object'), 'Account');
assert.equal(normalizeSwimlanes('owner'), 'owner');
assert.equal(normalizeSwimlanes('x'), 'none');
assert.equal(normalizeRefresh(undefined), 30);
assert.equal(normalizeRefresh(0), 0);
assert.equal(normalizeRefresh('120'), 120);
assert.equal(normalizeRefresh(601), 30);
assert.equal(normalizeRefresh(2.5), 30);

// stored filters
assert.deepEqual(parseStoredFilters(null), { text: '', entityName: '', owner: 'any', staleOnly: false, dueOnly: false, sortMode: 'manual' });
assert.deepEqual(parseStoredFilters('{"text":"Call","entityName":"Activity","mine":true,"staleOnly":"yes","sortMode":"total"}'),
	{ text: 'Call', entityName: 'Activity', owner: 'me', staleOnly: false, dueOnly: false, sortMode: 'total' }, 'old "mine" becomes "me"');
assert.equal(parseStoredFilters('{"owner":"none"}').owner, 'none');
assert.equal(parseStoredFilters('{"owner":"410006E1-CA4E-4502-A9EC-E54D922D2C00"}').owner, '410006E1-CA4E-4502-A9EC-E54D922D2C00');
assert.equal(parseStoredFilters('{"owner":"<script>"}').owner, 'any');
assert.ok(hasActiveFilter({ ...parseStoredFilters(null), owner: 'none' }));
assert.deepEqual(parseStoredFilters('{"entityName":"bad name","sortMode":"random"}').entityName, '');
assert.equal(parseStoredFilters('{"sortMode":"random"}').sortMode, 'manual');
assert.equal(parseStoredFilters('not json').text, '');
assert.equal(parseStoredFilters('null').text, '');
assert.ok(!hasActiveFilter(parseStoredFilters(null)));
assert.ok(hasActiveFilter({ ...parseStoredFilters(null), staleOnly: true }));
assert.ok(hasActiveFilter({ ...parseStoredFilters(null), sortMode: 'title' }));

// owner options
assert.deepEqual(ownerOptions(laneCards), [{ id: 'u1', name: 'Adam' }, { id: 'u2', name: 'Zoe' }]);
assert.ok(hasUnowned(laneCards));
assert.ok(!hasUnowned([laneCards[0]]));
assert.deepEqual(ownerOptions([]), []);

// filter toggles
assert.deepEqual(normalizeFilterToggles(undefined), { search: true, object: true, owner: true, stale: true, due: true, sort: true, compact: true, refresh: true, addCard: true });
assert.deepEqual(normalizeFilterToggles({ owner: false, stale: 'no', sort: false, addCard: false }),
	{ search: true, object: true, owner: false, stale: true, due: true, sort: false, compact: true, refresh: true, addCard: false });
assert.deepEqual(normalizeFilterToggles(['x']).search, true);
const storedAll = { text: 'x', entityName: 'Activity', owner: 'me', staleOnly: true, dueOnly: true, sortMode: 'title' as const };
assert.deepEqual(applyToggles(storedAll, { search: false, object: false, owner: false, stale: false, due: false, sort: false, compact: false, refresh: false, addCard: false }),
	{ text: '', entityName: '', owner: 'any', staleOnly: false, dueOnly: false, sortMode: 'manual' });
assert.deepEqual(applyToggles(storedAll, normalizeFilterToggles(undefined)), storedAll);

// history date: dd.mm.yy HH:mm, local time
assert.equal(formatShortDateTime(new Date(2026, 10, 22, 16, 21)), '22.11.26 16:21');
assert.equal(formatShortDateTime(new Date(2027, 0, 5, 9, 7)), '05.01.27 09:07');
assert.equal(formatShortDateTime('2026-11-22T08:05:00'), '22.11.26 08:05');
assert.equal(formatShortDateTime(new Date('x')), '');
assert.equal(formatShortDateTime(null), '');

// auto-add: kept only where the stage maps a value; first mapped stage decides; on-board and limit respected
const auto = normalizeStages([
	{ id: 'a', caption: 'A', statusValues: { Case: NS }, autoAdd: { Case: true, Activity: true, 'bad name': true } },
	{ id: 'b', caption: 'B', statusValues: { Case: IP }, autoAdd: { Case: 'yes' } },
	{ id: 'c', caption: 'C', statusValues: { Case: DONE }, autoAdd: { Case: true } },
	{ id: 'd', caption: 'D', statusValues: { Case: NS } },
]);
assert.deepEqual(auto[0].autoAdd, { Case: true }, 'no mapped value for Activity, bad name dropped');
assert.equal(auto[1].autoAdd, undefined, 'only true counts');
assert.deepEqual(autoAddValues(auto, 'Case'), [NS.toLowerCase(), DONE]);
assert.deepEqual(autoAddValues(auto, 'Activity'), []);
const onBoardIds = new Set(['r2']);
assert.deepEqual(autoAddTargets(auto, 'Case', [
	{ id: 'R1', statusId: NS }, { id: 'R2', statusId: NS }, { id: 'r3', statusId: IP }, { id: 'r4', statusId: DONE.toUpperCase() },
	{ id: 'r5', statusId: null }, { id: 'r1', statusId: NS }, { id: 'r6', statusId: DONE },
], onBoardIds, 2), [{ recordId: 'R1', stageCode: 'a' }, { recordId: 'r4', stageCode: 'c' }], 'R2 on board, IP not auto, r1 twice, limit 2');

// cardIdFor: a GUID, stable, case-insensitive on the record, different per board / object / record
const cid = cardIdFor('board1', 'Case', 'AA-1');
assert.match(cid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
assert.equal(cardIdFor('board1', 'Case', 'aa-1'), cid);
assert.equal(new Set([cid, cardIdFor('board2', 'Case', 'aa-1'), cardIdFor('board1', 'Activity', 'aa-1'), cardIdFor('board1', 'Case', 'aa-2')]).size, 4);
assert.equal(stableId('a', 'b'), stableId('a', 'b'));
assert.notEqual(stableId('a', 'b'), stableId('a', 'c'));

// totals: sum / average / min / max over cards with a value; none -> null
const totalCards = [card('1', 'a', 0, { sum: 10 }), card('2', 'a', 1, { sum: 5 }), card('3', 'a', 2, { sum: null }), card('4', 'a', 3, { sum: 0.333 })];
assert.equal(totalOf(totalCards, 'sum'), 15.33);
assert.equal(totalOf(totalCards, 'avg'), 5.11);
assert.equal(totalOf(totalCards, 'min'), 0.33);
assert.equal(totalOf(totalCards, 'max'), 10);
assert.equal(totalOf([card('5', 'a', 0)], 'avg'), null);
assert.equal(normalizeTotalMode('avg'), 'avg');
assert.equal(normalizeTotalMode('median'), 'sum');
assert.equal(normalizeTotalMode('toString'), 'sum', 'not an inherited key');

// due state: overdue / soon / ok; a date-only value is due at the end of its day; soonDays 0 = never soon
const noon = new Date(2026, 10, 26, 12, 0).getTime();
assert.equal(dueStateOf(new Date(2026, 10, 26, 11, 0), false, noon, 3), 'overdue');
assert.equal(dueStateOf(new Date(2026, 10, 26, 0, 0), true, noon, 3), 'soon', 'today, date only: due tonight');
assert.equal(dueStateOf(new Date(2026, 10, 25, 0, 0), true, noon, 3), 'overdue');
assert.equal(dueStateOf(new Date(2026, 10, 29, 11, 0), false, noon, 3), 'soon');
assert.equal(dueStateOf(new Date(2026, 10, 30, 13, 0), false, noon, 3), 'ok');
assert.equal(dueStateOf(new Date(2026, 10, 27, 12, 0), false, noon, 0), 'ok');
assert.equal(dueStateOf(new Date(2026, 10, 27, 12, 0).toISOString(), false, noon, 3), 'soon', 'ISO text');
assert.equal(dueStateOf(null, false, noon, 3), '');
assert.equal(dueStateOf('nope', false, noon, 3), '');
assert.equal(normalizeDueSoonDays(undefined), 3);
assert.equal(normalizeDueSoonDays('7'), 7);
const dueCards = [card('1', 'a', 0, { dueState: 'overdue' }), card('2', 'a', 1, { dueState: 'soon' }), card('3', 'a', 2, { dueState: 'ok' }), card('4', 'a', 3)];
assert.deepEqual(dueCards.filter((c) => matchesFilter(c, { text: '', entityName: '', ownerId: null, dueOnly: true })).map((c) => c.id), ['1', '2']);
assert.equal(parseStoredFilters(JSON.stringify({ dueOnly: true })).dueOnly, true);

// palette keys only: inherited names such as "constructor" are not colours
assert.equal(normalizeStages([{ id: 'a', caption: 'A', color: 'constructor' }])[0].color, undefined);
assert.equal(normalizeObjectSettings({ Case: { color: 'toString' } }, ['Case'])['Case'].color, '');

// nearestColor: closest palette key; anything not #rrggbb -> ''
assert.equal(nearestColor('#0057EE'), 'blue');
assert.equal(nearestColor('#dd3322'), 'red');
assert.equal(nearestColor('#888888'), 'grey');
assert.equal(nearestColor('red'), '');
assert.equal(nearestColor(undefined), '');
assert.equal(nearestColor('#12345'), '');

// stagesFromValues: one stage per value no stage maps yet, in the given order, colour from the value, capped at MAX_STAGES
const base = normalizeStages([{ id: 'x', caption: 'X', statusValues: { Case: [NS] } }, { id: 'y', caption: 'Y' }]);
const made = stagesFromValues(base, 'Case', [{ id: NS, caption: 'Not started' }, { id: IP, caption: 'In progress', color: '#e0a801' }, { id: DONE, caption: 'Done' }]);
assert.deepEqual([made.added, made.skipped], [2, 0]);
assert.deepEqual(made.stages.map((s) => s.caption), ['X', 'Y', 'In progress', 'Done']);
assert.deepEqual(made.stages[2].statusValues, { Case: [IP] });
assert.equal(made.stages[2].color, 'yellow');
assert.equal(made.stages[3].color, undefined);
assert.equal(new Set(made.stages.map((s) => s.id)).size, 4);
const many = Array.from({ length: 14 }, (_, i) => ({ id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`, caption: `V${i}` }));
const capped = stagesFromValues(base, 'Case', many);
assert.deepEqual([capped.stages.length, capped.added, capped.skipped], [12, 10, 4]);
assert.equal(stagesFromValues(made.stages, 'Case', [{ id: IP, caption: 'again' }]).added, 0, 'already mapped');

// card layout: icons from the Creatio list only, style line|tag, unique fields, at most 8; layout wins over fields
const laid = normalizeObjectSettings({ Case: {
	fields: ['Ignored'],
	layout: [
		{ field: 'Owner', icon: 'contact-icon', style: 'tag' },
		{ field: 'Owner', icon: 'tag-icon' },
		{ field: 'Number', icon: 'url(x)', style: 'bold' },
		{ field: 'bad name' },
		'nope',
		...Array.from({ length: 10 }, (_, i) => ({ field: `F${i}` })),
	],
	dueField: 'Deadline', dueIcon: 'calendar-icon',
} }, ['Case'])['Case'];
assert.deepEqual(laid.layout.slice(0, 2), [{ field: 'Owner', icon: 'contact-icon', style: 'tag' }, { field: 'Number', icon: '', style: 'line' }]);
assert.equal(laid.layout.length, MAX_CARD_FIELDS);
assert.equal(MAX_CARD_FIELDS, 8);
assert.deepEqual(laid.fields, laid.layout.map((l) => l.field));
assert.equal(laid.dueField, '', 'the legacy due row did not fit into 8 rows');

// due as a layout row: one per object (a second "due" becomes a tag), dueField/dueIcon follow it, legacy dueField appended
const dueRows = normalizeObjectSettings({ Case: { layout: [
	{ field: 'Owner', style: 'line' }, { field: 'Deadline', icon: 'calendar-icon', style: 'due' }, { field: 'Start', style: 'due' },
] } }, ['Case'])['Case'];
assert.deepEqual(dueRows.layout.map((l) => l.style), ['line', 'due', 'tag']);
assert.deepEqual([dueRows.dueField, dueRows.dueIcon], ['Deadline', 'calendar-icon']);
const legacy = normalizeObjectSettings({ Case: { layout: [{ field: 'Owner', style: 'line' }], dueField: 'Deadline', dueIcon: 'clock-icon' } }, ['Case'])['Case'];
assert.deepEqual(legacy.layout, [{ field: 'Owner', icon: '', style: 'line' }, { field: 'Deadline', icon: 'clock-icon', style: 'due' }]);
assert.equal(legacy.dueField, 'Deadline');
const input = { Case: { layout: [{ field: 'Owner' }], dueField: 'Deadline' } };
normalizeObjectSettings(input, ['Case']);
assert.equal(input.Case.layout.length, 1, 'the settings passed in are not changed');
const legacyShown = normalizeObjectSettings({ Case: { fields: ['Deadline', 'Owner'], dueField: 'Deadline' } }, ['Case'])['Case'];
assert.deepEqual(legacyShown.layout.map((l) => [l.field, l.style]), [['Deadline', 'due'], ['Owner', 'line']], 'a due field already on the card is that row');
assert.equal(normalizeObjectSettings({ Case: { dueField: 'D', dueIcon: 'toString' } }, ['Case'])['Case'].dueIcon, '');
assert.deepEqual(normalizeObjectSettings({ Case: { fields: ['A'], layout: [] } }, ['Case'])['Case'].layout, [], 'an emptied layout stays empty');

// iconUrl: only listed icons, under the site's path
assert.equal(iconUrl('tag-icon', '/0/Shell/'), '/0/Shell/assets/themes/freedom/icons/tag-icon.svg');
assert.equal(iconUrl('tag-icon', '/crm/0/ClientApp/'), '/crm/0/Shell/assets/themes/freedom/icons/tag-icon.svg');
assert.equal(iconUrl('../../secret', '/0/Shell/'), '');
assert.equal(iconUrl('', '/0/Shell/'), '');
assert.equal(ICON_NAMES.length, 117);

// per object: locked (default false), dueSoonDays only when set (else the board's value applies)
const perObject = normalizeObjectSettings({ Case: { locked: true, dueSoonDays: '7' }, Lead: { locked: 'yes' } }, ['Case', 'Lead']);
assert.equal(perObject['Case'].locked, true);
assert.equal(perObject['Case'].dueSoonDays, 7);
assert.equal(perObject['Lead'].locked, false);
assert.equal('dueSoonDays' in perObject['Lead'], false);

console.log('board-logic: ok');
