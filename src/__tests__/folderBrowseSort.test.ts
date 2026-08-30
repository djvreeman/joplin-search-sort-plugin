import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyFolderBrowseSort,
	apiOrderParams,
	effectiveResultLimit,
	formatTruncatedSuffix,
} from '../folderBrowseSort';

test('applyFolderBrowseSort replaces relevance with user default', () => {
	const resolved = applyFolderBrowseSort('relevance', 'desc', {
		defaultSortField: 'title',
		defaultSortDirection: 'asc',
	});
	assert.equal(resolved.sortField, 'title');
	assert.equal(resolved.sortDirection, 'asc');
});

test('applyFolderBrowseSort falls back to updated when default is relevance', () => {
	const resolved = applyFolderBrowseSort('relevance', 'desc', {
		defaultSortField: 'relevance',
		defaultSortDirection: 'desc',
	});
	assert.equal(resolved.sortField, 'updated');
});

test('applyFolderBrowseSort keeps explicit non-relevance sort', () => {
	const resolved = applyFolderBrowseSort('created', 'asc', {
		defaultSortField: 'updated',
		defaultSortDirection: 'desc',
	});
	assert.equal(resolved.sortField, 'created');
	assert.equal(resolved.sortDirection, 'asc');
});

test('apiOrderParams maps updated and title sorts', () => {
	assert.deepEqual(apiOrderParams('updated', 'desc'), {
		order_by: 'updated_time',
		order_dir: 'DESC',
	});
	assert.deepEqual(apiOrderParams('title', 'asc'), {
		order_by: 'title',
		order_dir: 'ASC',
	});
	assert.equal(apiOrderParams('notebook', 'asc'), null);
});

test('effectiveResultLimit uses safety cap when setting is 0', () => {
	assert.equal(effectiveResultLimit(0, 5000), 5000);
	assert.equal(effectiveResultLimit(6000, 5000), 6000);
});

test('formatTruncatedSuffix mentions plugin settings', () => {
	assert.match(formatTruncatedSuffix(5000), /Maximum notes to load/);
});
