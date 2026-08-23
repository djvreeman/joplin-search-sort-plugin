export interface NotebookScope {
	id: string;
	title: string;
}

export function formatNotebookFilter(title: string): string {
	const trimmed = title.trim();
	if (!trimmed) return '';

	const escaped = trimmed.replace(/"/g, '\\"');
	if (/[\s:*"]/.test(trimmed)) {
		return `notebook:"${escaped}"`;
	}
	return `notebook:${escaped}`;
}

export function buildEffectiveQuery(textQuery: string, notebookScope: NotebookScope | null): string {
	const text = textQuery.trim();
	if (notebookScope?.title) {
		const filter = formatNotebookFilter(notebookScope.title);
		if (!filter) return text;
		return text ? `${filter} ${text}` : filter;
	}
	return text;
}

export function describeSearchScope(
	textQuery: string,
	notebookScope: NotebookScope | null,
	resultCount: number,
	truncated: boolean,
): string {
	const countLabel = truncated ? `${resultCount} results (limit reached)` : `${resultCount} results`;
	if (notebookScope?.title && textQuery.trim()) {
		return `${countLabel} in ${notebookScope.title}`;
	}
	if (notebookScope?.title) {
		return `${countLabel} in ${notebookScope.title}`;
	}
	return countLabel;
}
