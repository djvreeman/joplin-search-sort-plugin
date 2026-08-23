import test from 'node:test';
import assert from 'node:assert/strict';
import { listFolderNotes } from '../searchSortService';

test('listFolderNotes loads notes for a folder via data API', async () => {
	const folderId = 'folder-abc';
	const notes = [
		{
			id: 'n1',
			title: 'Note One',
			created_time: 100,
			updated_time: 300,
			parent_id: folderId,
		},
		{
			id: 'n2',
			title: 'Note Two',
			created_time: 200,
			updated_time: 100,
			parent_id: folderId,
		},
	];

	const joplin = {
		data: {
			get: async (path: string[], options?: Record<string, unknown>) => {
				if (path[0] === 'folders' && path[1] === folderId && !path[2]) {
					return { id: folderId, title: 'Work' };
				}
				if (path[0] === 'folders' && path[1] === folderId && path[2] === 'notes') {
					return { items: notes, has_more: false };
				}
				if (path[0] === 'folders' && !path[1]) {
					return {
						items: [{ id: folderId, title: 'Work' }],
						has_more: false,
					};
				}
				throw new Error(`Unexpected path: ${path.join('/')}`);
			},
		},
	};

	const response = await listFolderNotes(joplin, {
		folderId,
		sortField: 'updated',
		sortDirection: 'desc',
		maxResults: 0,
	});

	assert.equal(response.folderTitle, 'Work');
	assert.equal(response.rows.length, 2);
	assert.equal(response.rows[0].id, 'n1');
	assert.equal(response.rows[1].id, 'n2');
});
