import test from 'node:test';
import assert from 'node:assert/strict';
import { nextNoteIdAfterRemoval } from '../listNavigation';

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
