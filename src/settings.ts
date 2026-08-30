import type { SortDirection, SortField } from './searchSortService';
import { SAFETY_MAX_RESULTS } from './searchSortService';

export const SETTINGS = {
  defaultSortField: 'defaultSortField',
  defaultSortDirection: 'defaultSortDirection',
  maxResults: 'maxResults',
  preserveLastState: 'preserveLastState',
  panelColumns: 'panelColumns',
  lastQuery: 'lastQuery',
  lastSortField: 'lastSortField',
  lastSortDirection: 'lastSortDirection',
  lastNotebookId: 'lastNotebookId',
  searchAllNotebooks: 'searchAllNotebooks',
};

export async function registerSettings(joplin: any): Promise<void> {
  await joplin.settings.registerSection('searchSortSection', {
    label: 'Advanced Search Sort',
    iconName: 'fas fa-sort',
  });

  await joplin.settings.registerSettings({
    [SETTINGS.defaultSortField]: {
      value: 'relevance',
      type: 2,
      isEnum: true,
      public: true,
      section: 'searchSortSection',
      label: 'Default sort field',
      options: {
        relevance: 'Relevance',
        updated: 'Updated',
        created: 'Created',
        title: 'Title',
        notebook: 'Notebook',
      },
    },
    [SETTINGS.defaultSortDirection]: {
      value: 'desc',
      type: 2,
      isEnum: true,
      public: true,
      section: 'searchSortSection',
      label: 'Default sort direction',
      options: {
        asc: 'Ascending',
        desc: 'Descending',
      },
    },
    [SETTINGS.maxResults]: {
      value: 0,
      type: 1,
      public: true,
      section: 'searchSortSection',
      label: 'Maximum notes to load',
      description: `0 uses the default cap of ${SAFETY_MAX_RESULTS} notes (not unlimited). Enter a higher number to load more. API loads 100 per page.`,
    },
    [SETTINGS.preserveLastState]: {
      value: true,
      type: 3,
      public: true,
      section: 'searchSortSection',
      label: 'Preserve last query and sort',
    },
    [SETTINGS.lastQuery]: {
      value: '',
      type: 2,
      public: false,
      section: 'searchSortSection',
      label: 'Last query',
    },
    [SETTINGS.lastSortField]: {
      value: 'relevance',
      type: 2,
      public: false,
      section: 'searchSortSection',
      label: 'Last sort field',
    },
    [SETTINGS.lastSortDirection]: {
      value: 'desc',
      type: 2,
      public: false,
      section: 'searchSortSection',
      label: 'Last sort direction',
    },
    [SETTINGS.panelColumns]: {
      value: '',
      type: 2,
      public: false,
      section: 'searchSortSection',
      label: 'Panel column layout',
    },
    [SETTINGS.lastNotebookId]: {
      value: '',
      type: 2,
      public: false,
      section: 'searchSortSection',
      label: 'Last scoped notebook ID',
    },
    [SETTINGS.searchAllNotebooks]: {
      value: false,
      type: 3,
      public: false,
      section: 'searchSortSection',
      label: 'Search all notebooks (ignore sidebar folder)',
    },
  });
}

export async function readRuntimeSettings(joplin: any): Promise<{
  defaultSortField: SortField;
  defaultSortDirection: SortDirection;
  maxResults: number;
  preserveLastState: boolean;
  panelColumns: string;
  lastQuery: string;
  lastSortField: SortField;
  lastSortDirection: SortDirection;
  lastNotebookId: string;
  searchAllNotebooks: boolean;
}> {
  return {
    defaultSortField: await joplin.settings.value(SETTINGS.defaultSortField),
    defaultSortDirection: await joplin.settings.value(SETTINGS.defaultSortDirection),
    maxResults: await joplin.settings.value(SETTINGS.maxResults),
    preserveLastState: await joplin.settings.value(SETTINGS.preserveLastState),
    panelColumns: await joplin.settings.value(SETTINGS.panelColumns),
    lastQuery: await joplin.settings.value(SETTINGS.lastQuery),
    lastSortField: await joplin.settings.value(SETTINGS.lastSortField),
    lastSortDirection: await joplin.settings.value(SETTINGS.lastSortDirection),
    lastNotebookId: await joplin.settings.value(SETTINGS.lastNotebookId),
    searchAllNotebooks: await joplin.settings.value(SETTINGS.searchAllNotebooks),
  };
}
