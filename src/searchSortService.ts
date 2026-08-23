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

export interface FolderListRequest {
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

async function loadNotebookMap(joplin: any): Promise<Map<string, string>> {
  const notebookMap = new Map<string, string>();
  let page = 1;

  while (true) {
    const result = await joplin.data.get(['folders'], {
      fields: ['id', 'title'],
      page,
      limit: MAX_SEARCH_LIMIT,
    });
    const folders = Array.isArray(result.items) ? result.items : [];

    for (const folder of folders) {
      notebookMap.set(folder.id, folder.title || '(Untitled notebook)');
    }

    if (!result.has_more) break;
    page += 1;
  }

  return notebookMap;
}

async function fetchSearchPages(
  joplin: any,
  query: string,
  noteFields: string[],
  maxResults: number,
): Promise<{ items: SearchResultNote[]; hasMore: boolean; truncated: boolean }> {
  const items: SearchResultNote[] = [];
  let page = 1;
  let hasMore = false;
  let truncated = false;
  const unlimited = maxResults === 0;
  const targetMax = unlimited ? SAFETY_MAX_RESULTS : maxResults;

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
      truncated = unlimited ? items.length >= SAFETY_MAX_RESULTS : items.length >= maxResults;
      hasMore = !!result.has_more;
      break;
    }

    if (!result.has_more) {
      hasMore = false;
      break;
    }

    page += 1;
  }

  return { items, hasMore, truncated };
}

async function fetchFolderNotePages(
  joplin: any,
  folderId: string,
  noteFields: string[],
  maxResults: number,
): Promise<{ items: SearchResultNote[]; hasMore: boolean; truncated: boolean }> {
  const items: SearchResultNote[] = [];
  let page = 1;
  let hasMore = false;
  let truncated = false;
  const unlimited = maxResults === 0;
  const targetMax = unlimited ? SAFETY_MAX_RESULTS : maxResults;

  while (true) {
    const result = await joplin.data.get(['folders', folderId, 'notes'], {
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
      truncated = unlimited ? items.length >= SAFETY_MAX_RESULTS : items.length >= maxResults;
      hasMore = !!result.has_more;
      break;
    }

    if (!result.has_more) {
      hasMore = false;
      break;
    }

    page += 1;
  }

  return { items, hasMore, truncated };
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
  const { items, hasMore, truncated } = await fetchFolderNotePages(joplin, folderId, noteFields, maxResults);
  const notebookMap = await loadNotebookMap(joplin);
  const rows = mapNotesToRows(items, notebookMap);

  return {
    rows: sortRows(rows, request.sortField, request.sortDirection),
    query: '',
    sortField: request.sortField,
    sortDirection: request.sortDirection,
    hasMore,
    truncated,
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
  const { items, hasMore, truncated } = await fetchSearchPages(joplin, query, noteFields, maxResults);
  const notebookMap = await loadNotebookMap(joplin);
  const rows = mapNotesToRows(items, notebookMap);

  return {
    rows: sortRows(rows, request.sortField, request.sortDirection),
    query,
    sortField: request.sortField,
    sortDirection: request.sortDirection,
    hasMore,
    truncated,
  };
}
