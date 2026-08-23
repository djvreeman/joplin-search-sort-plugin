import type { SortDirection, SortField } from './searchSortService';
import type { NotebookScope } from './searchQuery';

export interface RuntimeSettings {
	defaultSortField: SortField;
	defaultSortDirection: SortDirection;
	preserveLastState: boolean;
	panelColumns: string;
	lastQuery: string;
	lastSortField: SortField;
	lastSortDirection: SortDirection;
	lastNotebookId: string;
	searchAllNotebooks: boolean;
}

export interface PanelStatePayload {
	textQuery: string;
	sortField: SortField;
	sortDirection: SortDirection;
	panelColumns: unknown[] | null;
	notebookScope: NotebookScope | null;
	searchAllNotebooks: boolean;
}

export interface PanelInitPayload extends PanelStatePayload {
	selectedNoteId: string | null;
	dateFormat: string;
	timeFormat: string;
	notesColumns: unknown;
}

export interface NotesParentSelection {
	type: string;
	selectedItemId: string;
}

export function parsePanelColumns(raw: unknown): unknown[] | null {
	if (!raw) return null;
	if (Array.isArray(raw)) return raw;
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}
	return null;
}

export function parseNotesParent(raw: unknown): NotesParentSelection | null {
	if (!raw) return null;

	let parsed: unknown = raw;
	if (typeof raw === 'string') {
		try {
			parsed = JSON.parse(raw);
		} catch {
			return null;
		}
	}

	if (
		typeof parsed === 'object' &&
		parsed !== null &&
		'type' in parsed &&
		'selectedItemId' in parsed &&
		typeof (parsed as NotesParentSelection).type === 'string' &&
		typeof (parsed as NotesParentSelection).selectedItemId === 'string'
	) {
		return parsed as NotesParentSelection;
	}

	return null;
}

export function folderIdFromNotesParent(raw: unknown): string | null {
	const selection = parseNotesParent(raw);
	if (selection?.type === 'Folder' && selection.selectedItemId) {
		return selection.selectedItemId;
	}
	return null;
}

export function buildPanelState(
	runtime: RuntimeSettings,
	folder: { folderId: string | null; folderTitle: string },
	restoredNotebook: NotebookScope | null,
): PanelStatePayload {
	let textQuery = '';
	let sortField = runtime.defaultSortField;
	let sortDirection = runtime.defaultSortDirection;
	let searchAllNotebooks = runtime.searchAllNotebooks;
	let notebookScope: NotebookScope | null = null;

	if (runtime.preserveLastState) {
		textQuery = runtime.lastQuery || '';
		sortField = runtime.lastSortField;
		sortDirection = runtime.lastSortDirection;
		searchAllNotebooks = runtime.searchAllNotebooks;
		if (!searchAllNotebooks) {
			notebookScope = restoredNotebook;
		}
	} else if (!runtime.searchAllNotebooks && folder.folderId && folder.folderTitle) {
		notebookScope = { id: folder.folderId, title: folder.folderTitle };
	}

	return {
		textQuery,
		sortField,
		sortDirection,
		panelColumns: parsePanelColumns(runtime.panelColumns),
		notebookScope,
		searchAllNotebooks,
	};
}

export function buildPanelHtml(baseHtml: string, bootstrap: PanelStatePayload): string {
	const json = JSON.stringify(bootstrap).replace(/<\//g, '<\\/');
	return baseHtml.replace(
		'</head>',
		`<script type="application/json" id="ss-bootstrap">${json}</script></head>`,
	);
}

export function extractBootstrapFromHtml(html: string): PanelStatePayload | null {
	const match = html.match(/<script type="application\/json" id="ss-bootstrap">([\s\S]*?)<\/script>/);
	if (!match) return null;

	try {
		return JSON.parse(match[1]) as PanelStatePayload;
	} catch {
		return null;
	}
}
