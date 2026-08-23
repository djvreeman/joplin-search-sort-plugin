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
