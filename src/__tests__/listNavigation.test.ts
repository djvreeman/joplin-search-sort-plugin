import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideNoteListingMembership,
  nextNoteIdAfterRemoval,
  noteIdAtOffset,
  NOTE_EVENT_DELETE,
  resolveOpenedNoteFolderChange,
  type PendingNoteOpen,
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

test('decideNoteListingMembership treats soft-deleted notes as deleted', () => {
  assert.equal(
    decideNoteListingMembership({
      scopedNotebookId: 'inbox',
      searchAllNotebooks: false,
      meta: { parentId: 'inbox', deletedTime: 123 },
      eventType: 2,
    }),
    'deleted',
  );
});

test('decideNoteListingMembership treats soft-delete as deleted when browsing all notebooks', () => {
  assert.equal(
    decideNoteListingMembership({
      scopedNotebookId: null,
      searchAllNotebooks: true,
      meta: { parentId: 'anywhere', deletedTime: 99 },
      eventType: 2,
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

function pendingOpen(overrides: Partial<PendingNoteOpen> = {}): PendingNoteOpen {
  return {
    noteId: 'note-1',
    notebookId: 'cars',
    until: 1_000,
    ...overrides,
  };
}

test('resolveOpenedNoteFolderChange keeps a text search when the opened note folder is selected', () => {
  const result = resolveOpenedNoteFolderChange({
    pending: pendingOpen(),
    folderId: 'cars',
    selectedNoteId: 'note-1',
    now: 500,
    hasTextQuery: true,
  });
  assert.equal(result.ignore, true);
  assert.equal(result.pending, null);
});

test('resolveOpenedNoteFolderChange waits when Joplin has not reached the note notebook yet', () => {
  const pending = pendingOpen();
  const result = resolveOpenedNoteFolderChange({
    pending,
    folderId: 'inbox',
    selectedNoteId: 'note-1',
    now: 500,
    hasTextQuery: true,
  });
  assert.equal(result.ignore, true);
  assert.equal(result.pending, pending);
});

test('resolveOpenedNoteFolderChange applies a non-matching folder after the open window', () => {
  const result = resolveOpenedNoteFolderChange({
    pending: pendingOpen(),
    folderId: 'inbox',
    selectedNoteId: null,
    now: 5_000,
    hasTextQuery: true,
  });
  assert.equal(result.ignore, false);
  assert.equal(result.pending, null);
});

test('resolveOpenedNoteFolderChange keeps the search when the folder matches even if selection lags', () => {
  const result = resolveOpenedNoteFolderChange({
    pending: pendingOpen(),
    folderId: 'cars',
    selectedNoteId: 'other-note',
    now: 500,
    hasTextQuery: true,
  });
  assert.equal(result.ignore, true);
  assert.equal(result.pending, null);
});

test('resolveOpenedNoteFolderChange follows a sidebar click to a different note', () => {
  const result = resolveOpenedNoteFolderChange({
    pending: pendingOpen(),
    folderId: 'archive',
    selectedNoteId: 'other-note',
    now: 500,
    hasTextQuery: true,
  });
  assert.equal(result.ignore, false);
  assert.equal(result.pending, null);
});

test('resolveOpenedNoteFolderChange does not block folder browsing when there is no text query', () => {
  const result = resolveOpenedNoteFolderChange({
    pending: pendingOpen(),
    folderId: 'cars',
    selectedNoteId: 'note-1',
    now: 500,
    hasTextQuery: false,
  });
  assert.equal(result.ignore, false);
  assert.equal(result.pending, null);
});
