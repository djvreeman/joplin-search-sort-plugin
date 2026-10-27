/**
 * Note-list multi-select, matching Joplin's desktop note list:
 * Cmd/Ctrl-click toggles, Shift-click extends from the last selected id,
 * and a plain click replaces the selection.
 * Toggle is checked before Shift, same as Joplin's click handler.
 */

export function toggleNoteSelection(selectedIds: string[], noteId: string): string[] {
	if (!noteId) return selectedIds.slice();
	if (selectedIds.includes(noteId)) {
		// Joplin will not unselect the final remaining note.
		if (selectedIds.length <= 1) return selectedIds.slice();
		return selectedIds.filter(id => id !== noteId);
	}
	return selectedIds.concat(noteId);
}

/** Joplin NOTE_SELECT_EXTEND: add every row between the last selected id and noteId. */
export function extendNoteSelection(
	orderedIds: string[],
	selectedIds: string[],
	noteId: string,
): string[] {
	if (!noteId) return selectedIds.slice();
	if (!selectedIds.length) return [noteId];

	const anchorId = selectedIds[selectedIds.length - 1];
	if (anchorId === noteId) return selectedIds.slice();

	const next = selectedIds.slice();
	let started = false;
	for (const id of orderedIds) {
		const atEndpoint = id === anchorId || id === noteId;
		if (!started && atEndpoint) {
			started = true;
			if (!next.includes(id)) next.push(id);
			continue;
		}
		if (started && atEndpoint) {
			if (!next.includes(id)) next.push(id);
			break;
		}
		if (started && !next.includes(id)) next.push(id);
	}
	return next;
}

export function selectionAfterClick(
	orderedIds: string[],
	selectedIds: string[],
	noteId: string,
	modifiers: { toggleKey: boolean; shiftKey: boolean },
): string[] {
	if (!noteId) return selectedIds.slice();
	if (modifiers.toggleKey) return toggleNoteSelection(selectedIds, noteId);
	if (modifiers.shiftKey) return extendNoteSelection(orderedIds, selectedIds, noteId);
	return [noteId];
}

/**
 * Joplin Shift+Arrow: if the destination is already selected, drop the focused
 * note (unless it is the last one), then ensure the destination is selected.
 */
export function selectionAfterShiftMove(
	selectedIds: string[],
	focusedId: string | null,
	nextId: string,
): string[] {
	if (!nextId) return selectedIds.slice();
	let next = selectedIds.slice();
	if (!next.length && focusedId) next = [focusedId];
	if (next.includes(nextId) && focusedId && next.length > 1) {
		next = next.filter(id => id !== focusedId);
	}
	if (!next.includes(nextId)) next.push(nextId);
	return next;
}

/** Right-click an unselected row acts on that row; otherwise the whole selection. */
export function contextMenuTargetIds(selectedIds: string[], clickedId: string): string[] {
	if (!clickedId) return [];
	if (selectedIds.includes(clickedId)) return selectedIds.slice();
	return [clickedId];
}
