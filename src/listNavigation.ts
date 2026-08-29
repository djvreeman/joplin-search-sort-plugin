/**
 * After removing a note from a sorted list, pick the next note at the same
 * visual index (inbox-processing). Uses the list's current order — not Joplin's
 * default note-list sort.
 */
export function nextNoteIdAfterRemoval(
  rows: Array<{ id: string }>,
  removedNoteId: string,
): { rows: Array<{ id: string }>; nextId: string | null; index: number } {
  const index = rows.findIndex(r => r.id === removedNoteId);
  if (index < 0) {
    return { rows: [...rows], nextId: null, index: -1 };
  }

  const nextRows = rows.slice(0, index).concat(rows.slice(index + 1));
  const nextId = nextRows.length
    ? nextRows[Math.min(index, nextRows.length - 1)].id
    : null;

  return { rows: nextRows, nextId, index };
}

/**
 * Move up/down within the current panel sort order. Does not wrap at ends.
 */
export function noteIdAtOffset(
  rows: Array<{ id: string }>,
  currentId: string | null,
  delta: number,
): string | null {
  if (!rows.length || !delta) return currentId;

  let index = currentId ? rows.findIndex(r => r.id === currentId) : -1;
  if (index < 0) {
    return rows[delta > 0 ? 0 : rows.length - 1].id;
  }

  const nextIndex = Math.max(0, Math.min(rows.length - 1, index + delta));
  return rows[nextIndex].id;
}

/** Joplin ItemChangeEventType */
export const NOTE_EVENT_DELETE = 3;

export type NoteListingDecision = 'stay' | 'left_scope' | 'deleted' | 'inconclusive';

/**
 * Decide whether a note should leave the scoped listing.
 * Auto-advance must only happen for left_scope / deleted — never for title/tag
 * updates (stay) or failed meta reads (inconclusive).
 */
export function decideNoteListingMembership(input: {
  scopedNotebookId: string | null;
  searchAllNotebooks: boolean;
  meta: { parentId: string; deletedTime?: number } | null;
  eventType?: number | null;
}): NoteListingDecision {
  // Explicit delete events always leave the listing (hard or soft delete).
  if (input.eventType === NOTE_EVENT_DELETE) return 'deleted';

  if (!input.meta) {
    return 'inconclusive';
  }

  // Soft-deleted notes stay in the DB with parent_id; exclude them from the list.
  if (input.meta.deletedTime) return 'deleted';

  // No notebook scope: in-place edits never imply "moved out".
  if (input.searchAllNotebooks || !input.scopedNotebookId) {
    return 'stay';
  }

  if (input.meta.parentId !== input.scopedNotebookId) {
    return 'left_scope';
  }

  return 'stay';
}
