import test from 'node:test';
import assert from 'node:assert/strict';
import {
	buildNoteListContextMenu,
	externalLinkForNote,
	MARKUP_LANGUAGE_HTML,
	markdownLinkForNote,
} from '../noteListContextMenu';

const baseNote = {
	id: 'note-1',
	title: 'Hello',
	deleted_time: 0,
	encryption_applied: 0,
	markup_language: 1,
};

test('buildNoteListContextMenu includes standard actions for a normal note', () => {
	const items = buildNoteListContextMenu({
		noteIds: ['note-1'],
		notes: [baseNote],
		syncTarget: 0,
	});

	const commands = items.map(i => i.command);
	assert.ok(commands.includes('openNoteInNewWindow'));
	assert.ok(commands.includes('setTags'));
	assert.ok(commands.includes('moveToFolder'));
	assert.ok(commands.includes('duplicateNote'));
	assert.ok(commands.includes('deleteNote'));
	assert.ok(commands.includes('searchSortCopyMarkdownLink'));
	assert.ok(commands.includes('searchSortCopyExternalLink'));
	assert.ok(commands.includes('exportPdf'));
});

test('buildNoteListContextMenu adds convert and share when applicable', () => {
	const htmlItems = buildNoteListContextMenu({
		noteIds: ['note-1'],
		notes: [{ ...baseNote, markup_language: MARKUP_LANGUAGE_HTML }],
		syncTarget: 9,
	});
	assert.ok(htmlItems.some(i => i.command === 'convertNoteToMarkdown'));
	assert.ok(htmlItems.some(i => i.command === 'showShareNoteDialog'));
});

test('buildNoteListContextMenu uses trash actions for deleted notes', () => {
	const items = buildNoteListContextMenu({
		noteIds: ['note-1'],
		notes: [{ ...baseNote, deleted_time: 123 }],
	});
	const commands = items.map(i => i.command);
	assert.deepEqual(commands, ['restoreNote', 'permanentlyDeleteNote']);
});

test('buildNoteListContextMenu uses separate switch commands for multi-select', () => {
	const items = buildNoteListContextMenu({
		noteIds: ['a', 'b'],
		notes: [
			{ ...baseNote, id: 'a' },
			{ ...baseNote, id: 'b' },
		],
	});
	const commands = items.map(i => i.command);
	assert.ok(commands.includes('searchSortSwitchToNoteType'));
	assert.equal(commands.filter(c => c === 'searchSortSwitchToNoteType').length, 2);
});

test('markdownLinkForNote escapes closing brackets in title', () => {
	assert.equal(markdownLinkForNote({ id: 'x', title: 'A [B]' }), '[A [B\\]](:/x)');
});

test('externalLinkForNote uses Joplin callback URL', () => {
	assert.equal(
		externalLinkForNote('abc 123'),
		'joplin://x-callback-url/openNote?id=abc%20123',
	);
});
