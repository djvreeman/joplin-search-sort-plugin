import test from 'node:test';
import assert from 'node:assert/strict';
import {
	allowedFolderIds,
	dateFilterThresholdMs,
	noteMatchesAndFilters,
	ocrSupplementPlan,
	sqlLikeMatch,
	tokenizeSearchQuery,
	type FolderRecord,
} from '../ocrSearch';

const folders: FolderRecord[] = [
	{ id: 'auto', title: 'Auto', parentId: '' },
	{ id: 'child', title: 'Receipts', parentId: 'auto' },
	{ id: 'other', title: 'Other', parentId: '' },
	{ id: 'skip', title: 'Skip', parentId: '' },
];

test('plain text does not need an OCR supplement', () => {
	assert.equal(ocrSupplementPlan('porsche'), null);
	assert.equal(ocrSupplementPlan('/porsche'), null);
	assert.equal(ocrSupplementPlan('notebook:Auto'), null);
});

test('notebook scope keeps the free-text query for OCR', () => {
	const plan = ocrSupplementPlan('notebook:"My Cars" porsche -honda');
	assert.ok(plan);
	assert.equal(plan.orMode, false);
	assert.equal(plan.textQuery, 'porsche -honda');
	assert.deepEqual(plan.notebooks, [{ pattern: 'My Cars', negated: false }]);
});

test('any:1 searches each term and still limits notebooks', () => {
	const plan = ocrSupplementPlan('any:1 notebook:Auto cat dog');
	assert.ok(plan);
	assert.equal(plan.orMode, true);
	assert.deepEqual(plan.orTextQueries, ['cat', 'dog']);
	assert.deepEqual(plan.notebooks, [{ pattern: 'Auto', negated: false }]);
});

test('tag, title, and body filters are split out of the text query', () => {
	const plan = ocrSupplementPlan('tag:cars title:"oil change" body:secret porsche');
	assert.ok(plan);
	assert.equal(plan.textQuery, 'porsche');
	assert.deepEqual(plan.tags, [{ pattern: 'cars', negated: false }]);
	assert.deepEqual(plan.titles, [
		{ pattern: 'oil', negated: false, wildcard: false },
		{ pattern: 'change', negated: false, wildcard: false },
	]);
	assert.deepEqual(plan.verifyFilters, ['body:secret']);
});

test('tokenizer keeps colons inside non-filter terms', () => {
	const tokens = tokenizeSearchQuery('https://joplinapp.org notebook:Auto');
	assert.equal(tokens[0].name, 'text');
	assert.equal(tokens[0].value, 'https://joplinapp.org');
	assert.equal(tokens[1].name, 'notebook');
});

test('notebook filter includes subnotebooks and applies exclusions', () => {
	const allowed = allowedFolderIds(folders, [
		{ pattern: 'Auto', negated: false },
		{ pattern: 'Skip', negated: true },
	]);
	assert.ok(allowed);
	assert.deepEqual([...allowed].sort(), ['auto', 'child']);
});

test('notebook wildcards match the folder and its children', () => {
	const allowed = allowedFolderIds(folders, [{ pattern: 'Au%', negated: false }]);
	assert.ok(allowed);
	assert.equal(allowed.has('auto'), true);
	assert.equal(allowed.has('child'), true);
	assert.equal(allowed.has('other'), false);
});

test('sql like is case insensitive and supports % and _', () => {
	assert.equal(sqlLikeMatch('Auto', 'auto'), true);
	assert.equal(sqlLikeMatch('Au%', 'Automobile'), true);
	assert.equal(sqlLikeMatch('A_to', 'Auto'), true);
	assert.equal(sqlLikeMatch('A_to', 'Alto'), true);
	assert.equal(sqlLikeMatch('Other', 'Auto'), false);
});

test('date filters use the local calendar day', () => {
	assert.equal(dateFilterThresholdMs('20201218'), new Date(2020, 11, 18).getTime());
	const now = new Date(2024, 5, 15, 12, 0, 0).getTime();
	assert.equal(dateFilterThresholdMs('day-2', now), new Date(2024, 5, 13, 12, 0, 0).getTime());
});

test('AND filters keep a todo whose title contains every required word', () => {
	const plan = ocrSupplementPlan('type:todo title:oil created:20200101 scan');
	assert.ok(plan);
	const day = new Date(2020, 0, 1).getTime();
	assert.equal(noteMatchesAndFilters({
		id: 'n1',
		title: 'Oil change',
		is_todo: 1,
		user_created_time: day,
	}, plan), true);
	assert.equal(noteMatchesAndFilters({
		id: 'n2',
		title: 'Scan',
		is_todo: 1,
		user_created_time: day,
	}, plan), false);
});
