import type { SortDirection, SortField } from './searchSortService';

export interface SortDefaults {
	defaultSortField: SortField;
	defaultSortDirection: SortDirection;
}

export interface ResolvedSort {
	sortField: SortField;
	sortDirection: SortDirection;
}

/** Folder browsing has no search relevance — use the user's default sort instead. */
export function applyFolderBrowseSort(
	sortField: SortField,
	sortDirection: SortDirection,
	defaults: SortDefaults,
): ResolvedSort {
	if (sortField !== 'relevance') {
		return { sortField, sortDirection };
	}

	let field = defaults.defaultSortField;
	if (field === 'relevance') {
		field = 'updated';
	}

	return {
		sortField: field,
		sortDirection: defaults.defaultSortDirection,
	};
}

export function isFolderBrowseOnly(
	textQuery: string,
	notebookScope: { id: string } | null,
	searchAllNotebooks: boolean,
): boolean {
	return !!notebookScope?.id && !searchAllNotebooks && !textQuery.trim();
}

export function apiOrderParams(
	sortField: SortField,
	sortDirection: SortDirection,
): { order_by: string; order_dir: 'ASC' | 'DESC' } | null {
	const order_dir = sortDirection === 'asc' ? 'ASC' : 'DESC';

	if (sortField === 'updated') return { order_by: 'updated_time', order_dir };
	if (sortField === 'created') return { order_by: 'created_time', order_dir };
	if (sortField === 'title') return { order_by: 'title', order_dir };

	return null;
}

export function effectiveResultLimit(maxResults: number, safetyCap: number): number {
	return maxResults === 0 ? safetyCap : maxResults;
}

export function formatTruncatedSuffix(resultLimit: number): string {
	return ` (showing first ${resultLimit} — raise "Maximum notes to load" in plugin settings)`;
}
