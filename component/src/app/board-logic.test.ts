// Run: node src/app/board-logic.test.ts (Node 22.6+ strips the types). Not part of the bundle.
import assert from 'node:assert/strict';
import {
	DEFAULT_STAGES, formatTotal, formatValue, groupByStage, isSortMode, matchesFilter, MAX_STAGES, moveCard, nextPosition,
	normalizeEntities, normalizeObjectSettings, normalizeStages, sortCards, sumCards, toNumber, toSortableDate,
	daysInStage, formatAge, markStale, toLimit, wipState, stageForStatus, reconcileStages, missingRequired, isEmptyValue, lookupId,
	lanesOf, laneKey, normalizeSwimlanes, normalizeRefresh, parseStoredFilters, hasActiveFilter, NO_OWNER,
	ownerOptions, hasUnowned, normalizeFilterToggles, applyToggles, formatShortDateTime,
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

// moveCard across stages: only changed rows come back
const cols = groupByStage([card('1', 'a', 0), card('2', 'a', 1), card('3', 'b', 0)], stages);
const changed = moveCard(cols, '1', 'b', 0);
assert.deepEqual(cols.get('a')!.map((c) => c.id), ['2']);
assert.deepEqual(cols.get('b')!.map((c) => c.id), ['1', '3']);
assert.deepEqual(changed.map((c) => c.id).sort(), ['1', '2', '3']);
assert.equal(cols.get('b')![0].stageCode, 'b');

// moveCard within a stage, index clamped
const same = groupByStage([card('1', 'a', 0), card('2', 'a', 1), card('3', 'a', 2)], stages);
assert.deepEqual(moveCard(same, '3', 'a', 0).map((c) => c.id).sort(), ['1', '2', '3']);
assert.deepEqual(same.get('a')!.map((c) => c.id), ['3', '1', '2']);
assert.deepEqual(moveCard(same, '2', 'a', 99).map((c) => c.id), []);
assert.deepEqual(moveCard(same, 'nope', 'a', 0), []);
assert.deepEqual(moveCard(same, '1', 'nope', 0), []);

// an orphan moved within the first stage gets its stage fixed
const orphan = groupByStage([card('1', 'gone', 0)], stages);
assert.deepEqual(moveCard(orphan, '1', 'a', 0).map((c) => c.stageCode), ['a']);

// nextPosition
assert.equal(nextPosition(undefined), 0);
assert.equal(nextPosition([card('1', 'a', 4), card('2', 'a', 1)]), 5);

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
assert.deepEqual(settings['Account'], { fields: ['Owner', 'Web', 'Phone', 'Type'], sumField: 'AnnualRevenue', color: 'teal', statusColumn: '' });
assert.deepEqual(settings['Activity'], { fields: [], sumField: '', color: '', statusColumn: '' });
assert.deepEqual(settings['Case'], { fields: [], sumField: '', color: '', statusColumn: '' });
assert.deepEqual(normalizeObjectSettings('{"Account":{"color":"red"}}', ['Account'])['Account'].color, 'red');
assert.deepEqual(normalizeObjectSettings('nope', ['Account'])['Account'], { fields: [], sumField: '', color: '', statusColumn: '' });
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
assert.deepEqual(mapped[0].statusValues, { Activity: NS.toLowerCase() });
assert.deepEqual(mapped[0].requiredFields, { Activity: ['Result'] });
assert.equal(mapped[2].statusValues, undefined);
assert.equal(mapped[2].requiredFields, undefined);

// stageForStatus: first mapped stage, case-insensitive; no mapping -> undefined
assert.equal(stageForStatus(mapped, 'Activity', IP.toUpperCase())?.id, 'b');
assert.equal(stageForStatus(mapped, 'Account', IP), undefined);
assert.equal(stageForStatus(mapped, 'Activity', null), undefined);
assert.equal(stageForStatus([...mapped, { id: 'e', caption: 'E', statusValues: { Activity: IP } }], 'Activity', IP)?.id, 'b', 'first wins');

// reconcileStages: record wins, unmapped status stays, placed at the end of the target stage
const sync = [
	card('1', 'a', 0, { statusId: DONE }),
	card('2', 'a', 1, { statusId: NS }),
	card('3', 'd', 0, { statusId: null }),
	card('4', 'b', 0, { statusId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }),
	card('5', 'd', 1, { statusId: IP, entityName: 'Account' }),
];
const moved = reconcileStages(sync, mapped);
assert.deepEqual(moved.map((m) => [m.card.id, m.fromCode, m.card.stageCode, m.card.position]), [['1', 'a', 'd', 2]]);
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
assert.deepEqual(parseStoredFilters(null), { text: '', entityName: '', owner: 'any', staleOnly: false, sortMode: 'manual' });
assert.deepEqual(parseStoredFilters('{"text":"Call","entityName":"Activity","mine":true,"staleOnly":"yes","sortMode":"total"}'),
	{ text: 'Call', entityName: 'Activity', owner: 'me', staleOnly: false, sortMode: 'total' }, 'old "mine" becomes "me"');
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
assert.deepEqual(normalizeFilterToggles(undefined), { search: true, object: true, owner: true, stale: true, sort: true });
assert.deepEqual(normalizeFilterToggles({ owner: false, stale: 'no', sort: false }), { search: true, object: true, owner: false, stale: true, sort: false });
assert.deepEqual(normalizeFilterToggles(['x']).search, true);
const storedAll = { text: 'x', entityName: 'Activity', owner: 'me', staleOnly: true, sortMode: 'title' as const };
assert.deepEqual(applyToggles(storedAll, { search: false, object: false, owner: false, stale: false, sort: false }),
	{ text: '', entityName: '', owner: 'any', staleOnly: false, sortMode: 'manual' });
assert.deepEqual(applyToggles(storedAll, normalizeFilterToggles(undefined)), storedAll);

// history date: dd.mm.yy HH:mm, local time
assert.equal(formatShortDateTime(new Date(2026, 10, 22, 16, 21)), '22.11.26 16:21');
assert.equal(formatShortDateTime(new Date(2027, 0, 5, 9, 7)), '05.01.27 09:07');
assert.equal(formatShortDateTime('2026-11-22T08:05:00'), '22.11.26 08:05');
assert.equal(formatShortDateTime(new Date('x')), '');
assert.equal(formatShortDateTime(null), '');

console.log('board-logic: ok');
