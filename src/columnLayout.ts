/**
 * Pure column layout helpers used by the panel UI.
 * Kept here so fresh-install defaults can be unit-tested.
 */

export type ColumnField = 'relevance' | 'updated' | 'created' | 'title' | 'notebook';

export interface ColumnDef {
  field: ColumnField;
  width: number;
}

export interface NotesColumnSetting {
  name?: string;
  width?: number;
}

export const COLUMN_META: Record<ColumnField, { label: string; minWidth: number; defaultWidth: number }> = {
  relevance: { label: 'Relevance', minWidth: 40, defaultWidth: 52 },
  updated: { label: 'Updated', minWidth: 50, defaultWidth: 84 },
  created: { label: 'Created', minWidth: 50, defaultWidth: 66 },
  title: { label: 'Title', minWidth: 80, defaultWidth: 0 },
  notebook: { label: 'Notebook', minWidth: 50, defaultWidth: 90 },
};

export const DEFAULT_FIELDS: ColumnField[] = ['relevance', 'updated', 'created', 'title', 'notebook'];

function noteColumnWidth(
  notesColumns: NotesColumnSetting[] | null | undefined,
  name: string,
  fallback: number,
): number {
  for (const col of notesColumns || []) {
    if (col.name === name && typeof col.width === 'number') {
      return col.width > 0 ? col.width : fallback;
    }
  }
  return fallback;
}

function defaultWidths(notesColumns: NotesColumnSetting[] | null | undefined): Record<ColumnField, number> {
  return {
    relevance: COLUMN_META.relevance.defaultWidth,
    updated: noteColumnWidth(notesColumns, 'note.user_updated_time', COLUMN_META.updated.defaultWidth),
    created: noteColumnWidth(notesColumns, 'note.user_created_time', COLUMN_META.created.defaultWidth),
    title: 0,
    notebook: noteColumnWidth(notesColumns, 'note.folder.title', COLUMN_META.notebook.defaultWidth),
  };
}

export function buildDefaultColumns(
  notesColumns: NotesColumnSetting[] | null | undefined,
  savedColumns: Array<{ field?: string; width?: number }> | null | undefined,
): ColumnDef[] {
  const defaults = defaultWidths(notesColumns);

  if (Array.isArray(savedColumns) && savedColumns.length) {
    const saved: ColumnDef[] = savedColumns
      .filter((col): col is { field: ColumnField; width?: number } =>
        typeof col.field === 'string' && col.field in COLUMN_META,
      )
      .map(col => ({
        field: col.field,
        width: typeof col.width === 'number' ? col.width : defaults[col.field],
      }));

    const savedFields = new Set(saved.map(col => col.field));
    for (const field of DEFAULT_FIELDS) {
      if (!savedFields.has(field)) {
        saved.push({ field, width: defaults[field] });
      }
    }
    return saved;
  }

  return DEFAULT_FIELDS.map(field => ({
    field,
    width: defaults[field],
  }));
}
