import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDefaultColumns } from '../columnLayout';

test('buildDefaultColumns returns defaults when saved layout is missing', () => {
  const columns = buildDefaultColumns(null, null);
  assert.equal(columns.length, 5);
  assert.deepEqual(columns.map(c => c.field), [
    'relevance',
    'updated',
    'created',
    'title',
    'notebook',
  ]);
});

test('buildDefaultColumns returns defaults when saved layout is empty', () => {
  const columns = buildDefaultColumns(null, []);
  assert.equal(columns.length, 5);
  assert.equal(columns[0].field, 'relevance');
});

test('buildDefaultColumns preserves custom order', () => {
  const columns = buildDefaultColumns(null, [
    { field: 'created', width: 66 },
    { field: 'title', width: 0 },
  ]);
  assert.deepEqual(columns.map(c => c.field), [
    'created',
    'title',
    'relevance',
    'updated',
    'notebook',
  ]);
});
