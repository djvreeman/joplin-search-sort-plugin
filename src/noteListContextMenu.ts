/** Matches @joplin/renderer MarkupLanguage.Html */
export const MARKUP_LANGUAGE_HTML = 2;

/** Joplin sync targets that enable note sharing in the default context menu. */
const SHARE_NOTE_SYNC_TARGETS = new Set([9, 10, 11]);

export interface MenuTemplateItem {
	label?: string;
	command?: string;
	commandArgs?: Array<string | number | boolean | null | string[]>;
}

export interface NoteContextMenuNote {
	id: string;
	title: string;
	deleted_time?: number;
	encryption_applied?: number;
	markup_language?: number;
}

export interface NoteContextMenuInput {
	noteIds: string[];
	notes: NoteContextMenuNote[];
	syncTarget?: number;
}

/** Runs the Joplin command, then asks the panel to reload the note list. */
export const DISPATCH_NOTE_COMMAND = 'searchSortDispatchNoteCommand';

const LIST_MUTATING_COMMANDS = new Set([
	'setTags',
	'toggleNoteType',
	'searchSortSwitchToNoteType',
	'moveToFolder',
	'duplicateNote',
	'deleteNote',
	'convertNoteToMarkdown',
	'restoreNote',
	'permanentlyDeleteNote',
]);

function item(
	label: string,
	command: string,
	commandArgs: MenuTemplateItem['commandArgs'] = [],
): MenuTemplateItem {
	if (LIST_MUTATING_COMMANDS.has(command)) {
		return {
			label,
			command: DISPATCH_NOTE_COMMAND,
			commandArgs: [command, ...commandArgs],
		};
	}
	return { label, command, commandArgs };
}

/** Joplin command a menu row will run (unwraps the list-refresh dispatcher). */
export function invokedNoteCommand(menuItem: MenuTemplateItem): string {
	if (
		menuItem.command === DISPATCH_NOTE_COMMAND
		&& typeof menuItem.commandArgs?.[0] === 'string'
	) {
		return menuItem.commandArgs[0];
	}
	return menuItem.command || '';
}

/**
 * Build the same command-based items as Joplin's default note-list context menu
 * (NoteListUtils.makeContextMenu). Uses built-in Joplin commands where possible.
 */
export function buildNoteListContextMenu(input: NoteContextMenuInput): MenuTemplateItem[] {
	const noteIds = input.noteIds.filter(Boolean);
	if (!noteIds.length) return [];

	const notes = input.notes.filter(n => noteIds.includes(n.id));
	const singleNoteId = noteIds.length === 1 ? noteIds[0] : null;
	const includeDeletedNotes = notes.some(n => !!n.deleted_time);
	const includeEncryptedNotes = notes.some(n => !!n.encryption_applied);
	const items: MenuTemplateItem[] = [];

	if (!includeEncryptedNotes && !includeDeletedNotes) {
		if (singleNoteId) {
			items.push(item('Open in new window', 'openNoteInNewWindow', [singleNoteId]));
			items.push(item('Open in external editor', 'startExternalEditing', [singleNoteId]));
		}

		items.push(item('Tags', 'setTags', [noteIds]));

		if (noteIds.length <= 1) {
			items.push(item('Switch between note and to-do type', 'toggleNoteType', [noteIds]));
		} else {
			items.push(item('Switch to note type', 'searchSortSwitchToNoteType', [noteIds, 'note']));
			items.push(item('Switch to to-do type', 'searchSortSwitchToNoteType', [noteIds, 'todo']));
		}

		items.push(item('Move to notebook', 'moveToFolder', [noteIds]));
		items.push(item('Duplicate', 'duplicateNote', [noteIds]));
		items.push(item('Delete note', 'deleteNote', [noteIds]));
		items.push(item('Copy Markdown link', 'searchSortCopyMarkdownLink', [noteIds]));

		if (noteIds.length === 1) {
			items.push(item('Copy external link', 'searchSortCopyExternalLink', [noteIds]));
		}

		const includesHtmlNotes = notes.some(n => n.markup_language === MARKUP_LANGUAGE_HTML);
		if (includesHtmlNotes) {
			items.push(item('Convert to Markdown', 'convertNoteToMarkdown', [noteIds]));
		}

		if (SHARE_NOTE_SYNC_TARGETS.has(input.syncTarget ?? 0)) {
			items.push(item('Share note...', 'showShareNoteDialog', [...noteIds]));
		}

		items.push(item('Export PDF', 'exportPdf', [noteIds]));
	}

	if (includeDeletedNotes) {
		items.push(item('Restore note', 'restoreNote', [noteIds]));
		items.push(item('Permanently delete note', 'permanentlyDeleteNote', [noteIds]));
	}

	return items;
}

export function markdownLinkForNote(note: Pick<NoteContextMenuNote, 'id' | 'title'>): string {
	const title = (note.title || 'Untitled').replace(/\]/g, '\\]');
	return `[${title}](:/${note.id})`;
}

export function externalLinkForNote(noteId: string): string {
	return `joplin://x-callback-url/openNote?id=${encodeURIComponent(noteId)}`;
}
