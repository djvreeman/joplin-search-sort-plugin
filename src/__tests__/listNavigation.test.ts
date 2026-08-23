import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideNoteListingMembership,
  nextNoteIdAfterRemoval,
  noteIdAtOffset,
  NOTE_EVENT_DELETE,
} from '../listNavigation';

test('nextNoteIdAfterRemoval selects following note in current list order', () => {
  const rows = [
    { id: 'a' }, // title sort: Alpha
    { id: 'b' }, // Bravo — selected, then moved out
    { id: 'c' }, // Charlie — should become next
  ];

  const result = nextNoteIdAfterRemoval(rows, 'b');
  assert.deepEqual(result.rows.map(r => r.id), ['a', 'c']);
  assert.equal(result.nextId, 'c');
});

test('nextNoteIdAfterRemoval selects previous when removed note was last', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const result = nextNoteIdAfterRemoval(rows, 'c');
  assert.equal(result.nextId, 'b');
});

test('nextNoteIdAfterRemoval returns null when list becomes empty', () => {
  const result = nextNoteIdAfterRemoval([{ id: 'only' }], 'only');
  assert.deepEqual(result.rows, []);
  assert.equal(result.nextId, null);
});

test('nextNoteIdAfterRemoval ignores Joplin default order — uses given row order', () => {
  // Panel sorted by title; Joplin default might have preferred 'z' as "next"
  const titleSorted = [{ id: 'm' }, { id: 'x' }, { id: 'z' }];
  const result = nextNoteIdAfterRemoval(titleSorted, 'x');
  assert.equal(result.nextId, 'z');
});

test('noteIdAtOffset moves down and up without wrapping', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(noteIdAtOffset(rows, 'a', 1), 'b');
  assert.equal(noteIdAtOffset(rows, 'b', -1), 'a');
  assert.equal(noteIdAtOffset(rows, 'a', -1), 'a');
  assert.equal(noteIdAtOffset(rows, 'c', 1), 'c');
});

test('noteIdAtOffset picks an end when current id is missing', () => {
  const rows = [{ id: 'a' }, { id: 'b' }];
  assert.equal(noteIdAtOffset(rows, null, 1), 'a');
  assert.equal(noteIdAtOffset(rows, 'missing', -1), 'b');
});

test('decideNoteListingMembership stays for title/tag updates in scoped notebook', () => {
  assert.equal(
    decideNoteListingMembership({
      scopedNotebookId: 'inbox',
      searchAllNotebooks: false,
      meta: { parentId: 'inbox' },
      eventType: 2,
    }),
    'stay',
  );
});

test('decideNoteListingMembership left_scope only when parent notebook changes', () => {
  assert.equal(
    decideNoteListingMembership({
      scopedNotebookId: 'inbox',
      searchAllNotebooks: false,
      meta: { parentId: 'archive' },
      eventType: 2,
    }),
    'left_scope',
  );
});

test('decideNoteListingMembership does not treat failed meta as a move', () => {
  assert.equal(
    decideNoteListingMembership({
      scopedNotebookId: 'inbox',
      searchAllNotebooks: false,
      meta: null,
      eventType: 2,
    }),
    'inconclusive',
  );
});

test('decideNoteListingMembership treats delete event with missing meta as deleted', () => {
  assert.equal(
    decideNoteListingMembership({
      scopedNotebookId: 'inbox',
      searchAllNotebooks: false,
      meta: null,
      eventType: NOTE_EVENT_DELETE,
    }),
    'deleted',
  );
});

test('decideNoteListingMembership never leaves on parent change when browsing all notebooks', () => {
  assert.equal(
    decideNoteListingMembership({
      scopedNotebookId: null,
      searchAllNotebooks: true,
      meta: { parentId: 'anywhere' },
      eventType: 2,
    }),
    'stay',
  );
});
