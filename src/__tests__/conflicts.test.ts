import test from 'node:test';
import assert from 'node:assert/strict';
import {
	ATTACHMENT_CONFLICT_TITLE,
	CONFLICT_FOLDER_ID,
	consumeConflictPage,
	attachmentFileNameFromTitle,
	describeAttachmentConflict,
	listConflictNotes,
	pickAttachmentHomeNotes,
	planConflictResolution,
	resourceIdsFromNoteBody,
	type ConflictListRow,
	resolveConflictNote,
	resolveSidebarSelection,
} from '../conflicts';

const travelId = 'folder-travel';

test('resolveSidebarSelection shows Conflicts when notesParent is the virtual folder', () => {
	const selection = resolveSidebarSelection({
		notesParentId: CONFLICT_FOLDER_ID,
		activeFolderId: travelId,
		selectedFolderId: travelId,
		selectedFolderTitle: 'Travel',
	});
	assert.equal(selection.folderId, CONFLICT_FOLDER_ID);
	assert.equal(selection.folderTitle, 'Conflicts');
	assert.equal(selection.listKind, 'noteConflicts');
});

test('resolveSidebarSelection keeps a real notebook when settings agree', () => {
	const selection = resolveSidebarSelection({
		notesParentId: travelId,
		activeFolderId: CONFLICT_FOLDER_ID,
		selectedFolderId: travelId,
		selectedFolderTitle: 'Travel',
	});
	assert.equal(selection.folderId, travelId);
	assert.equal(selection.folderTitle, 'Travel');
	assert.equal(selection.listKind, 'notes');
});

test('resolveSidebarSelection marks the attachment conflict notebook', () => {
	const selection = resolveSidebarSelection({
		notesParentId: 'folder-attach',
		activeFolderId: 'folder-attach',
		selectedFolderId: 'folder-attach',
		selectedFolderTitle: ATTACHMENT_CONFLICT_TITLE,
	});
	assert.equal(selection.listKind, 'attachmentConflicts');
	assert.equal(selection.folderTitle, ATTACHMENT_CONFLICT_TITLE);
});

test('consumeConflictPage stops after ordered conflict copies', () => {
	const page = consumeConflictPage(
		[{ id: 'c1', is_conflict: 1 }, { id: 'n1', is_conflict: 0 }],
		true,
		false,
	);
	assert.equal(page.orderIgnored, false);
	assert.equal(page.done, true);
	assert.deepEqual(page.conflicts.map(item => item.id), ['c1']);
});

test('consumeConflictPage reports ignored order when ordinary notes come first', () => {
	const page = consumeConflictPage(
		[{ id: 'n1', is_conflict: 0 }],
		true,
		false,
	);
	assert.equal(page.orderIgnored, true);
	assert.equal(page.conflicts.length, 0);
});

test('listConflictNotes loads is_conflict copies and the original notebook', async () => {
	const calls: string[] = [];
	const joplin = {
		data: {
			get: async (path: string[], query?: Record<string, unknown>) => {
				calls.push(path.join('/'));
				if (path[0] === 'notes' && !path[1]) {
					assert.equal(query?.include_conflicts, '1');
					return {
						items: [{
							id: 'copy-1',
							title: 'Uber trip',
							created_time: 1,
							updated_time: 10,
							parent_id: travelId,
							is_conflict: 1,
							conflict_original_id: 'orig-1',
						}],
						has_more: false,
					};
				}
				if (path[0] === 'notes' && path[1] === 'orig-1') {
					return { id: 'orig-1', title: 'Uber trip', updated_time: 50, deleted_time: 0 };
				}
				if (path[0] === 'folders' && path[1] === travelId) {
					return { id: travelId, title: 'Travel' };
				}
				throw new Error(`Unexpected ${path.join('/')}`);
			},
		},
	};

	const response = await listConflictNotes(joplin, {
		sortField: 'updated',
		sortDirection: 'desc',
		maxResults: 100,
	});

	assert.equal(response.listKind, 'noteConflicts');
	assert.equal(response.rows.length, 1);
	const row = response.rows[0] as ConflictListRow;
	assert.equal(row.id, 'copy-1');
	assert.equal(row.notebookTitle, 'Travel');
	assert.equal(row.conflictOriginalId, 'orig-1');
	assert.equal(calls.includes(`folders/${CONFLICT_FOLDER_ID}/notes`), false);
});

test('planConflictResolution deletes the copy when keeping the notebook note', () => {
	const plan = planConflictResolution({
		action: 'keepOriginal',
		conflict: { id: 'copy-1', is_conflict: 1, title: 'Uber', body: 'old' },
		original: { id: 'orig-1', deleted_time: 0 },
		notebookTitle: 'Travel',
	});
	assert.deepEqual(plan.steps, [{ method: 'delete', id: 'copy-1' }]);
	assert.match(plan.message, /Travel/);
});

test('planConflictResolution overwrites the notebook note when using the copy', () => {
	const plan = planConflictResolution({
		action: 'useCopy',
		conflict: { id: 'copy-1', is_conflict: 1, title: 'Uber', body: 'from copy' },
		original: { id: 'orig-1', deleted_time: 0 },
		notebookTitle: 'Travel',
	});
	assert.equal(plan.steps[0].method, 'put');
	assert.equal(plan.steps[0].id, 'orig-1');
	assert.deepEqual(plan.steps[0].body, { title: 'Uber', body: 'from copy' });
	assert.deepEqual(plan.steps[1], { method: 'delete', id: 'copy-1' });
});

test('planConflictResolution restores the copy when the notebook note is gone', () => {
	const plan = planConflictResolution({
		action: 'keepOriginal',
		conflict: { id: 'copy-1', is_conflict: 1, title: 'Uber', body: 'only copy' },
		original: null,
		notebookTitle: 'Travel',
	});
	assert.deepEqual(plan.steps, [{
		method: 'put',
		id: 'copy-1',
		body: { is_conflict: 0, conflict_original_id: '' },
	}]);
});

test('resolveConflictNote applies the plan through the data API', async () => {
	const puts: Array<{ id: string; body: unknown }> = [];
	const deletes: string[] = [];
	const joplin = {
		data: {
			get: async (path: string[]) => {
				if (path[1] === 'copy-1') {
					return {
						id: 'copy-1',
						title: 'Uber',
						body: 'from copy',
						parent_id: travelId,
						is_conflict: 1,
						conflict_original_id: 'orig-1',
					};
				}
				if (path[1] === 'orig-1') return { id: 'orig-1', deleted_time: 0, parent_id: travelId };
				if (path[0] === 'folders') return { id: travelId, title: 'Travel' };
				throw new Error(path.join('/'));
			},
			put: async (path: string[], _query: unknown, body: unknown) => {
				puts.push({ id: path[1], body });
			},
			delete: async (path: string[]) => {
				deletes.push(path[1]);
			},
		},
	};

	const result = await resolveConflictNote(joplin, 'copy-1', 'useCopy');
	assert.equal(puts[0].id, 'orig-1');
	assert.deepEqual(deletes, ['copy-1']);
	assert.match(result.message, /Travel/);
});

test('attachmentFileNameFromTitle reads Joplin conflict titles', () => {
	assert.equal(
		attachmentFileNameFromTitle('Attachment conflict: "receipt.pdf"'),
		'receipt.pdf',
	);
	assert.equal(attachmentFileNameFromTitle('Uber trip'), '');
});

test('resourceIdsFromNoteBody reads embedded resource ids', () => {
	const body = 'See ![receipt.pdf](:/0123456789abcdef0123456789abcdef)';
	assert.deepEqual(resourceIdsFromNoteBody(body), ['0123456789abcdef0123456789abcdef']);
});

test('pickAttachmentHomeNotes drops the spare copy and its folder', () => {
	const hits = pickAttachmentHomeNotes(
		[
			{ id: 'copy', parent_id: 'conflicts', title: 'Attachment conflict: "a.pdf"' },
			{ id: 'other-copy', parent_id: 'conflicts', title: 'Attachment conflict: "a.pdf"' },
			{ id: 'home', parent_id: 'travel', title: 'Uber trip' },
		],
		'copy',
		'conflicts',
	);
	assert.deepEqual(hits.map(hit => hit.id), ['home']);
});

test('describeAttachmentConflict points at the note that still mentions the file', async () => {
	const joplin = {
		data: {
			get: async (path: string[], query?: Record<string, unknown>) => {
				if (path[0] === 'notes' && path[1] === 'copy-1') {
					return {
						id: 'copy-1',
						title: 'Attachment conflict: "receipt.pdf"',
						body: '![receipt.pdf](:/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)',
						parent_id: 'conflicts',
					};
				}
				if (path[0] === 'search' && query?.type === 'resource') {
					return { items: [] };
				}
				if (path[0] === 'search') {
					return {
						items: [
							{ id: 'copy-1', title: 'Attachment conflict: "receipt.pdf"', parent_id: 'conflicts' },
							{ id: 'uber', title: 'Uber trip', parent_id: 'travel' },
						],
					};
				}
				if (path[0] === 'folders' && path[1] === 'travel') {
					return { id: 'travel', title: 'Travel' };
				}
				throw new Error(path.join('/'));
			},
		},
	};

	const details = await describeAttachmentConflict(joplin, 'copy-1');
	assert.equal(details.fileName, 'receipt.pdf');
	assert.equal(details.matches.length, 1);
	assert.equal(details.matches[0].id, 'uber');
	assert.equal(details.matches[0].notebookTitle, 'Travel');
	assert.match(details.message, /Uber trip/);
});
