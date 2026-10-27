import { effectiveResultLimit } from './folderBrowseSort';
import {
	MAX_SEARCH_LIMIT,
	normalizeMaxResults,
	SAFETY_MAX_RESULTS,
	sortRows,
	type SearchResponse,
	type SearchRow,
	type SortDirection,
	type SortField,
} from './searchSortService';

/**
 * Joplin's virtual Conflicts notebook. Notes are not stored under this id;
 * `is_conflict = 1` marks the copy, and `conflict_original_id` points at the
 * note that stayed in its real notebook.
 * https://github.com/laurent22/joplin/blob/dev/packages/lib/models/utils/getConflictFolderId.ts
 */
export const CONFLICT_FOLDER_ID = 'c04f1c7c04f1c7c04f1c7c04f1c7c04f';

/** Real notebook Joplin creates for resource conflicts. English UI title. */
export const ATTACHMENT_CONFLICT_TITLE = 'Conflicts (attachments)';

export type ListKind = 'notes' | 'noteConflicts' | 'attachmentConflicts';

export type ConflictResolveAction = 'keepOriginal' | 'useCopy';

export interface SidebarSignals {
	notesParentId: string | null;
	activeFolderId: string | null;
	selectedFolderId: string | null;
	selectedFolderTitle: string | null;
}

export interface ConflictListRow extends SearchRow {
	conflictOriginalId: string;
	originalUpdatedTime: number;
	originalMissing: boolean;
	encryptionApplied: boolean;
	originalEncrypted: boolean;
}

interface ConflictNoteRecord {
	id: string;
	title?: string;
	created_time?: number;
	updated_time?: number;
	parent_id?: string;
	is_conflict?: number;
	conflict_original_id?: string;
	body?: string;
	encryption_applied?: number;
	deleted_time?: number;
}

const CONFLICT_NOTE_FIELDS = [
	'id',
	'title',
	'created_time',
	'updated_time',
	'parent_id',
	'is_conflict',
	'conflict_original_id',
	'encryption_applied',
];

export function isConflictFolderId(folderId: string | null | undefined): boolean {
	return folderId === CONFLICT_FOLDER_ID;
}

export function listKindForFolder(folderId: string | null, folderTitle: string | null): ListKind {
	if (isConflictFolderId(folderId)) return 'noteConflicts';
	if ((folderTitle || '').trim() === ATTACHMENT_CONFLICT_TITLE) return 'attachmentConflicts';
	return 'notes';
}

/**
 * The virtual Conflicts folder is easy to miss: `notesParent` can point at it
 * while `selectedFolder()` still returns the last real notebook, and the data
 * API's folder-notes route does not list `is_conflict` notes.
 */
export function resolveSidebarSelection(signals: SidebarSignals): {
	folderId: string | null;
	folderTitle: string;
	listKind: ListKind;
} {
	const notesParentId = signals.notesParentId || null;
	const activeFolderId = signals.activeFolderId || null;
	const selectedFolderId = signals.selectedFolderId || null;
	const selectedTitle = (signals.selectedFolderTitle || '').trim();

	const agreedRealFolder = !!(
		notesParentId
		&& notesParentId !== CONFLICT_FOLDER_ID
		&& notesParentId === selectedFolderId
	);
	if (agreedRealFolder) {
		return {
			folderId: notesParentId,
			folderTitle: selectedTitle || '(Untitled notebook)',
			listKind: listKindForFolder(notesParentId, selectedTitle),
		};
	}

	const conflictSignaled = isConflictFolderId(notesParentId)
		|| isConflictFolderId(activeFolderId)
		|| isConflictFolderId(selectedFolderId);
	if (conflictSignaled) {
		const title = isConflictFolderId(selectedFolderId) && selectedTitle
			? selectedTitle
			: 'Conflicts';
		return {
			folderId: CONFLICT_FOLDER_ID,
			folderTitle: title,
			listKind: 'noteConflicts',
		};
	}

	const folderId = notesParentId || activeFolderId || selectedFolderId;
	const folderTitle = selectedTitle || (folderId ? '(Untitled notebook)' : '');
	return {
		folderId,
		folderTitle,
		listKind: listKindForFolder(folderId, folderTitle),
	};
}

export function consumeConflictPage<T extends { is_conflict?: number }>(
	items: T[],
	hasMore: boolean,
	seenConflict: boolean,
): { conflicts: T[]; done: boolean; orderIgnored: boolean; seenConflict: boolean } {
	const conflicts: T[] = [];
	let nonConflict = false;
	for (const item of items) {
		if (item.is_conflict) conflicts.push(item);
		else nonConflict = true;
	}

	const nowSeen = seenConflict || conflicts.length > 0;
	// `order_by=is_conflict DESC` puts copies first. A page of ordinary notes
	// before any copy means the server did not honor that order.
	if (!nowSeen && nonConflict && hasMore) {
		return { conflicts: [], done: false, orderIgnored: true, seenConflict: false };
	}

	return {
		conflicts,
		done: !hasMore || (nowSeen && nonConflict),
		orderIgnored: false,
		seenConflict: nowSeen,
	};
}

function matchesConflictFilter(row: ConflictListRow, textQuery: string): boolean {
	const needle = textQuery.trim().toLowerCase();
	if (!needle) return true;
	return row.title.toLowerCase().includes(needle)
		|| row.notebookTitle.toLowerCase().includes(needle);
}

async function folderTitle(joplin: any, folderId: string, cache: Map<string, string>): Promise<string> {
	if (!folderId || isConflictFolderId(folderId)) return '(Unknown notebook)';
	const cached = cache.get(folderId);
	if (cached) return cached;
	try {
		const folder = await joplin.data.get(['folders', folderId], { fields: ['id', 'title'] });
		const title = folder?.title || '(Untitled notebook)';
		cache.set(folderId, title);
		return title;
	} catch {
		cache.set(folderId, '(Unknown notebook)');
		return '(Unknown notebook)';
	}
}

async function readConflictPage(
	joplin: any,
	page: number,
	ordered: boolean,
): Promise<{ items: ConflictNoteRecord[]; hasMore: boolean }> {
	const query: Record<string, unknown> = {
		fields: CONFLICT_NOTE_FIELDS,
		include_conflicts: '1',
		limit: MAX_SEARCH_LIMIT,
		page,
	};
	if (ordered) {
		query.order_by = 'is_conflict';
		query.order_dir = 'DESC';
	}
	const result = await joplin.data.get(['notes'], query);
	return {
		items: Array.isArray(result?.items) ? result.items : [],
		hasMore: !!result?.has_more,
	};
}

async function fetchConflictRecords(
	joplin: any,
	targetMax: number,
): Promise<{ records: ConflictNoteRecord[]; truncated: boolean }> {
	const ordered: ConflictNoteRecord[] = [];
	let page = 1;
	let seenConflict = false;

	while (ordered.length < targetMax) {
		const { items, hasMore } = await readConflictPage(joplin, page, true);
		if (!items.length) {
			return { records: ordered.slice(0, targetMax), truncated: false };
		}
		const decision: ReturnType<typeof consumeConflictPage<ConflictNoteRecord>> = consumeConflictPage(
			items,
			hasMore,
			seenConflict,
		);
		if (decision.orderIgnored) break;
		ordered.push(...decision.conflicts);
		seenConflict = decision.seenConflict;
		if (decision.done) {
			return {
				records: ordered.slice(0, targetMax),
				truncated: ordered.length > targetMax,
			};
		}
		page += 1;
	}

	if (seenConflict) {
		return {
			records: ordered.slice(0, targetMax),
			truncated: ordered.length >= targetMax,
		};
	}

	const scanned: ConflictNoteRecord[] = [];
	page = 1;
	let truncated = false;
	while (scanned.length < targetMax) {
		const { items, hasMore } = await readConflictPage(joplin, page, false);
		if (!items.length) break;
		for (const item of items) {
			if (item.is_conflict) scanned.push(item);
		}
		if (scanned.length >= targetMax) {
			truncated = true;
			break;
		}
		if (!hasMore) break;
		page += 1;
	}

	return { records: scanned.slice(0, targetMax), truncated };
}

export async function listConflictNotes(
	joplin: any,
	request: {
		sortField: SortField;
		sortDirection: SortDirection;
		maxResults: number;
		textQuery?: string;
	},
): Promise<SearchResponse & { folderTitle: string; listKind: 'noteConflicts' }> {
	const targetMax = effectiveResultLimit(normalizeMaxResults(request.maxResults), SAFETY_MAX_RESULTS);
	const { records, truncated } = await fetchConflictRecords(joplin, targetMax);
	const titles = new Map<string, string>();
	const rows: ConflictListRow[] = [];

	for (const [index, record] of records.entries()) {
		const originalId = record.conflict_original_id || '';
		let original: ConflictNoteRecord | null = null;
		if (originalId) {
			try {
				original = await joplin.data.get(['notes', originalId], {
					fields: ['id', 'title', 'updated_time', 'deleted_time', 'encryption_applied'],
				});
			} catch {
				original = null;
			}
		}
		const originalMissing = !original?.id || !!original.deleted_time;
		const notebookId = record.parent_id || '';
		rows.push({
			id: record.id,
			title: record.title || '(Untitled)',
			createdTime: record.created_time || 0,
			updatedTime: record.updated_time || 0,
			notebookId,
			notebookTitle: await folderTitle(joplin, notebookId, titles),
			relevanceRank: index,
			conflictOriginalId: originalMissing ? '' : originalId,
			originalUpdatedTime: originalMissing ? 0 : (original?.updated_time || 0),
			originalMissing,
			encryptionApplied: !!record.encryption_applied,
			originalEncrypted: !!original?.encryption_applied,
		});
	}

	const textQuery = request.textQuery?.trim() || '';
	const filtered = textQuery ? rows.filter(row => matchesConflictFilter(row, textQuery)) : rows;

	return {
		rows: sortRows(filtered, request.sortField, request.sortDirection),
		query: textQuery,
		sortField: request.sortField,
		sortDirection: request.sortDirection,
		hasMore: truncated,
		truncated,
		resultLimit: truncated ? targetMax : undefined,
		folderTitle: 'Conflicts',
		listKind: 'noteConflicts',
	};
}

export interface ConflictResolutionPlan {
	steps: Array<{ method: 'put' | 'delete'; id: string; body?: Record<string, unknown> }>;
	message: string;
}

export function planConflictResolution(input: {
	action: ConflictResolveAction;
	conflict: ConflictNoteRecord;
	original: ConflictNoteRecord | null;
	notebookTitle: string;
}): ConflictResolutionPlan {
	const conflict = input.conflict;
	if (!conflict?.id || !conflict.is_conflict) {
		throw new Error('That note is not a conflict copy.');
	}
	if (conflict.encryption_applied) {
		throw new Error('Decrypt this copy before resolving the conflict.');
	}

	const original = input.original?.id && !input.original.deleted_time ? input.original : null;
	const where = input.notebookTitle || 'its notebook';

	if (!original) {
		return {
			steps: [{
				method: 'put',
				id: conflict.id,
				body: { is_conflict: 0, conflict_original_id: '' },
			}],
			message: `Restored this copy into ${where}. The notebook note was already gone.`,
		};
	}

	if (input.action === 'keepOriginal') {
		return {
			steps: [{ method: 'delete', id: conflict.id }],
			message: `Kept the note in ${where} and deleted this copy.`,
		};
	}

	if (original.encryption_applied) {
		throw new Error('Decrypt the notebook note before replacing it with this copy.');
	}

	return {
		steps: [
			{
				method: 'put',
				id: original.id,
				body: { title: conflict.title || '', body: conflict.body || '' },
			},
			{ method: 'delete', id: conflict.id },
		],
		message: `Replaced the note in ${where} with this copy, then deleted the copy.`,
	};
}

export async function resolveConflictNote(
	joplin: any,
	noteId: string,
	action: ConflictResolveAction,
): Promise<{ message: string }> {
	const conflict = await joplin.data.get(['notes', noteId], {
		fields: [...CONFLICT_NOTE_FIELDS, 'body'],
	});
	if (!conflict?.id) throw new Error('Conflict copy not found.');

	let original: ConflictNoteRecord | null = null;
	if (conflict.conflict_original_id) {
		try {
			original = await joplin.data.get(['notes', conflict.conflict_original_id], {
				fields: ['id', 'title', 'deleted_time', 'encryption_applied', 'parent_id'],
			});
		} catch {
			original = null;
		}
	}

	let notebookTitle = 'its notebook';
	const parentId = original?.parent_id || conflict.parent_id;
	if (parentId && !isConflictFolderId(parentId)) {
		try {
			const folder = await joplin.data.get(['folders', parentId], { fields: ['id', 'title'] });
			notebookTitle = folder?.title || notebookTitle;
		} catch {
			notebookTitle = 'its notebook';
		}
	}

	const plan = planConflictResolution({ action, conflict, original, notebookTitle });
	for (const step of plan.steps) {
		if (step.method === 'delete') {
			await joplin.data.delete(['notes', step.id], null);
		} else {
			await joplin.data.put(['notes', step.id], null, step.body || {});
		}
	}
	return { message: plan.message };
}

export interface AttachmentNoteHit {
	id: string;
	title?: string;
	parent_id?: string;
}

export interface AttachmentHomeNote {
	id: string;
	title: string;
	notebookId: string;
	notebookTitle: string;
}

export interface AttachmentConflictDetails {
	fileName: string;
	matches: AttachmentHomeNote[];
	truncated: boolean;
	message: string;
}

const MAX_ATTACHMENT_HOMES = 5;

/** Joplin's title for a spare file saved during a resource sync conflict. */
export function attachmentFileNameFromTitle(title: string): string {
	const text = (title || '').trim();
	const quoted = text.match(/^Attachment conflict:\s*"([\s\S]+)"\s*$/i);
	if (quoted) return quoted[1].trim();
	const loose = text.match(/^Attachment conflict:\s*(.+)\s*$/i);
	if (!loose) return '';
	return loose[1].replace(/^"|"$/g, '').trim();
}

/** Resource ids embedded as `:/<id>` in the conflict note body. */
export function resourceIdsFromNoteBody(body: string): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	const re = /:\/([0-9a-f]{32})/gi;
	let match: RegExpExecArray | null;
	while ((match = re.exec(body || ''))) {
		const id = match[1].toLowerCase();
		if (seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

export function phraseQuery(text: string): string {
	return `"${text.replace(/"/g, '').trim()}"`;
}

/**
 * Drop the spare-copy note and any other notes that live in the attachment
 * conflict notebook. What remains are notes that still mention the file.
 */
export function pickAttachmentHomeNotes(
	hits: AttachmentNoteHit[],
	conflictNoteId: string,
	conflictFolderId: string,
): AttachmentNoteHit[] {
	const seen = new Set<string>();
	const kept: AttachmentNoteHit[] = [];
	for (const hit of hits) {
		if (!hit?.id || hit.id === conflictNoteId) continue;
		if (conflictFolderId && hit.parent_id === conflictFolderId) continue;
		if (seen.has(hit.id)) continue;
		seen.add(hit.id);
		kept.push(hit);
	}
	return kept;
}

export function attachmentConflictMessage(
	fileName: string,
	matches: Array<{ title: string; notebookTitle: string }>,
	truncated: boolean,
): string {
	if (!fileName) {
		return 'Joplin saved a spare copy of a file here and left the other version on the original note. The file name could not be read, so that note could not be found. Open this copy to view the spare file, then delete it if you do not need it.';
	}
	if (!matches.length) {
		return `Spare copy of "${fileName}". No other note mentions this file name, so the original note could not be found. Open this copy to view the spare file. Delete it if you do not need it.`;
	}
	if (matches.length === 1) {
		return `Spare copy of "${fileName}". The other version is still on "${matches[0].title}" in ${matches[0].notebookTitle}. Open that note to check the file, then delete this copy if you do not need the spare.`;
	}
	const more = truncated ? ' More notes may also use this file.' : '';
	return `Spare copy of "${fileName}". The other version may be on ${matches.length} notes.${more} Open one to check, then delete this copy if you do not need the spare.`;
}

async function searchNotes(joplin: any, query: string): Promise<AttachmentNoteHit[]> {
	const result = await joplin.data.get(['search'], {
		query,
		fields: ['id', 'title', 'parent_id'],
		limit: 20,
	});
	const items = Array.isArray(result?.items) ? result.items : [];
	return items.filter((item: AttachmentNoteHit) => !!item?.id);
}

export async function describeAttachmentConflict(
	joplin: any,
	noteId: string,
): Promise<AttachmentConflictDetails> {
	const note = await joplin.data.get(['notes', noteId], {
		fields: ['id', 'title', 'body', 'parent_id'],
	});
	if (!note?.id) throw new Error('Could not read this conflict note.');

	const fileName = attachmentFileNameFromTitle(note.title || '');
	const folderId = note.parent_id || '';
	const spareIds = new Set(resourceIdsFromNoteBody(note.body || ''));
	const hits: AttachmentNoteHit[] = [];

	if (fileName) {
		hits.push(...await searchNotes(joplin, phraseQuery(fileName)));
		try {
			const resources = await joplin.data.get(['search'], {
				query: fileName.replace(/"/g, ''),
				type: 'resource',
				fields: ['id', 'title'],
				limit: 20,
			});
			const items = Array.isArray(resources?.items) ? resources.items : [];
			const wanted = fileName.toLowerCase();
			let checked = 0;
			for (const resource of items) {
				const resourceId = String(resource?.id || '').toLowerCase();
				if (!resourceId || spareIds.has(resourceId)) continue;
				const title = String(resource?.title || '').toLowerCase();
				if (title && title !== wanted && !title.includes(wanted)) continue;
				if (checked >= 6) break;
				checked += 1;
				hits.push(...await searchNotes(joplin, resource.id));
			}
		} catch {
			// Filename search still stands if resource search is unavailable.
		}
	}

	const picked = pickAttachmentHomeNotes(hits, note.id, folderId);
	const limited = picked.slice(0, MAX_ATTACHMENT_HOMES);
	const notebookTitles = new Map<string, string>();
	const matches: AttachmentHomeNote[] = [];
	for (const hit of limited) {
		const notebookId = hit.parent_id || '';
		let notebookTitle = 'its notebook';
		if (notebookId) {
			const cached = notebookTitles.get(notebookId);
			if (cached) {
				notebookTitle = cached;
			} else {
				try {
					const folder = await joplin.data.get(['folders', notebookId], { fields: ['id', 'title'] });
					notebookTitle = folder?.title || notebookTitle;
				} catch {
					notebookTitle = 'its notebook';
				}
				notebookTitles.set(notebookId, notebookTitle);
			}
		}
		matches.push({
			id: hit.id,
			title: hit.title || '(Untitled)',
			notebookId,
			notebookTitle,
		});
	}

	return {
		fileName,
		matches,
		truncated: picked.length > MAX_ATTACHMENT_HOMES,
		message: attachmentConflictMessage(fileName, matches, picked.length > MAX_ATTACHMENT_HOMES),
	};
}
