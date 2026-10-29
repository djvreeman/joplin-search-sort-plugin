import test from 'node:test';
import assert from 'node:assert/strict';
import { runSearch } from '../searchSortService';

const folders = [
	{ id: 'auto', title: 'Auto', parent_id: '' },
	{ id: 'child', title: 'Receipts', parent_id: 'auto' },
	{ id: 'other', title: 'Other', parent_id: '' },
];

function note(id: string, title: string, parentId: string) {
	return {
		id,
		title,
		parent_id: parentId,
		created_time: 10,
		updated_time: 20,
		user_created_time: 10,
		user_updated_time: 20,
		is_todo: 0,
	};
}

function joplinFor(searches: Record<string, unknown[]>, tags?: Record<string, string[]>) {
	const queries: string[] = [];
	return {
		queries,
		data: {
			get: async (path: string[], query?: Record<string, unknown>) => {
				if (path[0] === 'folders' && !path[1]) {
					return { items: folders, has_more: false };
				}
				if (path[0] === 'search' && query?.type === 'tag') {
					const title = String(query.query || '');
					const ids = Object.keys(tags || {}).filter(id => id === title || title === id);
					return {
						items: ids.map(id => ({ id })),
						has_more: false,
					};
				}
				if (path[0] === 'tags' && path[2] === 'notes') {
					const ids = tags?.[path[1]] || [];
					return { items: ids.map(id => ({ id })), has_more: false };
				}
				if (path[0] === 'search') {
					const text = String(query?.query || '');
					queries.push(text);
					return { items: searches[text] || [], has_more: false };
				}
				throw new Error(`Unexpected path: ${path.join('/')}`);
			},
		},
	};
}

const request = {
	sortField: 'title' as const,
	sortDirection: 'asc' as const,
	maxResults: 100,
};

test('scoped search includes OCR matches from the notebook and its subnotebooks', async () => {
	const bodyMatch = note('body', 'Body hit', 'auto');
	const ocrChild = note('ocr', 'Scanned receipt', 'child');
	const ocrElsewhere = note('else', 'Other scan', 'other');
	const joplin = joplinFor({
		'notebook:Auto porsche': [bodyMatch],
		porsche: [bodyMatch, ocrChild, ocrElsewhere],
	});

	const response = await runSearch(joplin, { ...request, query: 'notebook:Auto porsche' });
	assert.deepEqual(response.rows.map(row => row.id), ['body', 'ocr']);
	assert.deepEqual(joplin.queries, ['notebook:Auto porsche', 'porsche']);
});

test('plain search uses Joplin once and does not query OCR separately', async () => {
	const joplin = joplinFor({
		porsche: [note('n1', 'Porsche', 'auto')],
	});
	const response = await runSearch(joplin, { ...request, query: 'porsche' });
	assert.deepEqual(response.rows.map(row => row.id), ['n1']);
	assert.deepEqual(joplin.queries, ['porsche']);
});

test('tag filter keeps OCR matches only when the note has the tag', async () => {
	const tagged = note('tagged', 'Scan', 'auto');
	const untagged = note('loose', 'Other scan', 'auto');
	const joplin = joplinFor(
		{
			'tag:cars porsche': [],
			porsche: [tagged, untagged],
		},
		{ cars: ['tagged'] },
	);

	const response = await runSearch(joplin, { ...request, query: 'tag:cars porsche' });
	assert.deepEqual(response.rows.map(row => row.id), ['tagged']);
});

test('OCR lookup failure still returns the main search results', async () => {
	const bodyMatch = note('body', 'Body hit', 'auto');
	const joplin = joplinFor({
		'notebook:Auto porsche': [bodyMatch],
	});
	const original = joplin.data.get;
	joplin.data.get = async (path: string[], query?: Record<string, unknown>) => {
		if (path[0] === 'search' && query?.query === 'porsche') {
			throw new Error('ocr down');
		}
		return original(path, query);
	};

	const response = await runSearch(joplin, { ...request, query: 'notebook:Auto porsche' });
	assert.deepEqual(response.rows.map(row => row.id), ['body']);
});
