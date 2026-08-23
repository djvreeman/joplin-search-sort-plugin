import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMaxResults, SAFETY_MAX_RESULTS, sortRows, type SearchRow } from '../searchSortService';

const sample: SearchRow[] = [
  {
    id: 'a',
    title: 'Bravo',
    createdTime: 100,
    updatedTime: 400,
    notebookId: 'n1',
    notebookTitle: 'Work',
    relevanceRank: 2,
  },
  {
    id: 'b',
    title: 'Alpha',
    createdTime: 300,
    updatedTime: 200,
    notebookId: 'n2',
    notebookTitle: 'Home',
    relevanceRank: 0,
  },
];

test('normalizeMaxResults treats 0 as unlimited', () => {
  assert.equal(normalizeMaxResults(0), 0);
  assert.equal(normalizeMaxResults(200), 200);
  assert.equal(normalizeMaxResults(-1), 0);
});

test('safety cap constant is above API page size', () => {
  assert.ok(SAFETY_MAX_RESULTS >= 100);
});

test('sorts by title ascending', () => {
  const rows = sortRows(sample, 'title', 'asc');
  assert.equal(rows[0].id, 'b');
  assert.equal(rows[1].id, 'a');
});

test('sorts by updated descending', () => {
  const rows = sortRows(sample, 'updated', 'desc');
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[1].id, 'b');
});
