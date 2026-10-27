import test from 'node:test';
import assert from 'node:assert/strict';
import {
	contextMenuTargetIds,
	extendNoteSelection,
	selectionAfterClick,
	selectionAfterShiftMove,
	toggleNoteSelection,
} from '../noteListSelection';

const rows = ['a', 'b', 'c', 'd', 'e'];

test('toggleNoteSelection adds a note and will not clear the last one', () => {
	assert.deepEqual(toggleNoteSelection(['a'], 'c'), ['a', 'c']);
	assert.deepEqual(toggleNoteSelection(['a'], 'a'), ['a']);
	assert.deepEqual(toggleNoteSelection(['a', 'c'], 'a'), ['c']);
});

test('extendNoteSelection selects the inclusive range from the last selected note', () => {
	assert.deepEqual(extendNoteSelection(rows, ['a'], 'd'), ['a', 'b', 'c', 'd']);
	assert.deepEqual(extendNoteSelection(rows, ['d'], 'a'), ['d', 'a', 'b', 'c']);
	assert.deepEqual(extendNoteSelection(rows, ['a', 'c'], 'e'), ['a', 'c', 'd', 'e']);
	assert.deepEqual(extendNoteSelection(rows, [], 'b'), ['b']);
	assert.deepEqual(extendNoteSelection(rows, ['b'], 'b'), ['b']);
});

test('selectionAfterClick toggles on cmd/ctrl and extends on shift', () => {
	assert.deepEqual(
		selectionAfterClick(rows, ['a'], 'c', { toggleKey: true, shiftKey: false }),
		['a', 'c'],
	);
	assert.deepEqual(
		selectionAfterClick(rows, ['a'], 'd', { toggleKey: false, shiftKey: true }),
		['a', 'b', 'c', 'd'],
	);
	assert.deepEqual(
		selectionAfterClick(rows, ['a', 'c'], 'e', { toggleKey: true, shiftKey: true }),
		['a', 'c', 'e'],
	);
	assert.deepEqual(
		selectionAfterClick(rows, ['a', 'c'], 'b', { toggleKey: false, shiftKey: false }),
		['b'],
	);
});

test('selectionAfterShiftMove grows and shrinks like Joplin shift+arrow', () => {
	assert.deepEqual(selectionAfterShiftMove(['b'], 'b', 'd'), ['b', 'd']);
	assert.deepEqual(selectionAfterShiftMove(['a', 'b', 'c'], 'c', 'b'), ['a', 'b']);
	assert.deepEqual(selectionAfterShiftMove(['a'], 'a', 'a'), ['a']);
});

test('contextMenuTargetIds keeps a multi-selection when the clicked row is inside it', () => {
	assert.deepEqual(contextMenuTargetIds(['a', 'c', 'd'], 'c'), ['a', 'c', 'd']);
	assert.deepEqual(contextMenuTargetIds(['a', 'c'], 'b'), ['b']);
});
