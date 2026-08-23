import test from 'node:test';
import assert from 'node:assert/strict';
import {
	buildPanelHtml,
	buildPanelState,
	extractBootstrapFromHtml,
	folderIdFromNotesParent,
	parsePanelColumns,
} from '../panelBootstrap';

const baseHtml = `<!doctype html><html><head><title>Test</title></head><body></body></html>`;

const runtime = {
	defaultSortField: 'updated' as const,
	defaultSortDirection: 'desc' as const,
	preserveLastState: true,
	panelColumns: '[{"field":"created","width":66},{"field":"title","width":0},{"field":"notebook","width":90},{"field":"updated","width":84},{"field":"relevance","width":52}]',
	lastQuery: 'porsche',
	lastSortField: 'title' as const,
	lastSortDirection: 'asc' as const,
	lastNotebookId: 'folder-auto',
	searchAllNotebooks: false,
};

test('parsePanelColumns accepts JSON string and arrays', () => {
	const columns = [{ field: 'title', width: 100 }];
	assert.deepEqual(parsePanelColumns(JSON.stringify(columns)), columns);
	assert.deepEqual(parsePanelColumns(columns), columns);
	assert.equal(parsePanelColumns(''), null);
});

test('buildPanelState restores query, sort, and saved column order', () => {
	const state = buildPanelState(
		runtime,
		{ folderId: 'sidebar-id', folderTitle: 'Inbox' },
		{ id: 'folder-auto', title: 'Auto' },
	);

	assert.equal(state.textQuery, 'porsche');
	assert.equal(state.sortField, 'title');
	assert.equal(state.notebookScope?.title, 'Auto');
	assert.deepEqual(state.panelColumns?.map(col => (col as { field: string }).field), [
		'created',
		'title',
		'notebook',
		'updated',
		'relevance',
	]);
});

test('buildPanelHtml embeds JSON bootstrap without executable script', () => {
	const html = buildPanelHtml(baseHtml, buildPanelState(runtime, { folderId: null, folderTitle: '' }, null));
	assert.match(html, /<script type="application\/json" id="ss-bootstrap">/);
	assert.doesNotMatch(html, /window\.__SS_BOOTSTRAP__/);
});

test('extractBootstrapFromHtml round-trips column order', () => {
	const payload = buildPanelState(
		runtime,
		{ folderId: 'x', folderTitle: 'Inbox' },
		{ id: 'folder-auto', title: 'Auto' },
	);
	const html = buildPanelHtml(baseHtml, payload);
	const extracted = extractBootstrapFromHtml(html);

	assert.ok(extracted);
	assert.deepEqual(extracted?.panelColumns?.map(col => (col as { field: string }).field), [
		'created',
		'title',
		'notebook',
		'updated',
		'relevance',
	]);
});

test('folderIdFromNotesParent reads folder selection', () => {
	const raw = '{"type":"Folder","selectedItemId":"abc123"}';
	assert.equal(folderIdFromNotesParent(raw), 'abc123');
	assert.equal(folderIdFromNotesParent('{"type":"Tag","selectedItemId":"tag1"}'), null);
});
