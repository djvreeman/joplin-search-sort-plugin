import joplin from 'api';
import { runSearch, type SortDirection, type SortField } from './searchSortService';
import {
	buildPanelHtml,
	buildPanelState,
	folderIdFromNotesParent,
	type PanelInitPayload,
	parsePanelColumns,
} from './panelBootstrap';
import { registerSettings, readRuntimeSettings, SETTINGS } from './settings';
import { buildEffectiveQuery, type NotebookScope } from './searchQuery';

interface SearchUiState {
	textQuery: string;
	notebookScope: NotebookScope | null;
	searchAllNotebooks: boolean;
	sortField: SortField;
	sortDirection: SortDirection;
}

const PANEL_ID = 'advancedSearchSortPanel';
const COMMAND_NAME = 'openAdvancedSearchSort';
const PANEL_HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Advanced Search Sort</title>
  </head>
  <body>
    <div class="note-list">
      <div class="note-list-controls">
        <button id="newNoteBtn" class="btn btn-primary" type="button">
          <span class="btn-icon">+</span>
          <span>New note</span>
        </button>
        <div class="search-input">
          <input id="queryInput" class="field" type="text" placeholder="Search..." spellcheck="false" autocomplete="off" />
          <button id="searchActionBtn" class="search-action-btn" type="button" aria-label="Search">
            <span class="ss-glyph ss-glyph-search" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div id="scopeBar" class="scope-bar">
        <button id="allNotebooksBtn" class="scope-btn" type="button">All notebooks</button>
        <span id="scopeNotebookChip" class="scope-chip" hidden>
          <span class="scope-chip-label"></span>
          <button id="clearScopeBtn" class="scope-chip-clear" type="button" aria-label="Search all notebooks">×</button>
        </span>
      </div>
      <div id="statusLine" class="status">Ready.</div>
      <div id="headerRow" class="note-list-header"></div>
      <div id="resultsBody" class="notes"></div>
    </div>
  </body>
</html>`;

async function selectedNoteId(): Promise<string | null> {
	const ids = await joplin.workspace.selectedNoteIds();
	return ids.length ? ids[0] : null;
}

async function sidebarFolderContext(): Promise<{ folderId: string | null; folderTitle: string }> {
	const notesParentFolderId = folderIdFromNotesParent(await joplin.settings.globalValue('notesParent'));
	const folderId = notesParentFolderId || await joplin.settings.globalValue('activeFolderId');
	if (!folderId) {
		return { folderId: null, folderTitle: '' };
	}

	const folder = await joplin.workspace.selectedFolder();
	return {
		folderId,
		folderTitle: folder?.title || '(Untitled notebook)',
	};
}

async function notebookScopeFromId(notebookId: string): Promise<NotebookScope | null> {
	if (!notebookId) return null;
	try {
		const folder = await joplin.data.get(['folders', notebookId], { fields: ['id', 'title'] });
		if (!folder?.id) return null;
		return {
			id: folder.id,
			title: folder.title || '(Untitled notebook)',
		};
	} catch {
		return null;
	}
}

async function buildStatePayload(): Promise<PanelInitPayload> {
	const runtime = await readRuntimeSettings(joplin);
	const sidebarFolder = await sidebarFolderContext();
	let restoredNotebook: NotebookScope | null = null;

	if (runtime.preserveLastState && runtime.lastNotebookId && !runtime.searchAllNotebooks) {
		restoredNotebook = await notebookScopeFromId(runtime.lastNotebookId);
	}
	if (!restoredNotebook && !runtime.searchAllNotebooks && sidebarFolder.folderId) {
		restoredNotebook = {
			id: sidebarFolder.folderId,
			title: sidebarFolder.folderTitle,
		};
	}

	return {
		...buildPanelState(runtime, sidebarFolder, restoredNotebook),
		selectedNoteId: await selectedNoteId(),
		dateFormat: await joplin.settings.globalValue('dateFormat'),
		timeFormat: await joplin.settings.globalValue('timeFormat'),
		notesColumns: await joplin.settings.globalValue('notes.columns'),
	};
}

async function persistUiState(state: SearchUiState): Promise<void> {
	const settings = await readRuntimeSettings(joplin);
	if (!settings.preserveLastState) return;

	await joplin.settings.setValue(SETTINGS.lastQuery, state.textQuery);
	await joplin.settings.setValue(SETTINGS.lastSortField, state.sortField);
	await joplin.settings.setValue(SETTINGS.lastSortDirection, state.sortDirection);
	await joplin.settings.setValue(SETTINGS.searchAllNotebooks, state.searchAllNotebooks);
	await joplin.settings.setValue(
		SETTINGS.lastNotebookId,
		state.searchAllNotebooks || !state.notebookScope ? '' : state.notebookScope.id,
	);
}

async function executeSearch(state: SearchUiState) {
	const settings = await readRuntimeSettings(joplin);
	const effectiveQuery = buildEffectiveQuery(state.textQuery, state.notebookScope);
	const response = await runSearch(joplin, {
		query: effectiveQuery,
		sortField: state.sortField,
		sortDirection: state.sortDirection,
		maxResults: settings.maxResults,
	});

	await persistUiState(state);

	return {
		type: 'searchResults',
		payload: {
			...response,
			textQuery: state.textQuery,
			notebookScope: state.notebookScope,
			searchAllNotebooks: state.searchAllNotebooks,
			selectedNoteId: await selectedNoteId(),
		},
	};
}

joplin.plugins.register({
	onStart: async function() {
		await registerSettings(joplin);

		const runtime = await readRuntimeSettings(joplin);
		const sidebarFolder = await sidebarFolderContext();
		let restoredNotebook: NotebookScope | null = null;
		if (runtime.lastNotebookId && !runtime.searchAllNotebooks) {
			restoredNotebook = await notebookScopeFromId(runtime.lastNotebookId);
		}
		const bootstrap = buildPanelState(runtime, sidebarFolder, restoredNotebook);

		const panel = await joplin.views.panels.create(PANEL_ID);
		await joplin.views.panels.setHtml(panel, buildPanelHtml(PANEL_HTML, bootstrap));

		await joplin.views.panels.onMessage(panel, async (message: any) => {
			if (!message || !message.type) return;

			if (message.type === 'getState') {
				return { type: 'state', payload: await buildStatePayload() };
			}

			if (message.type === 'getFolderContext') {
				const folder = await sidebarFolderContext();
				return {
					type: 'folderContext',
					payload: {
						folderId: folder.folderId,
						folderTitle: folder.folderTitle,
						selectedNoteId: await selectedNoteId(),
					},
				};
			}

			if (message.type === 'getNoteMeta') {
				const noteId = message.payload?.noteId;
				if (!noteId) return { type: 'noteMeta', payload: null };
				try {
					const note = await joplin.data.get(['notes', noteId], {
						fields: ['id', 'parent_id', 'title', 'updated_time', 'created_time'],
					});
					if (!note?.id) return { type: 'noteMeta', payload: null };
					return {
						type: 'noteMeta',
						payload: {
							id: note.id,
							parentId: note.parent_id || '',
							title: note.title || '(Untitled)',
							updatedTime: note.updated_time || 0,
							createdTime: note.created_time || 0,
						},
					};
				} catch {
					return { type: 'noteMeta', payload: null };
				}
			}

			if (message.type === 'runSearch') {
				try {
					return await executeSearch(message.payload as SearchUiState);
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					console.error('Advanced Search Sort search failed:', err);
					return { type: 'searchError', payload: { message: err.message } };
				}
			}

			if (message.type === 'openNote') {
				await joplin.commands.execute('openNote', message.payload.noteId);
				return {
					type: 'selectionChanged',
					payload: { noteId: message.payload.noteId },
				};
			}

			if (message.type === 'newNote') {
				await joplin.commands.execute('newNote');
				await joplin.views.panels.postMessage(panel, {
					type: 'notesMayHaveChanged',
				});
			}

			if (message.type === 'saveUiState') {
				try {
					await persistUiState(message.payload as SearchUiState);
					return { ok: true };
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					console.error('Advanced Search Sort failed to save UI state:', err);
					return { ok: false, message: err.message };
				}
			}

			if (message.type === 'saveColumnLayout') {
				try {
					const columns = message.payload?.columns ?? [];
					await joplin.settings.setValue(SETTINGS.panelColumns, JSON.stringify(columns));
					return { ok: true, columns: parsePanelColumns(await joplin.settings.value(SETTINGS.panelColumns)) };
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					console.error('Advanced Search Sort failed to save column layout:', err);
					return { ok: false, message: err.message };
				}
			}
		});

		await joplin.views.panels.addScript(panel, './ui/panel.css');
		await joplin.views.panels.addScript(panel, './ui/panel.js');

		await joplin.workspace.onNoteSelectionChange(async () => {
			await joplin.views.panels.postMessage(panel, {
				type: 'selectionChanged',
				payload: { noteId: await selectedNoteId() },
			});
		});

		// Note moves often re-select another note before ItemChange is delivered, so
		// onNoteChange alone is unreliable. Still listen for in-place updates/deletes.
		await joplin.workspace.onNoteChange(async (event: { id?: string; event?: number }) => {
			await joplin.views.panels.postMessage(panel, {
				type: 'noteChanged',
				payload: {
					noteId: event?.id || null,
					eventType: event?.event ?? null,
					selectedNoteId: await selectedNoteId(),
				},
			});
		});

		await joplin.workspace.onSyncComplete(async () => {
			await joplin.views.panels.postMessage(panel, {
				type: 'notesMayHaveChanged',
			});
		});

		await joplin.commands.register({
			name: COMMAND_NAME,
			label: 'Open Advanced Search Sort',
			execute: async () => {
				await joplin.views.panels.show(panel, true);
			},
		});

		await joplin.views.menuItems.create(
			'advancedSearchSortToolsItem',
			COMMAND_NAME,
			'tools',
		);
	},
});
