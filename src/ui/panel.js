(function () {
  const COLUMN_META = {
    relevance: { label: 'Relevance', minWidth: 40, defaultWidth: 52 },
    updated: { label: 'Updated', minWidth: 50, defaultWidth: 84 },
    created: { label: 'Created', minWidth: 50, defaultWidth: 66 },
    title: { label: 'Title', minWidth: 80, defaultWidth: 0 },
    notebook: { label: 'Notebook', minWidth: 50, defaultWidth: 90 },
  };

  function readDomBootstrap() {
    const el = document.getElementById('ss-bootstrap');
    if (!el?.textContent) return null;
    try {
      return JSON.parse(el.textContent);
    } catch {
      return null;
    }
  }

  const state = {
    textQuery: '',
    sortField: 'relevance',
    sortDirection: 'desc',
    rows: [],
    columns: [],
    selectedNoteId: null,
    notebookScope: null,
    searchAllNotebooks: false,
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    searchTimer: null,
    dragField: null,
    suppressSortClick: false,
    folderPollId: null,
    lastPolledFolderId: null,
    startupComplete: false,
  };

  let queryInput;
  let searchActionBtn;
  let searchActionGlyph;
  let newNoteBtn;
  let statusLine;
  let resultsBody;
  let headerRow;
  let allNotebooksBtn;
  let scopeNotebookChip;
  let scopeChipLabel;
  let clearScopeBtn;

  function noteColumnWidth(notesColumns, name, fallback) {
    for (const col of notesColumns || []) {
      if (col.name === name && typeof col.width === 'number') {
        return col.width > 0 ? col.width : fallback;
      }
    }
    return fallback;
  }

  function buildDefaultColumns(notesColumns, savedColumns) {
    const defaults = {
      relevance: COLUMN_META.relevance.defaultWidth,
      updated: noteColumnWidth(notesColumns, 'note.user_updated_time', COLUMN_META.updated.defaultWidth),
      created: noteColumnWidth(notesColumns, 'note.user_created_time', COLUMN_META.created.defaultWidth),
      title: 0,
      notebook: noteColumnWidth(notesColumns, 'note.folder.title', COLUMN_META.notebook.defaultWidth),
    };

    if (Array.isArray(savedColumns) && savedColumns.length) {
      const saved = savedColumns
        .filter(col => COLUMN_META[col.field])
        .map(col => ({
          field: col.field,
          width: typeof col.width === 'number' ? col.width : defaults[col.field],
        }));

      const savedFields = new Set(saved.map(col => col.field));
      for (const field of ['relevance', 'updated', 'created', 'title', 'notebook']) {
        if (!savedFields.has(field)) {
          saved.push({ field, width: defaults[field] });
        }
      }
      return saved;
    }

    return ['relevance', 'updated', 'created', 'title', 'notebook'].map(field => ({
      field,
      width: defaults[field],
    }));
  }

  function gridTemplateColumns() {
    return state.columns
      .map(col => (col.width === 0 ? 'minmax(0, 1fr)' : `${col.width}px`))
      .join(' ');
  }

  function applyGridTemplate() {
    const template = gridTemplateColumns();
    headerRow.style.gridTemplateColumns = template;
    for (const row of resultsBody.querySelectorAll('.row')) {
      row.style.gridTemplateColumns = template;
    }
  }

  function uiStatePayload() {
    return {
      textQuery: state.textQuery,
      notebookScope: state.notebookScope,
      searchAllNotebooks: state.searchAllNotebooks,
      sortField: state.sortField,
      sortDirection: state.sortDirection,
    };
  }

  async function persistColumns() {
    const response = await webviewApi.postMessage({
      type: 'saveColumnLayout',
      payload: { columns: state.columns },
    });
    if (response?.ok === false) {
      console.error('Failed to save column layout:', response.message);
    }
    return response;
  }

  async function persistUiState() {
    await webviewApi.postMessage({
      type: 'saveUiState',
      payload: uiStatePayload(),
    });
  }

  function updateSearchActionButton() {
    const hasText = queryInput.value.length > 0;
    searchActionBtn.classList.toggle('is-clear', hasText);
    searchActionBtn.setAttribute('aria-label', hasText ? 'Clear search' : 'Search');
    searchActionGlyph.classList.toggle('ss-glyph-search', !hasText);
    searchActionGlyph.classList.toggle('ss-glyph-clear', hasText);
  }

  function updateScopeBar() {
    const scoped = !!state.notebookScope && !state.searchAllNotebooks;
    allNotebooksBtn.classList.toggle('-active', !scoped);
    scopeNotebookChip.hidden = !scoped;
    if (scoped) {
      scopeChipLabel.textContent = state.notebookScope.title;
    }
  }

  function updateStatus(text) {
    statusLine.textContent = text;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const y = d.getFullYear();
      const m = pad2(d.getMonth() + 1);
      const day = pad2(d.getDate());
      if (state.dateFormat === 'YYYY-MM-DD') {
        return `${y} ${m} ${day}`;
      }
      return d.toLocaleDateString();
    } catch {
      return '';
    }
  }

  function cellValue(row, field) {
    if (field === 'relevance') return String(row.relevanceRank + 1);
    if (field === 'updated') return formatTimestamp(row.updatedTime);
    if (field === 'created') return formatTimestamp(row.createdTime);
    if (field === 'title') return row.title;
    if (field === 'notebook') return row.notebookTitle;
    return '';
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function sortRowsLocal(rows, field, direction) {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const factor = direction === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
      let result = 0;
      if (field === 'relevance') {
        result = a.relevanceRank - b.relevanceRank;
      } else if (field === 'updated') {
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
      return result * factor;
    });
  }

  function formatResultStatus(payload) {
    const count = Array.isArray(payload.rows) ? payload.rows.length : 0;
    const truncated = payload.truncated ? ' (limit reached)' : '';
    const text = state.textQuery.trim();
    if (state.notebookScope && !state.searchAllNotebooks) {
      if (text) {
        return `${count} results for "${text}" in ${state.notebookScope.title}${truncated}`;
      }
      return `${count} notes in ${state.notebookScope.title}${truncated}`;
    }
    if (text) {
      return `${count} results for "${text}"${truncated}`;
    }
    return `${count} results${truncated}`;
  }

  function updateListingStatusFromRows(truncated) {
    updateStatus(formatResultStatus({
      rows: state.rows,
      truncated: !!truncated,
    }));
  }

  async function fetchNoteMeta(noteId) {
    if (!noteId) return null;
    try {
      const response = await webviewApi.postMessage({
        type: 'getNoteMeta',
        payload: { noteId },
      });
      return response?.payload || null;
    } catch {
      return null;
    }
  }

  function noteStillInScope(meta) {
    if (!meta) return false;
    if (!state.notebookScope || state.searchAllNotebooks) return true;
    return meta.parentId === state.notebookScope.id;
  }

  function updateRowFromMeta(meta) {
    if (!meta) return;
    const row = state.rows.find(r => r.id === meta.id);
    if (!row) return;
    row.title = meta.title;
    row.updatedTime = meta.updatedTime;
    row.createdTime = meta.createdTime;
    row.notebookId = meta.parentId;
  }

  /**
   * Splice the note out and continue on the next row in the panel's current
   * sort order (not Joplin's default note-list sort).
   */
  function removeNoteFromListing(noteId, options) {
    const opts = options || {};
    const idx = state.rows.findIndex(r => r.id === noteId);
    if (idx < 0) return false;

    const shouldAdvance =
      opts.advanceSelection
      || state.selectedNoteId === noteId
      || opts.wasSelected;

    state.rows.splice(idx, 1);

    if (shouldAdvance) {
      const nextId = state.rows.length
        ? state.rows[Math.min(idx, state.rows.length - 1)].id
        : null;
      state.selectedNoteId = nextId;
      if (nextId) {
        webviewApi.postMessage({ type: 'openNote', payload: { noteId: nextId } });
      }
    }

    renderRows();
    updateListingStatusFromRows(false);
    return true;
  }

  async function reconcileNotePresence(noteId, options) {
    const opts = options || {};
    if (!noteId) return;
    const inList = state.rows.some(r => r.id === noteId);
    const scoped = !!state.notebookScope && !state.searchAllNotebooks;

    // Only need membership checks for notes we show, or the selected note under a folder scope.
    if (!inList && !scoped && !opts.wasSelected) return;

    const meta = await fetchNoteMeta(noteId);
    if (!meta || !noteStillInScope(meta)) {
      removeNoteFromListing(noteId, {
        wasSelected: !!opts.wasSelected,
        advanceSelection: !!opts.advanceSelection || !!opts.wasSelected,
      });
      return;
    }

    if (inList) {
      updateRowFromMeta(meta);
      renderRows();
    }
  }

  async function handleSelectionChanged(newNoteId) {
    const previousId = state.selectedNoteId;

    // Joplin may already have selected its own "next" note (default list sort).
    // If the previous note left our scoped notebook, advance using OUR sorted rows.
    if (previousId && previousId !== newNoteId) {
      const meta = await fetchNoteMeta(previousId);
      if (!meta || !noteStillInScope(meta)) {
        removeNoteFromListing(previousId, { wasSelected: true, advanceSelection: true });
        return;
      }
    }

    state.selectedNoteId = newNoteId || null;

    if (newNoteId) {
      await reconcileNotePresence(newNoteId, {});
    }

    renderRows();
  }

  async function handleNoteChanged(payload) {
    const noteId = payload?.noteId;

    // Create: refresh so new notes appear when in scope.
    if (payload?.eventType === 1) {
      scheduleListingRefresh(150);
      return;
    }

    // Update/Delete: if the changed note left scope (or was deleted), remove it.
    // Only advance selection when that note was the one we had open.
    if (noteId) {
      const wasSelected = state.selectedNoteId === noteId;
      await reconcileNotePresence(noteId, {
        wasSelected,
        advanceSelection: wasSelected,
      });
      return;
    }

    scheduleListingRefresh(150);
  }

  function renderHeader() {
    headerRow.innerHTML = '';
    headerRow.className = 'note-list-header grid-row';

    state.columns.forEach((col, index) => {
      const meta = COLUMN_META[col.field];
      const item = document.createElement('div');
      item.className = 'item';
      item.dataset.field = col.field;
      item.draggable = true;

      if (state.sortField === col.field) item.classList.add('-current');
      if (index === 0) item.classList.add('-first');

      if (index > 0) {
        const resizer = document.createElement('div');
        resizer.className = 'resizer';
        resizer.addEventListener('mousedown', e => {
          e.preventDefault();
          e.stopPropagation();
          startColumnResize(index - 1, e.clientX);
        });
        item.appendChild(resizer);
      }

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = meta.label;

      if (state.sortField === col.field) {
        const chevron = document.createElement('span');
        chevron.className = 'chevron';
        chevron.textContent = state.sortDirection === 'asc' ? '▲' : '▼';
        label.appendChild(chevron);
      }

      item.appendChild(label);

      item.addEventListener('click', () => {
        if (state.suppressSortClick) return;
        toggleSort(col.field);
      });

      item.addEventListener('dragstart', e => {
        state.dragField = col.field;
        state.suppressSortClick = true;
        item.classList.add('-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', col.field);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('-dragging');
        state.dragField = null;
        setTimeout(() => {
          state.suppressSortClick = false;
        }, 0);
      });

      item.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('-drop-target');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('-drop-target');
      });

      item.addEventListener('drop', e => {
        e.preventDefault();
        item.classList.remove('-drop-target');
        if (state.dragField) {
          reorderColumns(state.dragField, col.field);
        }
      });

      headerRow.appendChild(item);
    });

    applyGridTemplate();
  }

  function renderRows() {
    resultsBody.innerHTML = '';

    if (!state.rows.length) {
      if (state.textQuery.trim() || (state.notebookScope && !state.searchAllNotebooks)) {
        updateStatus('No results.');
      } else {
        updateStatus('Ready.');
      }
      return;
    }

    const template = gridTemplateColumns();

    for (const row of state.rows) {
      const wrapper = document.createElement('div');
      wrapper.className = 'note-list-item-wrapper';
      wrapper.dataset.id = row.id;

      const rowEl = document.createElement('div');
      rowEl.className = 'row grid-row';
      rowEl.style.gridTemplateColumns = template;
      if (state.selectedNoteId && row.id === state.selectedNoteId) {
        rowEl.classList.add('-selected');
      }

      rowEl.innerHTML = state.columns.map(col => {
        const isTitle = col.field === 'title';
        const value = cellValue(row, col.field);
        return `<div class="cell${isTitle ? ' cell-title' : ''}"><div class="cell-inner">${escapeHtml(value)}</div></div>`;
      }).join('');

      rowEl.addEventListener('click', () => {
        state.selectedNoteId = row.id;
        renderRows();
        webviewApi.postMessage({ type: 'openNote', payload: { noteId: row.id } });
      });

      wrapper.appendChild(rowEl);
      resultsBody.appendChild(wrapper);
    }
  }

  function applySearchResults(payload) {
    state.rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (payload.textQuery !== undefined) state.textQuery = payload.textQuery;
    if (payload.notebookScope !== undefined) state.notebookScope = payload.notebookScope;
    if (payload.searchAllNotebooks !== undefined) state.searchAllNotebooks = payload.searchAllNotebooks;
    state.sortField = payload.sortField || state.sortField;
    state.sortDirection = payload.sortDirection || state.sortDirection;
    if (payload.selectedNoteId !== undefined) state.selectedNoteId = payload.selectedNoteId;
    queryInput.value = state.textQuery;
    updateSearchActionButton();
    updateScopeBar();
    renderHeader();
    renderRows();
    updateStatus(formatResultStatus(payload));
  }

  function shouldRunSearch() {
    return !!state.textQuery.trim() || (!!state.notebookScope && !state.searchAllNotebooks);
  }

  async function runSearch() {
    state.textQuery = queryInput.value.trim();

    if (!shouldRunSearch()) {
      state.rows = [];
      renderRows();
      updateStatus('Ready.');
      void persistUiState();
      return;
    }

    updateStatus('Searching...');

    try {
      const response = await webviewApi.postMessage({
        type: 'runSearch',
        payload: uiStatePayload(),
      });

      if (response?.type === 'searchResults') {
        applySearchResults(response.payload);
        return;
      }

      if (response?.type === 'searchError') {
        updateStatus(`Search failed: ${response.payload?.message || 'Unknown error'}`);
        return;
      }

      updateStatus('Search failed: no response from plugin.');
    } catch (error) {
      updateStatus(`Search failed: ${error?.message || String(error)}`);
    }
  }

  function refreshListing() {
    if (shouldRunSearch()) {
      void runSearch();
    } else {
      state.rows = [];
      renderRows();
      updateStatus('Ready.');
    }
  }

  function ensureColumns(notesColumns, savedColumns) {
    const next = buildDefaultColumns(notesColumns, savedColumns);
    if (!Array.isArray(next) || !next.length) {
      state.columns = buildDefaultColumns(notesColumns, null);
      return;
    }
    state.columns = next;
  }

  function applyPayload(payload, notesColumns) {
    state.textQuery = payload.textQuery || '';
    state.sortField = payload.sortField || 'relevance';
    state.sortDirection = payload.sortDirection || 'desc';
    state.searchAllNotebooks = !!payload.searchAllNotebooks;
    state.notebookScope = payload.notebookScope || null;
    if (payload.selectedNoteId !== undefined) state.selectedNoteId = payload.selectedNoteId;
    if (payload.dateFormat) state.dateFormat = payload.dateFormat;
    if (payload.timeFormat) state.timeFormat = payload.timeFormat;

    // Always rebuild columns. Fresh installs have empty panelColumns; skipping
    // left state.columns as [] and rendered a blank list with a valid status count.
    ensureColumns(
      notesColumns ?? payload.notesColumns,
      Array.isArray(payload.panelColumns) && payload.panelColumns.length
        ? payload.panelColumns
        : null,
    );

    queryInput.value = state.textQuery;
    updateSearchActionButton();
    updateScopeBar();
    renderHeader();
    refreshListing();
  }

  function setNotebookScope(folderId, folderTitle) {
    state.notebookScope = folderId ? { id: folderId, title: folderTitle } : null;
    state.searchAllNotebooks = false;
    updateScopeBar();
    void persistUiState();
    refreshListing();
  }

  function clearNotebookScope() {
    state.notebookScope = null;
    state.searchAllNotebooks = true;
    updateScopeBar();
    void persistUiState();
    refreshListing();
  }

  function clearSearch() {
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
      state.searchTimer = null;
    }
    queryInput.value = '';
    state.textQuery = '';
    updateSearchActionButton();
    void persistUiState();
    refreshListing();
    queryInput.focus();
  }

  function toggleSort(field) {
    if (state.sortField === field) {
      state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortField = field;
      state.sortDirection = field === 'title' || field === 'notebook' ? 'asc' : 'desc';
    }
    renderHeader();
    void persistUiState();
    if (state.rows.length) {
      state.rows = sortRowsLocal(state.rows, state.sortField, state.sortDirection);
      renderRows();
    } else {
      refreshListing();
    }
  }

  function startColumnResize(columnIndex, startX) {
    const col = state.columns[columnIndex];
    const headerItem = headerRow.querySelector(`.item[data-field="${col.field}"]`);
    const startWidth = col.width === 0
      ? (headerItem ? headerItem.getBoundingClientRect().width : COLUMN_META[col.field].minWidth)
      : col.width;

    if (col.width === 0) {
      col.width = Math.round(startWidth);
    }

    function onMove(e) {
      const delta = e.clientX - startX;
      const minWidth = COLUMN_META[col.field].minWidth;
      col.width = Math.max(minWidth, Math.round(startWidth + delta));
      applyGridTemplate();
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      void persistColumns();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function reorderColumns(fromField, toField) {
    const fromIdx = state.columns.findIndex(c => c.field === fromField);
    const toIdx = state.columns.findIndex(c => c.field === toField);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    const [moved] = state.columns.splice(fromIdx, 1);
    state.columns.splice(toIdx, 0, moved);
    renderHeader();
    renderRows();
    void persistColumns();
  }

  function scheduleSearch() {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      void runSearch();
    }, 500);
  }

  let listingRefreshTimer = null;

  function scheduleListingRefresh(delayMs) {
    if (!state.startupComplete) return;
    if (listingRefreshTimer) clearTimeout(listingRefreshTimer);
    listingRefreshTimer = setTimeout(() => {
      listingRefreshTimer = null;
      refreshListing();
    }, delayMs);
  }

  async function pollSidebarFolder() {
    try {
      const response = await webviewApi.postMessage({ type: 'getFolderContext' });
      const folder = response?.payload;
      if (!folder) return;

      // Catch selection changes if postMessage events were dropped.
      const polledSelected = folder.selectedNoteId || null;
      if (polledSelected !== state.selectedNoteId) {
        await handleSelectionChanged(polledSelected);
      } else if (
        state.notebookScope
        && !state.searchAllNotebooks
        && state.selectedNoteId
      ) {
        // Safety net for notebook moves when selection has not changed yet.
        await reconcileNotePresence(state.selectedNoteId, {
          wasSelected: true,
          advanceSelection: true,
        });
      }

      if (!folder.folderId) return;
      if (folder.folderId === state.lastPolledFolderId) return;

      state.lastPolledFolderId = folder.folderId;
      setNotebookScope(folder.folderId, folder.folderTitle);
    } catch {
      // ignore polling errors
    }
  }

  async function loadInitialState() {
    const domBootstrap = readDomBootstrap();
    ensureColumns(
      null,
      Array.isArray(domBootstrap?.panelColumns) && domBootstrap.panelColumns.length
        ? domBootstrap.panelColumns
        : null,
    );
    renderHeader();

    try {
      const response = await webviewApi.postMessage({ type: 'getState' });
      if (response?.payload) {
        applyPayload(response.payload, response.payload.notesColumns);
        state.startupComplete = true;
      }
    } catch (error) {
      console.error('Advanced Search Sort failed to load state:', error);
    }

    if (!state.startupComplete && domBootstrap) {
      applyPayload(domBootstrap, null);
    } else if (!state.startupComplete) {
      ensureColumns(null, null);
      renderHeader();
      updateScopeBar();
      refreshListing();
    }

    try {
      const folderResponse = await webviewApi.postMessage({ type: 'getFolderContext' });
      state.lastPolledFolderId = folderResponse?.payload?.folderId || state.notebookScope?.id || null;
    } catch {
      state.lastPolledFolderId = state.notebookScope?.id || null;
    }

    state.startupComplete = true;
  }

  webviewApi.onMessage(message => {
    if (!message || !message.type) return;

    if (message.type === 'selectionChanged') {
      void handleSelectionChanged(message.payload?.noteId || null);
      return;
    }

    if (message.type === 'noteChanged') {
      void handleNoteChanged(message.payload || {});
      return;
    }

    if (message.type === 'notesMayHaveChanged') {
      scheduleListingRefresh(300);
    }
  });

  queryInput = document.getElementById('queryInput');
  searchActionBtn = document.getElementById('searchActionBtn');
  searchActionGlyph = searchActionBtn.querySelector('.ss-glyph');
  newNoteBtn = document.getElementById('newNoteBtn');
  statusLine = document.getElementById('statusLine');
  resultsBody = document.getElementById('resultsBody');
  headerRow = document.getElementById('headerRow');
  allNotebooksBtn = document.getElementById('allNotebooksBtn');
  scopeNotebookChip = document.getElementById('scopeNotebookChip');
  scopeChipLabel = scopeNotebookChip.querySelector('.scope-chip-label');
  clearScopeBtn = document.getElementById('clearScopeBtn');

  newNoteBtn.addEventListener('click', () => {
    webviewApi.postMessage({ type: 'newNote' });
  });

  allNotebooksBtn.addEventListener('click', () => {
    clearNotebookScope();
  });

  clearScopeBtn.addEventListener('click', () => {
    clearNotebookScope();
  });

  searchActionBtn.addEventListener('click', () => {
    if (queryInput.value.length > 0) {
      clearSearch();
      return;
    }
    if (state.searchTimer) clearTimeout(state.searchTimer);
    void runSearch();
  });

  queryInput.addEventListener('input', () => {
    updateSearchActionButton();
    scheduleSearch();
  });

  queryInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (state.searchTimer) clearTimeout(state.searchTimer);
      void runSearch();
    }
    if (e.key === 'Escape' && queryInput.value.length > 0) {
      clearSearch();
    }
  });

  void loadInitialState().then(() => {
    state.folderPollId = setInterval(() => {
      void pollSidebarFolder();
    }, 400);
  });
})();
