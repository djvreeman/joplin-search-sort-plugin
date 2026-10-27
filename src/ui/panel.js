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

  const FOLDER_POLL_GRACE_MS = 3000;
  const NOTE_OPEN_FOLDER_SUPPRESS_MS = 3000;
  const LOCAL_SELECTION_MS = 1500;
  // Keep in sync with CONFLICT_FOLDER_ID / ATTACHMENT_CONFLICT_TITLE in conflicts.ts.
  const CONFLICT_FOLDER_ID = 'c04f1c7c04f1c7c04f1c7c04f1c7c04f';
  const ATTACHMENT_CONFLICT_TITLE = 'Conflicts (attachments)';

  const state = {
    textQuery: '',
    sortField: 'relevance',
    sortDirection: 'desc',
    defaultSortField: 'updated',
    defaultSortDirection: 'desc',
    rows: [],
    columns: [],
    selectedNoteId: null,
    selectedNoteIds: [],
    lastOpenedNoteId: null,
    localSelectionUntil: 0,
    notebookScope: null,
    searchAllNotebooks: false,
    listKind: 'notes',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    searchTimer: null,
    dragField: null,
    suppressSortClick: false,
    folderPollId: null,
    lastPolledFolderId: null,
    folderPollGraceUntil: 0,
    folderPollBaselineReady: false,
    startupComplete: false,
    pendingNoteOpen: null,
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
  let conflictBanner;
  let conflictActions;
  let conflictSummary;
  let conflictOpenCopyBtn;
  let conflictOpenOriginalBtn;
  let conflictKeepBtn;
  let conflictUseCopyBtn;
  let conflictOriginalLinks;
  let attachmentLoadToken = 0;

  function listKindFor(folderId, folderTitle) {
    if (folderId === CONFLICT_FOLDER_ID) return 'noteConflicts';
    if ((folderTitle || '') === ATTACHMENT_CONFLICT_TITLE) return 'attachmentConflicts';
    return 'notes';
  }

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
      listKind: state.listKind,
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
    updateConflictChrome();
  }

  function selectedConflictRow() {
    if (state.listKind !== 'noteConflicts' && state.listKind !== 'attachmentConflicts') return null;
    return state.rows.find(row => row.id === state.selectedNoteId) || null;
  }

  function setButtonShown(button, shown) {
    if (!button) return;
    button.hidden = !shown;
    button.classList.toggle('is-hidden', !shown);
  }

  function renderAttachmentHomes(matches) {
    if (!conflictOriginalLinks) return;
    while (conflictOriginalLinks.firstChild) conflictOriginalLinks.removeChild(conflictOriginalLinks.firstChild);
    const homes = Array.isArray(matches) ? matches : [];
    setButtonShown(conflictOriginalLinks, homes.length > 0);
    for (const match of homes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-quiet';
      button.dataset.noteId = match.id;
      button.dataset.noteTitle = match.title || '';
      button.textContent = `Open "${match.title}"`;
      conflictOriginalLinks.appendChild(button);
    }
  }

  function updateConflictChrome() {
    if (!conflictBanner || !newNoteBtn) return;
    const noteConflicts = state.listKind === 'noteConflicts';
    const attachmentConflicts = state.listKind === 'attachmentConflicts';
    const active = noteConflicts || attachmentConflicts;

    conflictBanner.hidden = !active;
    if (noteConflicts) {
      conflictBanner.textContent = 'Sync kept one version in its notebook and saved the other copy here. Nothing is merged. Read both, then keep the notebook note or replace it with this copy.';
    } else if (attachmentConflicts) {
      conflictBanner.textContent = 'A file was changed in two places before sync. Joplin kept one version on the original note and saved the other version here. They are not linked. Open this copy to see the spare file, open the note named below to see the version that stayed, then delete this copy if you do not need the spare.';
    }

    if (queryInput) {
      queryInput.placeholder = noteConflicts ? 'Filter conflicts...' : 'Search...';
    }
    newNoteBtn.disabled = active;
    newNoteBtn.title = active ? 'New notes are not created in Conflicts.' : '';

    const row = selectedConflictRow();
    if (!conflictActions) return;
    conflictActions.hidden = !row;
    if (!row) return;

    if (attachmentConflicts) {
      const details = row.attachmentContext;
      if (!details) {
        conflictSummary.textContent = 'Looking for the note that still has the other version of this file...';
        void loadAttachmentContext(row);
      } else if (details.status === 'loading') {
        conflictSummary.textContent = 'Looking for the note that still has the other version of this file...';
      } else if (details.message) {
        conflictSummary.textContent = details.message;
      } else {
        conflictSummary.textContent = 'Could not look up the original note.';
      }
      conflictOpenCopyBtn.disabled = false;
      conflictOpenCopyBtn.textContent = 'Open this copy';
      setButtonShown(conflictOpenCopyBtn, true);
      setButtonShown(conflictOpenOriginalBtn, false);
      setButtonShown(conflictKeepBtn, true);
      conflictKeepBtn.textContent = 'Delete this copy';
      conflictKeepBtn.disabled = false;
      setButtonShown(conflictUseCopyBtn, false);
      renderAttachmentHomes(details?.matches);
      return;
    }

    renderAttachmentHomes([]);

    const copyWhen = formatTimestamp(row.updatedTime) || 'an unknown time';
    if (row.originalMissing) {
      conflictSummary.textContent = `The note in ${row.notebookTitle} is gone. Restoring puts this copy back there. This copy was updated ${copyWhen}.`;
    } else {
      const originalWhen = formatTimestamp(row.originalUpdatedTime) || 'an unknown time';
      let which = 'Both versions show the same updated time.';
      if (row.updatedTime > row.originalUpdatedTime) which = 'This copy is newer.';
      else if (row.updatedTime < row.originalUpdatedTime) which = 'The notebook note is newer.';
      conflictSummary.textContent = `This copy was updated ${copyWhen}. The note in ${row.notebookTitle} was updated ${originalWhen}. ${which}`;
    }

    conflictOpenCopyBtn.disabled = false;
    conflictOpenCopyBtn.textContent = 'Open copy';
    setButtonShown(conflictOpenCopyBtn, true);
    setButtonShown(conflictOpenOriginalBtn, !row.originalMissing);
    conflictOpenOriginalBtn.disabled = !row.conflictOriginalId;
    setButtonShown(conflictKeepBtn, true);
    conflictKeepBtn.textContent = row.originalMissing ? 'Restore copy' : 'Keep original';
    conflictKeepBtn.disabled = !!row.encryptionApplied;
    setButtonShown(conflictUseCopyBtn, !row.originalMissing);
    conflictUseCopyBtn.disabled = !!row.encryptionApplied || !!row.originalEncrypted;
  }

  async function loadAttachmentContext(row) {
    if (!row || row.attachmentContext) return;
    const token = ++attachmentLoadToken;
    row.attachmentContext = { status: 'loading', matches: [] };
    updateConflictChrome();
    try {
      const response = await webviewApi.postMessage({
        type: 'getAttachmentConflict',
        payload: { noteId: row.id },
      });
      if (token !== attachmentLoadToken) return;
      const current = state.rows.find(item => item.id === row.id);
      if (!current) return;
      if (response?.ok === false) {
        current.attachmentContext = {
          status: 'ready',
          matches: [],
          message: response.message || 'Could not look up the original note.',
        };
      } else {
        current.attachmentContext = {
          status: 'ready',
          matches: response?.payload?.matches || [],
          message: response?.payload?.message || '',
        };
      }
    } catch (error) {
      if (token !== attachmentLoadToken) return;
      const current = state.rows.find(item => item.id === row.id);
      if (!current) return;
      current.attachmentContext = {
        status: 'ready',
        matches: [],
        message: `Could not look up the original note: ${error?.message || error}`,
      };
    }
    updateConflictChrome();
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

  function formatTruncatedSuffix(payload) {
    if (!payload?.truncated) return '';
    const limit = payload.resultLimit || 5000;
    return ` (showing first ${limit} — raise "Maximum notes to load" in plugin settings)`;
  }

  function formatResultStatus(payload) {
    const count = Array.isArray(payload.rows) ? payload.rows.length : 0;
    const truncated = formatTruncatedSuffix(payload);
    const text = state.textQuery.trim();
    if (state.listKind === 'noteConflicts') {
      const noun = count === 1 ? 'conflict' : 'conflicts';
      return text
        ? `${count} ${noun} matching "${text}"${truncated}`
        : `${count} ${noun}${truncated}`;
    }
    if (state.listKind === 'attachmentConflicts' && state.notebookScope && !state.searchAllNotebooks && !text) {
      const noun = count === 1 ? 'attachment conflict' : 'attachment conflicts';
      return `${count} ${noun}${truncated}`;
    }
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
      truncated: truncated ?? state.listTruncated,
      resultLimit: state.resultLimit,
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

  function resolveOpenedNoteFolderChange(input) {
    if (input.forceApply) {
      return { ignore: false, pending: null };
    }
    const pending = input.pending;
    if (!pending || (!input.hasTextQuery && !input.holdList)) {
      return { ignore: false, pending: null };
    }

    const reachedNotebook = !pending.notebookId || input.folderId === pending.notebookId;
    const selectionMoved = !!input.selectedNoteId && input.selectedNoteId !== pending.noteId;
    // A different note in a different notebook is a sidebar click. A different
    // note in the opened note's notebook is still Joplin following that open.
    if (selectionMoved && !reachedNotebook) {
      return { ignore: false, pending: null };
    }

    if (!reachedNotebook && input.now > pending.until) {
      return { ignore: false, pending: null };
    }

    return {
      ignore: true,
      pending: reachedNotebook ? null : pending,
    };
  }

  function markNoteOpenedFromList(noteId) {
    const holdConflictList = state.listKind === 'noteConflicts';
    if ((!(state.textQuery || '').trim() && !holdConflictList) || !noteId) return;
    const row = state.rows.find(r => r.id === noteId);
    state.pendingNoteOpen = {
      noteId,
      notebookId: row?.notebookId || null,
      until: Date.now() + NOTE_OPEN_FOLDER_SUPPRESS_MS,
    };
  }

  function decideNoteListingMembership(meta, eventType) {
    if (eventType === NOTE_EVENT_DELETE) return 'deleted';
    if (!meta) return 'inconclusive';
    // Soft-deleted notes keep parent_id; still remove them from the panel list.
    if (meta.deletedTime) return 'deleted';
    if (state.listKind === 'noteConflicts') {
      return meta.isConflict ? 'stay' : 'left_scope';
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
        state.selectedNoteIds = state.selectedNoteIds.filter(id => id !== noteId);
      }
      return false;
    }

    const shouldAdvance = !!opts.advanceSelection;
    state.rows.splice(idx, 1);
    state.selectedNoteIds = state.selectedNoteIds.filter(id => id !== noteId);

    if (shouldAdvance) {
      const nextId = state.rows.length
        ? state.rows[Math.min(idx, state.rows.length - 1)].id
        : null;
      state.selectedNoteId = nextId;
      state.selectedNoteIds = nextId ? [nextId] : [];
      state.lastOpenedNoteId = nextId;
      if (nextId) {
        markNoteOpenedFromList(nextId);
        webviewApi.postMessage({ type: 'openNote', payload: { noteId: nextId } });
      }
    } else if (state.selectedNoteId === noteId) {
      state.selectedNoteId = state.selectedNoteIds[state.selectedNoteIds.length - 1] || null;
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
      state.listKind !== 'noteConflicts'
      && state.notebookScope
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
    state.selectedNoteIds = newNoteId ? [newNoteId] : [];
    if (newNoteId) state.lastOpenedNoteId = newNoteId;
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

    // Delete: remove immediately from the panel list (hard delete or trash).
    if (eventType === NOTE_EVENT_DELETE) {
      if (noteId) {
        const bulk = isBulkListedSelection(noteId);
        const wasSelected = state.selectedNoteId === noteId;
        removeNoteFromListing(noteId, { advanceSelection: wasSelected && !bulk });
        if (bulk) scheduleListingRefresh(50);
      } else {
        scheduleListingRefresh(150);
      }
      return;
    }

    // Updates: refresh Title/Updated/Created/Notebook in place.
    // Advance selection ONLY when parent notebook left the current scope (or soft-delete).
    if (noteId) {
      const wasSelected = state.selectedNoteId === noteId;
      const inList = state.rows.some(r => r.id === noteId);

      // Selected note missing from the list (e.g. just created) — refresh so
      // renames and other edits become visible.
      if (!inList && wasSelected) {
        scheduleListingRefresh(150);
        return;
      }

      const bulk = isBulkListedSelection(noteId);
      const decision = await reconcileNotePresence(noteId, {
        wasSelected,
        advanceSelection: wasSelected && !bulk,
        eventType,
        checkEvenIfMissing: wasSelected,
      });
      if (bulk && (decision === 'deleted' || decision === 'left_scope')) {
        scheduleListingRefresh(50);
      }
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
      if (state.listKind === 'noteConflicts') {
        updateStatus(state.textQuery.trim() ? 'No matching conflicts.' : 'No conflicts.');
      } else if (state.textQuery.trim() || (state.notebookScope && !state.searchAllNotebooks)) {
        updateStatus('No results.');
      } else {
        updateStatus('Ready.');
      }
      updateConflictChrome();
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
      const isSelected = state.selectedNoteIds.includes(row.id)
        || (!state.selectedNoteIds.length && row.id === state.selectedNoteId);
      rowEl.tabIndex = row.id === state.selectedNoteId ? 0 : -1;
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

      rowEl.addEventListener('click', event => {
        onListedNoteClick(row.id, event);
      });

      rowEl.addEventListener('contextmenu', e => {
        e.preventDefault();
        void showNoteContextMenu(row.id);
      });

      wrapper.appendChild(rowEl);
      resultsBody.appendChild(wrapper);
    }
    updateConflictChrome();
  }

  // Keep in sync with noteListSelection.ts (panel.js is not bundled with that module).
  function toggleNoteSelection(selectedIds, noteId) {
    if (!noteId) return selectedIds.slice();
    if (selectedIds.includes(noteId)) {
      if (selectedIds.length <= 1) return selectedIds.slice();
      return selectedIds.filter(id => id !== noteId);
    }
    return selectedIds.concat(noteId);
  }

  function extendNoteSelection(orderedIds, selectedIds, noteId) {
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

  function selectionAfterClick(orderedIds, selectedIds, noteId, modifiers) {
    if (!noteId) return selectedIds.slice();
    if (modifiers.toggleKey) return toggleNoteSelection(selectedIds, noteId);
    if (modifiers.shiftKey) return extendNoteSelection(orderedIds, selectedIds, noteId);
    return [noteId];
  }

  function selectionAfterShiftMove(selectedIds, focusedId, nextId) {
    if (!nextId) return selectedIds.slice();
    let next = selectedIds.slice();
    if (!next.length && focusedId) next = [focusedId];
    if (next.includes(nextId) && focusedId && next.length > 1) {
      next = next.filter(id => id !== focusedId);
    }
    if (!next.includes(nextId)) next.push(nextId);
    return next;
  }

  function contextMenuTargetIds(selectedIds, clickedId) {
    if (!clickedId) return [];
    if (selectedIds.includes(clickedId)) return selectedIds.slice();
    return [clickedId];
  }

  function isToggleClick(event) {
    if (event.metaKey) return true;
    if (!event.ctrlKey) return false;
    // Ctrl+click opens the context menu on macOS; Command-click toggles.
    return !/Mac|iPhone|iPad/i.test(navigator.platform || '');
  }

  function selectionBase() {
    if (state.selectedNoteIds.length) return state.selectedNoteIds.slice();
    return state.selectedNoteId ? [state.selectedNoteId] : [];
  }

  function markLocalSelection() {
    state.localSelectionUntil = Date.now() + LOCAL_SELECTION_MS;
  }

  function applySelectionToDom() {
    const selected = new Set(state.selectedNoteIds);
    if (!selected.size && state.selectedNoteId) selected.add(state.selectedNoteId);
    for (const wrapper of resultsBody.querySelectorAll('.note-list-item-wrapper')) {
      const rowEl = wrapper.querySelector('.row');
      if (!rowEl) continue;
      const id = wrapper.dataset.id;
      const isSelected = selected.has(id);
      rowEl.classList.toggle('-selected', isSelected);
      rowEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      rowEl.tabIndex = id === state.selectedNoteId ? 0 : -1;
    }
    updateConflictChrome();
  }

  function isBulkListedSelection(noteId) {
    return state.selectedNoteIds.length > 1 && state.selectedNoteIds.includes(noteId);
  }

  function listedSelectedIds() {
    const inList = state.selectedNoteIds.filter(id => state.rows.some(r => r.id === id));
    if (inList.length) return inList;
    if (state.selectedNoteId && state.rows.some(r => r.id === state.selectedNoteId)) {
      return [state.selectedNoteId];
    }
    return [];
  }

  // Joplin is still showing the note we opened; keep a panel multi-selection.
  function shouldIgnoreExternalSelection(noteId) {
    if (!noteId || noteId !== state.lastOpenedNoteId) return false;
    return !!(state.selectedNoteId && state.selectedNoteIds.includes(state.selectedNoteId));
  }

  function syncSelectionFromExternal(noteId) {
    const visible = new Set(state.rows.map(r => r.id));
    const kept = state.selectedNoteIds.filter(id => visible.has(id));
    const unchangedJoplinNote = !noteId || noteId === state.lastOpenedNoteId;
    if (unchangedJoplinNote && kept.length && kept.includes(state.selectedNoteId)) {
      state.selectedNoteIds = kept;
      return;
    }
    state.selectedNoteId = noteId || null;
    state.selectedNoteIds = noteId ? [noteId] : [];
    if (noteId) state.lastOpenedNoteId = noteId;
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

  function onListedNoteClick(noteId, event) {
    if (!noteId || event.button !== 0) return;
    // On macOS, Ctrl+click is the context-menu gesture and must not replace the selection.
    if (event.ctrlKey && !event.metaKey && /Mac|iPhone|iPad/i.test(navigator.platform || '')) return;
    const toggleKey = isToggleClick(event);
    const shiftKey = !!event.shiftKey;
    if (toggleKey || shiftKey) {
      event.preventDefault();
      const next = selectionAfterClick(
        state.rows.map(r => r.id),
        selectionBase(),
        noteId,
        { toggleKey, shiftKey },
      );
      state.selectedNoteIds = next;
      state.selectedNoteId = next.includes(noteId) ? noteId : (next[next.length - 1] || null);
      markLocalSelection();
      applySelectionToDom();
      scrollSelectedIntoView();
      focusSelectedRow();
      return;
    }
    openListedNote(noteId, { focusRow: true });
  }

  function openListedNote(noteId, options) {
    const opts = options || {};
    if (!noteId) return;
    state.selectedNoteId = noteId;
    state.selectedNoteIds = [noteId];
    state.lastOpenedNoteId = noteId;
    markLocalSelection();
    markNoteOpenedFromList(noteId);
    renderRows();
    scrollSelectedIntoView();
    if (opts.focusRow) focusSelectedRow();
    return webviewApi.postMessage({ type: 'openNote', payload: { noteId } }).then(response => {
      if (response?.ok === false) {
        updateStatus(response.message || 'Could not open the note.');
      } else if (state.listKind === 'attachmentConflicts') {
        updateStatus('Opened the spare copy in the editor. This note only holds the extra file.');
      }
      return response;
    }).catch(error => {
      updateStatus(`Could not open the note: ${error?.message || error}`);
    });
  }

  async function showNoteContextMenu(noteId) {
    if (!noteId || typeof webviewApi.menuPopupFromTemplate !== 'function') return;

    const alreadySelected = selectionBase().includes(noteId);
    const menuIds = contextMenuTargetIds(selectionBase(), noteId);
    // Right-click outside the selection replaces it. A click inside keeps the group.
    if (!alreadySelected) {
      state.selectedNoteId = noteId;
      state.selectedNoteIds = [noteId];
      state.lastOpenedNoteId = noteId;
      markLocalSelection();
      markNoteOpenedFromList(noteId);
      applySelectionToDom();
      await webviewApi.postMessage({ type: 'openNote', payload: { noteId } });
    }

    try {
      const response = await webviewApi.postMessage({
        type: 'getNoteListContextMenu',
        payload: { noteIds: menuIds },
      });
      const items = response?.payload?.items;
      if (Array.isArray(items) && items.length) {
        webviewApi.menuPopupFromTemplate(items);
      }
    } catch (error) {
      console.error('Advanced Search Sort failed to open context menu:', error);
    }
  }

  function navigateListedNote(delta, extendSelection) {
    const nextId = noteIdAtOffset(state.rows, state.selectedNoteId, delta);
    if (!nextId || nextId === state.selectedNoteId) {
      focusSelectedRow();
      return;
    }
    if (extendSelection) {
      const next = selectionAfterShiftMove(selectionBase(), state.selectedNoteId, nextId);
      state.selectedNoteIds = next;
      state.selectedNoteId = nextId;
      markLocalSelection();
      applySelectionToDom();
      scrollSelectedIntoView();
      focusSelectedRow();
      return;
    }
    openListedNote(nextId, { focusRow: true });
  }

  function runNoteCommandForSelection(command) {
    const noteIds = listedSelectedIds();
    if (!noteIds.length) return;
    void webviewApi.postMessage({
      type: 'runNoteCommand',
      payload: { noteId: noteIds[0], noteIds, command },
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

    if ((e.key === 'a' || e.key === 'A') && mod && !e.altKey && !e.shiftKey) {
      const target = e.target;
      if (
        target === queryInput
        || (target && typeof target.closest === 'function' && target.closest('input, textarea, select'))
      ) {
        return;
      }
      if (!state.rows.length) return;
      e.preventDefault();
      state.selectedNoteIds = state.rows.map(r => r.id);
      if (!state.selectedNoteId || !state.selectedNoteIds.includes(state.selectedNoteId)) {
        state.selectedNoteId = state.selectedNoteIds[0];
      }
      markLocalSelection();
      applySelectionToDom();
      return;
    }

    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (mod || e.altKey) return;

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
    navigateListedNote(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
  }

  function applySearchResults(payload) {
    state.rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (payload.textQuery !== undefined) state.textQuery = payload.textQuery;
    if (payload.notebookScope !== undefined) state.notebookScope = payload.notebookScope;
    if (payload.searchAllNotebooks !== undefined) state.searchAllNotebooks = payload.searchAllNotebooks;
    if (payload.listKind) {
      state.listKind = payload.listKind;
    } else if (state.searchAllNotebooks) {
      state.listKind = 'notes';
    } else if (payload.notebookScope) {
      state.listKind = listKindFor(payload.notebookScope.id, payload.notebookScope.title);
    }
    if (payload.sortField) state.sortField = payload.sortField;
    if (payload.sortDirection) state.sortDirection = payload.sortDirection;
    state.resultLimit = payload.resultLimit;
    state.listTruncated = !!payload.truncated;
    if (payload.selectedNoteId !== undefined) syncSelectionFromExternal(payload.selectedNoteId);
    if (
      (state.listKind === 'noteConflicts' || state.listKind === 'attachmentConflicts')
      && state.rows.length
      && !state.rows.some(row => row.id === state.selectedNoteId)
    ) {
      state.selectedNoteId = state.rows[0].id;
      state.selectedNoteIds = [state.rows[0].id];
    }
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

  function applyFolderBrowseSort() {
    if ((state.textQuery || '').trim()) return;

    let field = state.defaultSortField;
    if (field === 'relevance') field = 'updated';
    state.sortField = field;
    state.sortDirection = state.defaultSortDirection;
    renderHeader();
  }

  function applyPayload(payload, notesColumns) {
    state.textQuery = payload.textQuery || '';
    state.sortField = payload.sortField || 'relevance';
    state.sortDirection = payload.sortDirection || 'desc';
    if (payload.defaultSortField) state.defaultSortField = payload.defaultSortField;
    if (payload.defaultSortDirection) state.defaultSortDirection = payload.defaultSortDirection;
    state.searchAllNotebooks = !!payload.searchAllNotebooks;
    state.notebookScope = payload.notebookScope || null;
    state.listKind = payload.listKind
      || (state.searchAllNotebooks
        ? 'notes'
        : listKindFor(state.notebookScope?.id, state.notebookScope?.title));
    if (payload.selectedNoteId !== undefined) {
      state.selectedNoteId = payload.selectedNoteId;
      state.selectedNoteIds = payload.selectedNoteId ? [payload.selectedNoteId] : [];
      if (payload.selectedNoteId) state.lastOpenedNoteId = payload.selectedNoteId;
    }
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

  function scopeToNotebook(folderId, folderTitle, listKind) {
    state.notebookScope = folderId ? { id: folderId, title: folderTitle } : null;
    state.searchAllNotebooks = false;
    state.listKind = listKind || listKindFor(folderId, folderTitle);
    state.lastPolledFolderId = folderId || null;
    applyFolderBrowseSort();
    updateScopeBar();
  }

  function setNotebookScope(folderId, folderTitle, listKind) {
    // Sidebar notebook click: clear any search text and show the full notebook list.
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
      state.searchTimer = null;
    }
    if (queryInput) {
      queryInput.value = '';
    }
    state.textQuery = '';
    updateSearchActionButton();
    const nextKind = listKind || listKindFor(folderId, folderTitle);
    const changed = (state.notebookScope?.id || null) !== (folderId || null)
      || state.listKind !== nextKind
      || !!state.searchAllNotebooks;
    scopeToNotebook(folderId, folderTitle, nextKind);
    if (changed) {
      state.rows = [];
      renderRows();
    }
    void persistUiState();
    refreshListing();
  }

  function clearNotebookScope() {
    state.notebookScope = null;
    state.searchAllNotebooks = true;
    state.listKind = 'notes';
    state.rows = [];
    renderRows();
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
    applyFolderBrowseSort();
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

      const now = Date.now();

      // Folder changes first. Do not run move-reconcile here — that was firing
      // getNoteMeta every poll and racing notebook switches on large folders.
      if (folder.folderId && folder.folderId !== state.lastPolledFolderId) {
        if (now < state.folderPollGraceUntil) {
          // Joplin's sidebar folder can be wrong briefly on startup; keep restored scope.
        } else if (!state.folderPollBaselineReady) {
          state.folderPollBaselineReady = true;
          // Startup may report the sidebar before it settles. Follow Conflicts
          // once that window ends; other notebooks keep the restored scope until
          // the next real click.
          if (folder.listKind === 'noteConflicts' && state.listKind !== 'noteConflicts') {
            setNotebookScope(folder.folderId, folder.folderTitle, folder.listKind);
            return;
          }
          state.lastPolledFolderId = folder.folderId;
        } else {
          const opened = resolveOpenedNoteFolderChange({
            pending: state.pendingNoteOpen,
            folderId: folder.folderId,
            selectedNoteId: folder.selectedNoteId || null,
            now,
            hasTextQuery: !!(state.textQuery || '').trim(),
            holdList: state.listKind === 'noteConflicts',
            forceApply: folder.listKind === 'noteConflicts' && state.listKind !== 'noteConflicts',
          });
          state.pendingNoteOpen = opened.pending;
          if (opened.ignore) {
            // Joplin selected this note's notebook because we opened it from
            // the result list. Keep the query so the user can move through matches.
            if (!state.pendingNoteOpen) {
              state.lastPolledFolderId = folder.folderId;
            }
            return;
          }

          state.lastPolledFolderId = folder.folderId;
          if (folder.selectedNoteId) {
            state.selectedNoteId = folder.selectedNoteId;
            state.selectedNoteIds = [folder.selectedNoteId];
            state.lastOpenedNoteId = folder.selectedNoteId;
          }
          setNotebookScope(folder.folderId, folder.folderTitle, folder.listKind);
          return;
        }
      } else if (!state.folderPollBaselineReady && now >= state.folderPollGraceUntil) {
        state.folderPollBaselineReady = true;
        state.lastPolledFolderId = folder.folderId || state.lastPolledFolderId;
      }

      const polledSelected = folder.selectedNoteId || null;
      if (polledSelected !== state.selectedNoteId) {
        const withinLocalChange = Date.now() < state.localSelectionUntil;
        if (!withinLocalChange && !shouldIgnoreExternalSelection(polledSelected)) {
          await handleSelectionChanged(polledSelected);
        }
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
      // Prefer restored panel scope over Joplin's sidebar on startup.
      state.lastPolledFolderId = state.notebookScope?.id
        || folderResponse?.payload?.folderId
        || null;
    } catch {
      state.lastPolledFolderId = state.notebookScope?.id || null;
    }

    state.folderPollGraceUntil = Date.now() + FOLDER_POLL_GRACE_MS;
    state.folderPollBaselineReady = false;
    state.startupComplete = true;
  }

  webviewApi.onMessage(message => {
    if (!message || !message.type) return;

    if (message.type === 'selectionChanged') {
      const noteId = message.payload?.noteId || null;
      if (!shouldIgnoreExternalSelection(noteId)) {
        void handleSelectionChanged(noteId);
      }
      return;
    }

    if (message.type === 'noteChanged') {
      void handleNoteChanged(message.payload || {});
      return;
    }

    if (message.type === 'notesMayHaveChanged') {
      const command = message.payload?.command;
      const noteIds = Array.isArray(message.payload?.noteIds) ? message.payload.noteIds : [];
      // Drop trashed notes immediately. A later reload confirms move, tag, and duplicate changes.
      if ((command === 'deleteNote' || command === 'permanentlyDeleteNote') && noteIds.length) {
        for (const id of noteIds) {
          removeNoteFromListing(id, { advanceSelection: false });
        }
      }
      scheduleListingRefresh(command ? 50 : 300);
    }
  });

  queryInput = document.getElementById('queryInput');
  searchActionBtn = document.getElementById('searchActionBtn');
  searchActionGlyph = searchActionBtn.querySelector('.ss-glyph');
  newNoteBtn = document.getElementById('newNoteBtn');
  statusLine = document.getElementById('statusLine');
  resultsBody = document.getElementById('resultsBody');
  resultsBody.setAttribute('role', 'listbox');
  resultsBody.setAttribute('aria-multiselectable', 'true');
  resultsBody.setAttribute('aria-label', 'Search results');
  headerRow = document.getElementById('headerRow');
  allNotebooksBtn = document.getElementById('allNotebooksBtn');
  scopeNotebookChip = document.getElementById('scopeNotebookChip');
  scopeChipLabel = scopeNotebookChip.querySelector('.scope-chip-label');
  clearScopeBtn = document.getElementById('clearScopeBtn');
  conflictBanner = document.getElementById('conflictBanner');
  conflictActions = document.getElementById('conflictActions');
  conflictSummary = document.getElementById('conflictSummary');
  conflictOpenCopyBtn = document.getElementById('conflictOpenCopyBtn');
  conflictOpenOriginalBtn = document.getElementById('conflictOpenOriginalBtn');
  conflictKeepBtn = document.getElementById('conflictKeepBtn');
  conflictUseCopyBtn = document.getElementById('conflictUseCopyBtn');

  async function openConflictCopy() {
    const row = selectedConflictRow();
    if (!row) {
      updateStatus('Select a conflict first.');
      return;
    }
    await openListedNote(row.id, { focusRow: true });
  }

  async function openAttachmentHome(noteId, title) {
    if (!noteId) return;
    const response = await webviewApi.postMessage({
      type: 'openNoteInNewWindow',
      payload: { noteId },
    });
    if (response?.ok === false) {
      updateStatus(response.message || 'Could not open that note.');
      return;
    }
    if (response?.followedInPlace) {
      updateStatus(`Opened "${title}" in the editor. Select Conflicts (attachments) in the sidebar to return to this list.`);
      return;
    }
    updateStatus(`Opened "${title}" in a new window. That note still has the other version of this file.`);
  }

  async function openConflictOriginal() {
    const row = selectedConflictRow();
    if (!row?.conflictOriginalId) return;
    const response = await webviewApi.postMessage({
      type: 'openNoteInNewWindow',
      payload: { noteId: row.conflictOriginalId },
    });
    if (response?.followedInPlace) {
      state.pendingNoteOpen = {
        noteId: row.conflictOriginalId,
        notebookId: row.notebookId || null,
        until: Date.now() + NOTE_OPEN_FOLDER_SUPPRESS_MS,
      };
    } else if (response?.ok === false) {
      updateStatus(response.message || 'Could not open the original note.');
    }
  }

  async function resolveSelectedConflict(action) {
    const row = selectedConflictRow();
    if (!row) return;

    if (state.listKind === 'attachmentConflicts') {
      const response = await webviewApi.postMessage({
        type: 'runNoteCommand',
        payload: { command: 'deleteNote', noteIds: [row.id] },
      });
      if (response?.ok === false) {
        updateStatus(response.message || 'Could not delete the copy.');
        return;
      }
      refreshListing();
      return;
    }

    let prompt;
    if (action === 'useCopy') {
      prompt = `Replace the note in ${row.notebookTitle} with this copy? This overwrites that note's title and body, then deletes the copy.`;
    } else if (row.originalMissing) {
      prompt = `The note in ${row.notebookTitle} is gone. Put this copy back there as a normal note?`;
    } else {
      prompt = `Delete this copy and keep the note in ${row.notebookTitle}?`;
    }
    if (!window.confirm(prompt)) return;

    const response = await webviewApi.postMessage({
      type: 'resolveConflict',
      payload: { noteId: row.id, action },
    });
    if (!response?.ok) {
      updateStatus(response?.message || 'Could not resolve the conflict.');
      return;
    }
    updateStatus(response.message || 'Conflict resolved.');
    refreshListing();
  }

  conflictOriginalLinks = document.getElementById('conflictOriginalLinks');
  if (conflictOriginalLinks) {
    conflictOriginalLinks.addEventListener('click', event => {
      const button = event.target.closest('button[data-note-id]');
      if (!button) return;
      void openAttachmentHome(button.dataset.noteId, button.dataset.noteTitle || 'note');
    });
  }

  conflictOpenCopyBtn.addEventListener('click', () => {
    void openConflictCopy();
  });
  conflictOpenOriginalBtn.addEventListener('click', () => {
    void openConflictOriginal();
  });
  conflictKeepBtn.addEventListener('click', () => {
    void resolveSelectedConflict('keepOriginal');
  });
  conflictUseCopyBtn.addEventListener('click', () => {
    void resolveSelectedConflict('useCopy');
  });

  async function createNewNote() {
    if (state.listKind === 'noteConflicts' || state.listKind === 'attachmentConflicts') return;
    // Clear text search so a scoped folder listing can include the new note.
    if (queryInput.value) {
      queryInput.value = '';
      state.textQuery = '';
      updateSearchActionButton();
    }

    const scopedNotebookId =
      !state.searchAllNotebooks && state.notebookScope?.id
        ? state.notebookScope.id
        : null;

    try {
      const response = await webviewApi.postMessage({
        type: 'newNote',
        payload: { notebookId: scopedNotebookId },
      });
      const noteId = response?.payload?.noteId || null;
      const createdNotebookId = response?.payload?.notebookId || null;
      const createdNotebookTitle = response?.payload?.notebookTitle || '';

      if (noteId) {
        state.selectedNoteId = noteId;
        state.selectedNoteIds = [noteId];
        state.lastOpenedNoteId = noteId;
      }

      // After creating from "All notebooks" (or after clearing a failed search),
      // scope to the notebook that received the new note so the panel can list it.
      if (createdNotebookId && createdNotebookTitle && state.searchAllNotebooks) {
        scopeToNotebook(createdNotebookId, createdNotebookTitle);
      }

      await runSearch();
      void persistUiState();

      if (noteId) {
        scrollSelectedIntoView();
        focusSelectedRow();
      }
    } catch (error) {
      console.error('Advanced Search Sort failed to create note:', error);
      updateStatus(`Failed to create note: ${error?.message || String(error)}`);
    }
  }

  newNoteBtn.addEventListener('click', () => {
    void createNewNote();
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
