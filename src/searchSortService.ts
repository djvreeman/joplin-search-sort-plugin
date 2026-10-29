import {
	applyFolderBrowseSort,
	apiOrderParams,
	effectiveResultLimit,
	type SortDefaults,
} from './folderBrowseSort';
import {
	allowedFolderIds,
	noteMatchesAndFilters,
	ocrSupplementPlan,
	type FolderRecord,
	type OcrSupplementPlan,
} from './ocrSearch';

export type SortField = 'relevance' | 'updated' | 'created' | 'title' | 'notebook';
export type SortDirection = 'asc' | 'desc';

/** Joplin REST/search API rejects limits above 100 per request. */
export const MAX_SEARCH_LIMIT = 100;

/** Safety cap when fetching unlimited results. */
export const SAFETY_MAX_RESULTS = 5000;

export interface SearchResultNote {
  id: string;
  title: string;
  created_time: number;
  updated_time: number;
  parent_id: string;
  order?: number;
}

export interface SearchRow {
  id: string;
  title: string;
  createdTime: number;
  updatedTime: number;
  notebookId: string;
  notebookTitle: string;
  relevanceRank: number;
}

export interface SearchRequest {
  query: string;
  sortField: SortField;
  sortDirection: SortDirection;
  maxResults: number;
}

export interface FolderListRequest extends SortDefaults {
  folderId: string;
  sortField: SortField;
  sortDirection: SortDirection;
  maxResults: number;
}

export interface SearchResponse {
  rows: SearchRow[];
  query: string;
  sortField: SortField;
  sortDirection: SortDirection;
  hasMore: boolean;
  truncated: boolean;
  resultLimit?: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareByDirection(base: number, direction: SortDirection): number {
  return direction === 'asc' ? base : -base;
}

function compareRows(a: SearchRow, b: SearchRow, field: SortField, direction: SortDirection): number {
  let result = 0;

  if (field === 'relevance') {
    result = a.relevanceRank - b.relevanceRank;
    if (result === 0) result = collator.compare(a.title, b.title);
    if (result === 0) result = a.id.localeCompare(b.id);
    return compareByDirection(result, direction);
  }

  if (field === 'updated') {
    result = a.updatedTime - b.updatedTime;
  } else if (field === 'created') {
    result = a.createdTime - b.createdTime;
  } else if (field === 'title') {
    result = collator.compare(a.title, b.title);
  } else if (field === 'notebook') {
    result = collator.compare(a.notebookTitle, b.notebookTitle);
  }

  if (result === 0) result = collator.compare(a.title, b.title);
  if (result === 0) result = a.id.localeCompare(b.id);
  return compareByDirection(result, direction);
}

export function sortRows(rows: SearchRow[], field: SortField, direction: SortDirection): SearchRow[] {
  const cloned = [...rows];
  cloned.sort((a, b) => compareRows(a, b, field, direction));
  return cloned;
}

export function normalizeMaxResults(maxResults: number): number {
  if (!Number.isFinite(maxResults) || maxResults < 0) return 0;
  return Math.floor(maxResults);
}

async function loadFolders(joplin: any): Promise<FolderRecord[]> {
  const folders: FolderRecord[] = [];
  let page = 1;

  while (true) {
    const result = await joplin.data.get(['folders'], {
      fields: ['id', 'title', 'parent_id'],
      page,
      limit: MAX_SEARCH_LIMIT,
    });
    const items = Array.isArray(result.items) ? result.items : [];

    for (const folder of items) {
      folders.push({
        id: folder.id,
        title: folder.title || '(Untitled notebook)',
        parentId: folder.parent_id || '',
      });
    }

    if (!result.has_more) break;
    page += 1;
  }

  return folders;
}

function notebookMapFromFolders(folders: FolderRecord[]): Map<string, string> {
  return new Map(folders.map(folder => [folder.id, folder.title || '(Untitled notebook)']));
}

const OCR_NOTE_FIELDS = [
  'id',
  'title',
  'created_time',
  'updated_time',
  'parent_id',
  'is_todo',
  'todo_completed',
  'todo_due',
  'user_created_time',
  'user_updated_time',
  'latitude',
  'longitude',
  'altitude',
  'source_url',
];

async function noteIdsForTag(joplin: any, pattern: string): Promise<Set<string>> {
  const tagIds: string[] = [];
  let page = 1;

  while (true) {
    const result = await joplin.data.get(['search'], {
      query: pattern,
      type: 'tag',
      fields: ['id'],
      limit: MAX_SEARCH_LIMIT,
      page,
    });
    const items = Array.isArray(result.items) ? result.items : [];
    for (const tag of items) {
      if (tag?.id) tagIds.push(tag.id);
    }
    if (!result.has_more) break;
    page += 1;
  }

  const noteIds = new Set<string>();
  for (const tagId of tagIds) {
    page = 1;
    while (true) {
      const result = await joplin.data.get(['tags', tagId, 'notes'], {
        fields: ['id'],
        limit: MAX_SEARCH_LIMIT,
        page,
      });
      const items = Array.isArray(result.items) ? result.items : [];
      for (const note of items) {
        if (note?.id) noteIds.add(note.id);
      }
      if (!result.has_more) break;
      page += 1;
    }
  }

  return noteIds;
}

async function applyTagFilters(
  joplin: any,
  notes: SearchResultNote[],
  plan: OcrSupplementPlan,
): Promise<SearchResultNote[]> {
  if (!plan.tags.length) return notes;

  let allowed: Set<string> | null = null;
  for (const filter of plan.tags) {
    if (filter.negated) continue;
    const ids = await noteIdsForTag(joplin, filter.pattern);
    if (!allowed) {
      allowed = ids;
      continue;
    }
    const next = new Set<string>();
    for (const id of allowed) {
      if (ids.has(id)) next.add(id);
    }
    allowed = next;
  }

  for (const filter of plan.tags) {
    if (!filter.negated) continue;
    const ids = await noteIdsForTag(joplin, filter.pattern);
    if (!allowed) allowed = new Set(notes.map(note => note.id));
    for (const id of ids) allowed.delete(id);
  }

  const allowedIds = allowed;
  if (!allowedIds) return notes;
  return notes.filter(note => allowedIds.has(note.id));
}

async function noteMatchesVerifyFilters(
  joplin: any,
  noteId: string,
  filters: string[],
): Promise<boolean> {
  const result = await joplin.data.get(['search'], {
    query: [`id:${noteId}`, ...filters].join(' '),
    fields: ['id'],
    limit: 10,
    page: 1,
  });
  const items = Array.isArray(result.items) ? result.items : [];
  return items.some((item: { id?: string }) => item?.id === noteId);
}

async function applyVerifyFilters(
  joplin: any,
  notes: SearchResultNote[],
  filters: string[],
): Promise<SearchResultNote[]> {
  if (!filters.length) return notes;

  const kept: SearchResultNote[] = [];
  const batchSize = 8;
  for (let index = 0; index < notes.length; index += batchSize) {
    const batch = notes.slice(index, index + batchSize);
    const results = await Promise.all(batch.map(async note => {
      try {
        return await noteMatchesVerifyFilters(joplin, note.id, filters) ? note : null;
      } catch (error) {
        console.warn('Advanced Search Sort could not check OCR note filters:', error);
        return null;
      }
    }));
    for (const note of results) {
      if (note) kept.push(note);
    }
  }
  return kept;
}

async function ocrMatchNotes(
  joplin: any,
  plan: OcrSupplementPlan,
  folders: FolderRecord[],
  seenIds: Set<string>,
  maxResults: number,
): Promise<{ notes: SearchResultNote[]; truncated: boolean }> {
  const queries = plan.orMode ? plan.orTextQueries : [plan.textQuery];
  const byId = new Map<string, SearchResultNote>();
  let truncated = false;

  for (const textQuery of queries) {
    const page = await fetchSearchPages(joplin, textQuery, OCR_NOTE_FIELDS, maxResults);
    if (page.truncated || page.hasMore) truncated = true;
    for (const item of page.items) {
      if (!item?.id || seenIds.has(item.id) || byId.has(item.id)) continue;
      byId.set(item.id, item);
    }
  }

  let notes = [...byId.values()];
  const folderIds = allowedFolderIds(folders, plan.notebooks);
  if (folderIds) {
    notes = notes.filter(note => folderIds.has(note.parent_id || ''));
  }

  if (!plan.orMode) {
    notes = await applyTagFilters(joplin, notes, plan);
    notes = notes.filter(note => noteMatchesAndFilters(note, plan));
    notes = await applyVerifyFilters(joplin, notes, plan.verifyFilters);
  }

  return { notes, truncated };
}

async function fetchSearchPages(
  joplin: any,
  query: string,
  noteFields: string[],
  maxResults: number,
): Promise<{ items: SearchResultNote[]; hasMore: boolean; truncated: boolean; resultLimit: number }> {
  const items: SearchResultNote[] = [];
  let page = 1;
  let hasMore = false;
  let truncated = false;
  const unlimited = maxResults === 0;
  const targetMax = effectiveResultLimit(maxResults, SAFETY_MAX_RESULTS);

  while (true) {
    const result = await joplin.data.get(['search'], {
      query,
      fields: noteFields,
      limit: MAX_SEARCH_LIMIT,
      page,
    });

    const pageItems: SearchResultNote[] = Array.isArray(result.items) ? result.items : [];
    items.push(...pageItems);

    if (items.length >= targetMax) {
      if (items.length > targetMax) {
        items.length = targetMax;
      }
      truncated = items.length >= targetMax && !!result.has_more;
      hasMore = !!result.has_more;
      break;
    }

    if (!result.has_more) {
      hasMore = false;
      break;
    }

    page += 1;
  }

  return { items, hasMore, truncated, resultLimit: targetMax };
}

async function fetchFolderNotePages(
  joplin: any,
  folderId: string,
  noteFields: string[],
  maxResults: number,
  order?: { order_by: string; order_dir: 'ASC' | 'DESC' } | null,
): Promise<{ items: SearchResultNote[]; hasMore: boolean; truncated: boolean; resultLimit: number }> {
  const items: SearchResultNote[] = [];
  let page = 1;
  let hasMore = false;
  let truncated = false;
  const targetMax = effectiveResultLimit(maxResults, SAFETY_MAX_RESULTS);

  while (true) {
    const query: Record<string, unknown> = {
      fields: noteFields,
      limit: MAX_SEARCH_LIMIT,
      page,
    };
    if (order) {
      query.order_by = order.order_by;
      query.order_dir = order.order_dir;
    }

    const result = await joplin.data.get(['folders', folderId, 'notes'], query);

    const pageItems: SearchResultNote[] = Array.isArray(result.items) ? result.items : [];
    items.push(...pageItems);

    if (items.length >= targetMax) {
      if (items.length > targetMax) {
        items.length = targetMax;
      }
      truncated = items.length >= targetMax && !!result.has_more;
      hasMore = !!result.has_more;
      break;
    }

    if (!result.has_more) {
      hasMore = false;
      break;
    }

    page += 1;
  }

  return { items, hasMore, truncated, resultLimit: targetMax };
}

function mapNotesToRows(
  items: SearchResultNote[],
  notebookMap: Map<string, string>,
): SearchRow[] {
  return items.map((item, index) => ({
    id: item.id,
    title: item.title || '(Untitled)',
    createdTime: item.created_time || 0,
    updatedTime: item.updated_time || 0,
    notebookId: item.parent_id || '',
    notebookTitle: notebookMap.get(item.parent_id) || '(Unknown notebook)',
    relevanceRank: typeof item.order === 'number' ? item.order : index,
  }));
}

export async function listFolderNotes(joplin: any, request: FolderListRequest): Promise<SearchResponse & { folderTitle: string }> {
  const folderId = request.folderId.trim();
  if (!folderId) {
    return {
      rows: [],
      query: '',
      sortField: request.sortField,
      sortDirection: request.sortDirection,
      hasMore: false,
      truncated: false,
      folderTitle: '',
    };
  }

  const folderResult = await joplin.data.get(['folders', folderId], { fields: ['id', 'title'] });
  const folderTitle = folderResult?.title || '(Untitled notebook)';

  const noteFields = ['id', 'title', 'created_time', 'updated_time', 'parent_id'];
  const maxResults = normalizeMaxResults(request.maxResults);
  const resolvedSort = applyFolderBrowseSort(
    request.sortField,
    request.sortDirection,
    request,
  );
  const apiOrder = apiOrderParams(resolvedSort.sortField, resolvedSort.sortDirection);
  const { items, hasMore, truncated, resultLimit } = await fetchFolderNotePages(
    joplin,
    folderId,
    noteFields,
    maxResults,
    apiOrder,
  );
  const notebookMap = notebookMapFromFolders(await loadFolders(joplin));
  const rows = mapNotesToRows(items, notebookMap);

  return {
    rows: sortRows(rows, resolvedSort.sortField, resolvedSort.sortDirection),
    query: '',
    sortField: resolvedSort.sortField,
    sortDirection: resolvedSort.sortDirection,
    hasMore,
    truncated,
    resultLimit: truncated ? resultLimit : undefined,
    folderTitle,
  };
}

export async function runSearch(joplin: any, request: SearchRequest): Promise<SearchResponse> {
  const query = request.query.trim();
  if (!query) {
    return {
      rows: [],
      query,
      sortField: request.sortField,
      sortDirection: request.sortDirection,
      hasMore: false,
      truncated: false,
    };
  }

  const noteFields = ['id', 'title', 'created_time', 'updated_time', 'parent_id'];
  const maxResults = normalizeMaxResults(request.maxResults);
  const primary = await fetchSearchPages(joplin, query, noteFields, maxResults);
  const folders = await loadFolders(joplin);
  let items = primary.items;
  let hasMore = primary.hasMore;
  let truncated = primary.truncated;

  const ocrPlan = ocrSupplementPlan(query);
  if (ocrPlan) {
    try {
      const supplement = await ocrMatchNotes(
        joplin,
        ocrPlan,
        folders,
        new Set(items.map(item => item.id)),
        maxResults,
      );
      if (supplement.notes.length) {
        items = items.concat(supplement.notes);
        const targetMax = primary.resultLimit;
        if (items.length > targetMax) {
          items.length = targetMax;
          truncated = true;
          hasMore = true;
        }
      }
    } catch (error) {
      console.warn('Advanced Search Sort OCR search failed:', error);
    }
  }

  const notebookMap = notebookMapFromFolders(folders);
  const rows = mapNotesToRows(items, notebookMap);

  return {
    rows: sortRows(rows, request.sortField, request.sortDirection),
    query,
    sortField: request.sortField,
    sortDirection: request.sortDirection,
    hasMore,
    truncated,
    resultLimit: truncated ? primary.resultLimit : undefined,
  };
}
