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

  // Keep in sync with listNavigation.ts (panel.js is not bundled with that module).
  const NOTE_EVENT_CREATE = 1;
  const NOTE_EVENT_DELETE = 3;

  function decideNoteListingMembership(meta, eventType) {
    if (!meta) {
      return eventType === NOTE_EVENT_DELETE ? 'deleted' : 'inconclusive';
    }
    if (state.searchAllNotebooks || !state.notebookScope) return 'stay';
    if (meta.parentId !== state.notebookScope.id) return 'left_scope';
    return 'stay';
  }

  function columnMetaChanged(row, meta) {
    return row.title !== meta.title
      || row.updatedTime !== meta.updatedTime
      || row.createdTime !== meta.createdTime
      || row.notebookId !== meta.parentId
      || (meta.notebookTitle && row.notebookTitle !== meta.notebookTitle);
  }

  function applyColumnMetaToRow(row, meta) {
    row.title = meta.title;
    row.updatedTime = meta.updatedTime;
    row.createdTime = meta.createdTime;
    row.notebookId = meta.parentId;
    if (meta.notebookTitle) row.notebookTitle = meta.notebookTitle;
  }

  function sortFieldAffectedByMeta(before, meta) {
    if (state.sortField === 'title') return before.title !== meta.title;
    if (state.sortField === 'updated') return before.updatedTime !== meta.updatedTime;
    if (state.sortField === 'created') return before.createdTime !== meta.createdTime;
    if (state.sortField === 'notebook') {
      return before.notebookId !== meta.parentId
        || (meta.notebookTitle && before.notebookTitle !== meta.notebookTitle);
    }
    return false;
  }

  function patchRowDom(row) {
    const wrapper = resultsBody.querySelector(`.note-list-item-wrapper[data-id="${row.id}"]`);
    if (!wrapper) return false;
    const rowEl = wrapper.querySelector('.row');
    if (!rowEl) return false;
    const cells = rowEl.querySelectorAll(':scope > .cell');
    state.columns.forEach((col, index) => {
      if (col.field === 'relevance') return;
      const inner = cells[index]?.querySelector('.cell-inner');
      if (inner) inner.textContent = cellValue(row, col.field);
    });
    return true;
  }

  /**
   * Refresh Title / Updated / Created / Notebook cells for a listed note.
   * Does not change selection. Re-sorts only when the active sort column changed.
   */
  function updateListedNoteColumns(meta) {
    if (!meta) return false;
    const row = state.rows.find(r => r.id === meta.id);
    if (!row) return false;
    if (!columnMetaChanged(row, meta)) return false;

    const before = {
      title: row.title,
      updatedTime: row.updatedTime,
      createdTime: row.createdTime,
      notebookId: row.notebookId,
      notebookTitle: row.notebookTitle,
    };
    const needsResort = sortFieldAffectedByMeta(before, meta);
    applyColumnMetaToRow(row, meta);

    if (needsResort) {
      const scrollTop = resultsBody.scrollTop;
      state.rows = sortRowsLocal(state.rows, state.sortField, state.sortDirection);
      renderRows();
      resultsBody.scrollTop = scrollTop;
    } else if (!patchRowDom(row)) {
      renderRows();
    }
    return true;
  }

  /**
   * Splice the note out and optionally continue on the next row in the panel's
   * current sort order (not Joplin's default note-list sort).
   */
  function removeNoteFromListing(noteId, options) {
    const opts = options || {};
    const idx = state.rows.findIndex(r => r.id === noteId);
    if (idx < 0) {
      if (opts.advanceSelection && state.selectedNoteId === noteId) {
        state.selectedNoteId = null;
      }
      return false;
    }

    const shouldAdvance = !!opts.advanceSelection;
    state.rows.splice(idx, 1);

    if (shouldAdvance) {
      const nextId = state.rows.length
        ? state.rows[Math.min(idx, state.rows.length - 1)].id
        : null;
      state.selectedNoteId = nextId;
      if (nextId) {
        webviewApi.postMessage({ type: 'openNote', payload: { noteId: nextId } });
      }
    } else if (state.selectedNoteId === noteId) {
      state.selectedNoteId = null;
    }

    renderRows();
    updateListingStatusFromRows(false);
    return true;
  }

  /**
   * Only remove/advance when the note left the scoped notebook or was deleted.
   * In-scope edits update column cells and keep selection.
   * Failed meta reads are inconclusive — never treat them as a notebook move.
   */
  async function reconcileNotePresence(noteId, options) {
    const opts = options || {};
    if (!noteId) return 'inconclusive';

    const inList = state.rows.some(r => r.id === noteId);
    if (!inList && !opts.wasSelected && !opts.checkEvenIfMissing) return 'stay';

    const meta = await fetchNoteMeta(noteId);
    const decision = decideNoteListingMembership(meta, opts.eventType ?? null);

    if (decision === 'left_scope' || decision === 'deleted') {
      removeNoteFromListing(noteId, {
        advanceSelection: !!opts.advanceSelection,
      });
      return decision;
    }

    if (decision === 'stay' && meta) {
      updateListedNoteColumns(meta);
    }

    return decision;
  }

  /** Display-only sync for the selected listed note (no selection changes). */
  async function syncSelectedNoteColumns() {
    const noteId = state.selectedNoteId;
    if (!noteId) return;
    if (!state.rows.some(r => r.id === noteId)) return;

    const meta = await fetchNoteMeta(noteId);
    if (!meta) return;

    // Notebook moves are handled by noteChanged / selectionChanged — not here.
    if (
      state.notebookScope
      && !state.searchAllNotebooks
      && meta.parentId !== state.notebookScope.id
    ) {
      return;
    }

    updateListedNoteColumns(meta);
  }

  async function handleSelectionChanged(newNoteId) {
    const previousId = state.selectedNoteId;
    const listHadFocus = resultsBody.contains(document.activeElement);

    // Joplin often selects its own "next" note after a notebook move.
    // Only override when the previous note was in OUR listing and left the
    // scoped notebook — not when the user simply switches notebooks/notes.
    if (previousId && previousId !== newNoteId) {
      const wasInListing = state.rows.some(r => r.id === previousId);
      if (wasInListing) {
        const meta = await fetchNoteMeta(previousId);
        const decision = decideNoteListingMembership(meta, null);
        if (decision === 'left_scope' || decision === 'deleted') {
          removeNoteFromListing(previousId, { advanceSelection: true });
          return;
        }
      }
    }

    state.selectedNoteId = newNoteId || null;
    renderRows();
    if (listHadFocus) {
      scrollSelectedIntoView();
      focusSelectedRow();
    }
  }

  async function handleNoteChanged(payload) {
    const noteId = payload?.noteId;
    const eventType = payload?.eventType ?? null;

    // Create: refresh so new notes appear when in scope.
    if (eventType === NOTE_EVENT_CREATE) {
      scheduleListingRefresh(150);
      return;
    }

    // Updates: refresh Title/Updated/Created/Notebook in place.
    // Advance selection ONLY when parent notebook left the current scope (or delete).
    if (noteId) {
      const wasSelected = state.selectedNoteId === noteId;
      await reconcileNotePresence(noteId, {
        wasSelected,
        advanceSelection: wasSelected,
        eventType,
        checkEvenIfMissing: wasSelected,
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
      rowEl.setAttribute('role', 'option');
      const isSelected = !!(state.selectedNoteId && row.id === state.selectedNoteId);
      rowEl.tabIndex = isSelected ? 0 : -1;
      if (isSelected) {
        rowEl.classList.add('-selected');
        rowEl.setAttribute('aria-selected', 'true');
      } else {
        rowEl.setAttribute('aria-selected', 'false');
      }

      rowEl.innerHTML = state.columns.map(col => {
        const isTitle = col.field === 'title';
        const value = cellValue(row, col.field);
        return `<div class="cell${isTitle ? ' cell-title' : ''}"><div class="cell-inner">${escapeHtml(value)}</div></div>`;
      }).join('');

      rowEl.addEventListener('click', () => {
        openListedNote(row.id, { focusRow: true });
      });

      rowEl.addEventListener('contextmenu', e => {
        e.preventDefault();
        void showNoteContextMenu(row.id);
      });

      wrapper.appendChild(rowEl);
      resultsBody.appendChild(wrapper);
    }
  }

  // Keep in sync with listNavigation.noteIdAtOffset (panel.js is not bundled with that module).
  function noteIdAtOffset(rows, currentId, delta) {
    if (!rows.length || !delta) return currentId;
    let index = currentId ? rows.findIndex(r => r.id === currentId) : -1;
    if (index < 0) {
      return rows[delta > 0 ? 0 : rows.length - 1].id;
    }
    const nextIndex = Math.max(0, Math.min(rows.length - 1, index + delta));
    return rows[nextIndex].id;
  }

  function focusSelectedRow() {
    if (!state.selectedNoteId) return;
    const wrapper = resultsBody.querySelector(
      `.note-list-item-wrapper[data-id="${state.selectedNoteId}"]`,
    );
    const rowEl = wrapper?.querySelector('.row');
    if (!rowEl) return;
    rowEl.focus({ preventScroll: true });
  }

  function scrollSelectedIntoView() {
    if (!state.selectedNoteId) return;
    const wrapper = resultsBody.querySelector(
      `.note-list-item-wrapper[data-id="${state.selectedNoteId}"]`,
    );
    wrapper?.scrollIntoView({ block: 'nearest' });
  }

  function openListedNote(noteId, options) {
    const opts = options || {};
    if (!noteId) return;
    state.selectedNoteId = noteId;
    renderRows();
    scrollSelectedIntoView();
    if (opts.focusRow) focusSelectedRow();
    webviewApi.postMessage({ type: 'openNote', payload: { noteId } });
  }

  async function showNoteContextMenu(noteId) {
    if (!noteId || typeof webviewApi.menuPopupFromTemplate !== 'function') return;

    // Match Joplin: right-click selects the note before showing the menu.
    if (state.selectedNoteId !== noteId) {
      state.selectedNoteId = noteId;
      renderRows();
      await webviewApi.postMessage({ type: 'openNote', payload: { noteId } });
    }

    try {
      const response = await webviewApi.postMessage({
        type: 'getNoteListContextMenu',
        payload: { noteIds: [noteId] },
      });
      const items = response?.payload?.items;
      if (Array.isArray(items) && items.length) {
        webviewApi.menuPopupFromTemplate(items);
      }
    } catch (error) {
      console.error('Advanced Search Sort failed to open context menu:', error);
    }
  }

  function navigateListedNote(delta) {
    const nextId = noteIdAtOffset(state.rows, state.selectedNoteId, delta);
    if (!nextId || nextId === state.selectedNoteId) {
      focusSelectedRow();
      return;
    }
    openListedNote(nextId, { focusRow: true });
  }

  function runNoteCommandForSelection(command) {
    if (!state.selectedNoteId || !state.rows.some(r => r.id === state.selectedNoteId)) return;
    void webviewApi.postMessage({
      type: 'runNoteCommand',
      payload: { noteId: state.selectedNoteId, command },
    });
  }

  function handlePanelKeydown(e) {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && !e.altKey && !e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === 't' || key === 'm') {
        if (state.selectedNoteId && state.rows.some(r => r.id === state.selectedNoteId)) {
          e.preventDefault();
          runNoteCommandForSelection(key === 't' ? 'setTags' : 'moveToFolder');
        }
        return;
      }
    }

    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (mod || e.altKey || e.shiftKey) return;

    const target = e.target;
    if (
      target === queryInput
      || (target && typeof target.closest === 'function' && target.closest('input, textarea, select'))
    ) {
      return;
    }

    if (!state.rows.length) return;
    if (!state.selectedNoteId || !state.rows.some(r => r.id === state.selectedNoteId)) return;

    e.preventDefault();
    navigateListedNote(e.key === 'ArrowDown' ? 1 : -1);
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

  let searchGeneration = 0;

  async function runSearch() {
    state.textQuery = queryInput.value.trim();

    if (!shouldRunSearch()) {
      state.rows = [];
      renderRows();
      updateStatus('Ready.');
      void persistUiState();
      return;
    }

    const generation = ++searchGeneration;
    const requestedScopeId = state.notebookScope?.id || null;
    const requestedAll = !!state.searchAllNotebooks;
    const requestedQuery = state.textQuery;

    updateStatus('Searching...');

    try {
      const response = await webviewApi.postMessage({
        type: 'runSearch',
        payload: uiStatePayload(),
      });

      // Ignore stale responses from a previous notebook/query (large folders race).
      if (generation !== searchGeneration) return;
      if ((state.notebookScope?.id || null) !== requestedScopeId) return;
      if (!!state.searchAllNotebooks !== requestedAll) return;
      if (state.textQuery !== requestedQuery) return;

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
      if (generation !== searchGeneration) return;
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

  let pollInFlight = false;

  async function pollSidebarFolder() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const response = await webviewApi.postMessage({ type: 'getFolderContext' });
      const folder = response?.payload;
      if (!folder) return;

      // Folder changes first. Do not run move-reconcile here — that was firing
      // getNoteMeta every poll and racing notebook switches on large folders.
      if (folder.folderId && folder.folderId !== state.lastPolledFolderId) {
        state.lastPolledFolderId = folder.folderId;
        if (folder.selectedNoteId) {
          state.selectedNoteId = folder.selectedNoteId;
        }
        setNotebookScope(folder.folderId, folder.folderTitle);
        return;
      }

      const polledSelected = folder.selectedNoteId || null;
      if (polledSelected !== state.selectedNoteId) {
        await handleSelectionChanged(polledSelected);
      } else {
        // Keep Title/Updated/Created/Notebook cells in sync while editing.
        // Display-only — never advances selection.
        await syncSelectedNoteColumns();
      }
    } catch {
      // ignore polling errors
    } finally {
      pollInFlight = false;
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
  resultsBody.setAttribute('role', 'listbox');
  resultsBody.setAttribute('aria-label', 'Search results');
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

  document.addEventListener('keydown', handlePanelKeydown);

  void loadInitialState().then(() => {
    state.folderPollId = setInterval(() => {
      void pollSidebarFolder();
    }, 400);
  });
})();
