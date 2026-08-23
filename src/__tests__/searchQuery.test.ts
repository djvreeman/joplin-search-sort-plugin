import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEffectiveQuery, formatNotebookFilter } from '../searchQuery';

test('formatNotebookFilter quotes titles with spaces', () => {
	assert.equal(formatNotebookFilter('Auto'), 'notebook:Auto');
	assert.equal(formatNotebookFilter('My Cars'), 'notebook:"My Cars"');
});

test('buildEffectiveQuery combines notebook scope and text', () => {
	const scope = { id: '1', title: 'Auto' };
	assert.equal(buildEffectiveQuery('porsche', scope), 'notebook:Auto porsche');
	assert.equal(buildEffectiveQuery('', scope), 'notebook:Auto');
	assert.equal(buildEffectiveQuery('porsche', null), 'porsche');
});
