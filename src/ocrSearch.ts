/**
 * Joplin searches OCR text only when the query has no filters. A `notebook:`
 * or `tag:` term skips attachment text entirely. Scoped searches in this
 * plugin always add `notebook:`, so OCR matches have to be merged back in.
 *
 * The supplement asks Joplin for the free-text terms alone (that search
 * includes OCR), then keeps notes that still satisfy the original filters.
 */

const VALID_FILTERS = new Set([
	'any',
	'title',
	'body',
	'tag',
	'notebook',
	'created',
	'updated',
	'type',
	'iscompleted',
	'due',
	'latitude',
	'longitude',
	'altitude',
	'resource',
	'sourceurl',
	'id',
]);

export interface SearchToken {
	name: string;
	raw: string;
	value: string;
	negated: boolean;
}

export interface LikeFilter {
	pattern: string;
	negated: boolean;
}

export interface TextFieldFilter {
	pattern: string;
	negated: boolean;
	wildcard: boolean;
}

export interface DateFilter {
	field: 'created' | 'updated' | 'due';
	thresholdMs: number;
	negated: boolean;
}

export interface LocationFilter {
	field: 'latitude' | 'longitude' | 'altitude';
	value: number;
	negated: boolean;
}

export interface OcrSupplementPlan {
	textQuery: string;
	orMode: boolean;
	orTextQueries: string[];
	notebooks: LikeFilter[];
	tags: LikeFilter[];
	titles: TextFieldFilter[];
	types: Array<'note' | 'todo'>;
	completed: Array<'0' | '1'>;
	dates: DateFilter[];
	locations: LocationFilter[];
	sourceUrls: LikeFilter[];
	ids: LikeFilter[];
	verifyFilters: string[];
}

export interface FolderRecord {
	id: string;
	title: string;
	parentId: string;
}

export interface OcrNoteFields {
	id: string;
	title?: string;
	is_todo?: number | string | null;
	todo_completed?: number | string | null;
	todo_due?: number | string | null;
	user_created_time?: number | string | null;
	user_updated_time?: number | string | null;
	latitude?: number | string | null;
	longitude?: number | string | null;
	altitude?: number | string | null;
	source_url?: string | null;
}

export function tokenizeSearchQuery(query: string): SearchToken[] {
	const tokens: SearchToken[] = [];
	let inQuote = false;
	let inFilterValue = false;
	let currentCol = '_';
	let currentTerm = '';
	let tokenStart = 0;

	const pushToken = (end: number) => {
		if (!currentTerm) return;
		const filterName = currentCol === '_' ? '' : currentCol;
		const negatedFilter = filterName.startsWith('-');
		const name = filterName
			? (negatedFilter ? filterName.slice(1) : filterName).toLowerCase()
			: 'text';
		let raw = query.slice(tokenStart, end);
		if (inQuote && !raw.endsWith('"')) raw += '"';
		tokens.push({
			name,
			raw: raw.trim(),
			value: currentTerm,
			negated: name === 'text' ? currentTerm.startsWith('-') : negatedFilter,
		});
	};

	for (let i = 0; i < query.length; i++) {
		const c = query[i];

		if (c === '"') {
			if (!currentTerm && !inQuote && currentCol === '_') tokenStart = i;
			currentTerm += c;
			if (inQuote) {
				pushToken(i + 1);
				currentTerm = '';
				currentCol = '_';
				inQuote = false;
				inFilterValue = false;
			} else {
				inQuote = true;
			}
			continue;
		}

		if (c === ' ' && !inQuote) {
			inFilterValue = false;
			if (currentTerm) {
				pushToken(i);
				currentTerm = '';
				currentCol = '_';
			}
			continue;
		}

		if (!currentTerm && currentCol === '_') tokenStart = i;

		const filterKey = currentTerm.toLowerCase();
		const negatedKey = filterKey.startsWith('-') ? filterKey.slice(1) : '';
		if (
			c === ':'
			&& !inQuote
			&& !inFilterValue
			&& (VALID_FILTERS.has(filterKey) || VALID_FILTERS.has(negatedKey))
		) {
			currentCol = filterKey;
			currentTerm = '';
			inFilterValue = true;
			continue;
		}

		currentTerm += c;
	}

	if (inQuote) currentTerm += '"';
	if (currentTerm) pushToken(query.length);
	return tokens;
}

function unwrapQuotes(value: string): string {
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1);
	}
	return value;
}

function likePattern(value: string): string {
	return unwrapQuotes(value).replace(/\*/g, '%');
}

export function sqlLikeMatch(pattern: string, value: string): boolean {
	let expression = '^';
	for (const ch of pattern) {
		if (ch === '%') expression += '[\\s\\S]*';
		else if (ch === '_') expression += '[\\s\\S]';
		else expression += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	expression += '$';
	return new RegExp(expression, 'i').test(value ?? '');
}

export function dateFilterThresholdMs(value: string, now = Date.now()): number | null {
	const trimmed = unwrapQuotes(value).trim();
	if (/^\d{8}$/.test(trimmed)) {
		const year = Number(trimmed.slice(0, 4));
		const month = Number(trimmed.slice(4, 6)) - 1;
		const day = Number(trimmed.slice(6, 8));
		return new Date(year, month, day).getTime();
	}
	if (/^\d{6}$/.test(trimmed)) {
		const year = Number(trimmed.slice(0, 4));
		const month = Number(trimmed.slice(4, 6)) - 1;
		return new Date(year, month, 1).getTime();
	}
	if (/^\d{4}$/.test(trimmed)) {
		return new Date(Number(trimmed), 0, 1).getTime();
	}

	const smart = /^(day|week|month|year)([+-])(\d+)$/i.exec(trimmed);
	if (!smart) return null;
	const unit = smart[1].toLowerCase();
	const amount = Number(smart[3]) * (smart[2] === '+' ? 1 : -1);
	const date = new Date(now);
	if (unit === 'day') date.setDate(date.getDate() + amount);
	else if (unit === 'week') date.setDate(date.getDate() + amount * 7);
	else if (unit === 'month') date.setMonth(date.getMonth() + amount);
	else date.setFullYear(date.getFullYear() + amount);
	return date.getTime();
}

function expandTextField(token: SearchToken): TextFieldFilter[] {
	const parts = unwrapQuotes(token.value).split(/[\s\-_]+/).filter(Boolean);
	return parts.map(part => ({
		pattern: part,
		negated: token.negated,
		wildcard: part.includes('*'),
	}));
}

/**
 * Returns a plan when Joplin would skip OCR for this query and there is
 * free text that should still match attachment text. Returns null when the
 * built-in search already includes OCR, or when there is nothing to add.
 */
export function ocrSupplementPlan(query: string, now = Date.now()): OcrSupplementPlan | null {
	const trimmed = query.trim();
	if (!trimmed || trimmed.startsWith('/')) return null;

	const tokens = tokenizeSearchQuery(trimmed);
	const textTokens = tokens.filter(token => token.name === 'text');
	const positiveText = textTokens.filter(token => !token.negated);
	const filters = tokens.filter(token => token.name !== 'text');
	if (!positiveText.length || !filters.length) return null;

	const plan: OcrSupplementPlan = {
		textQuery: textTokens.map(token => token.raw).join(' '),
		orMode: tokens.some(token => token.name === 'any' && !token.negated && unwrapQuotes(token.value) === '1'),
		orTextQueries: positiveText.map(token => token.raw),
		notebooks: [],
		tags: [],
		titles: [],
		types: [],
		completed: [],
		dates: [],
		locations: [],
		sourceUrls: [],
		ids: [],
		verifyFilters: [],
	};

	for (const token of filters) {
		if (token.name === 'any') continue;

		if (token.name === 'notebook') {
			plan.notebooks.push({ pattern: likePattern(token.value), negated: token.negated });
			continue;
		}
		if (token.name === 'tag') {
			plan.tags.push({ pattern: likePattern(token.value), negated: token.negated });
			continue;
		}
		if (token.name === 'title') {
			plan.titles.push(...expandTextField(token));
			continue;
		}
		if (token.name === 'body' || token.name === 'resource') {
			plan.verifyFilters.push(token.raw);
			continue;
		}
		if (token.name === 'type') {
			const value = unwrapQuotes(token.value);
			if (value !== 'note' && value !== 'todo') return null;
			plan.types.push(value);
			continue;
		}
		if (token.name === 'iscompleted') {
			const value = unwrapQuotes(token.value);
			if (value !== '0' && value !== '1') return null;
			plan.completed.push(value);
			continue;
		}
		if (token.name === 'created' || token.name === 'updated' || token.name === 'due') {
			const thresholdMs = dateFilterThresholdMs(token.value, now);
			if (thresholdMs === null) return null;
			plan.dates.push({ field: token.name, thresholdMs, negated: token.negated });
			continue;
		}
		if (token.name === 'latitude' || token.name === 'longitude' || token.name === 'altitude') {
			const value = Number(unwrapQuotes(token.value));
			if (!Number.isFinite(value)) return null;
			plan.locations.push({ field: token.name, value, negated: token.negated });
			continue;
		}
		if (token.name === 'sourceurl') {
			plan.sourceUrls.push({ pattern: likePattern(token.value), negated: token.negated });
			continue;
		}
		if (token.name === 'id') {
			plan.ids.push({ pattern: unwrapQuotes(token.value), negated: token.negated });
			continue;
		}
		return null;
	}

	return plan;
}

function foldersMatching(folders: FolderRecord[], pattern: string): string[] {
	return folders.filter(folder => sqlLikeMatch(pattern, folder.title)).map(folder => folder.id);
}

function collectTree(folders: FolderRecord[], rootIds: Iterable<string>): Set<string> {
	const children = new Map<string, string[]>();
	for (const folder of folders) {
		const parentId = folder.parentId || '';
		const list = children.get(parentId) || [];
		list.push(folder.id);
		children.set(parentId, list);
	}

	const allowed = new Set<string>();
	const stack = [...rootIds];
	while (stack.length) {
		const id = stack.pop();
		if (!id || allowed.has(id)) continue;
		allowed.add(id);
		for (const childId of children.get(id) || []) stack.push(childId);
	}
	return allowed;
}

/** Notebook ids a note may live in. Null means the query does not limit notebooks. */
export function allowedFolderIds(folders: FolderRecord[], notebooks: LikeFilter[]): Set<string> | null {
	if (!notebooks.length) return null;

	const include = notebooks.filter(filter => !filter.negated);
	const exclude = notebooks.filter(filter => filter.negated);
	let allowed: Set<string>;

	if (include.length) {
		const roots = new Set<string>();
		for (const filter of include) {
			for (const id of foldersMatching(folders, filter.pattern)) roots.add(id);
		}
		allowed = collectTree(folders, roots);
	} else {
		allowed = new Set(folders.map(folder => folder.id));
	}

	if (exclude.length) {
		const roots = new Set<string>();
		for (const filter of exclude) {
			for (const id of foldersMatching(folders, filter.pattern)) roots.add(id);
		}
		for (const id of collectTree(folders, roots)) allowed.delete(id);
	}

	return allowed;
}

function asNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function fold(value: string): string {
	return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function titleTokens(title: string): string[] {
	return fold(title).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function textFieldMatches(haystack: string, filter: TextFieldFilter): boolean {
	const tokens = titleTokens(haystack);
	const matched = filter.wildcard
		? tokens.some(token => sqlLikeMatch(fold(filter.pattern).replace(/\*/g, '%'), token))
		: tokens.includes(fold(filter.pattern));
	return filter.negated ? !matched : matched;
}

function noteTime(note: OcrNoteFields, field: DateFilter['field']): number | null {
	if (field === 'created') return asNumber(note.user_created_time);
	if (field === 'updated') return asNumber(note.user_updated_time);
	return asNumber(note.todo_due);
}

/** AND filters other than notebook, tag, body, and resource. */
export function noteMatchesAndFilters(note: OcrNoteFields, plan: OcrSupplementPlan): boolean {
	for (const filter of plan.titles) {
		if (!textFieldMatches(note.title || '', filter)) return false;
	}

	const todo = asNumber(note.is_todo);
	for (const value of plan.types) {
		if (todo === null) return false;
		if (value === 'todo' && todo !== 1) return false;
		if (value === 'note' && todo !== 0) return false;
	}

	for (const value of plan.completed) {
		if (todo !== 1) return false;
		const completed = asNumber(note.todo_completed);
		if (completed === null) return false;
		const isDone = completed !== 0;
		if (value === '1' && !isDone) return false;
		if (value === '0' && isDone) return false;
	}

	for (const filter of plan.dates) {
		if (filter.field === 'due' && todo !== 1) return false;
		const time = noteTime(note, filter.field);
		if (time === null) return false;
		if (filter.negated ? !(time < filter.thresholdMs) : !(time >= filter.thresholdMs)) return false;
	}

	for (const filter of plan.locations) {
		const actual = asNumber(note[filter.field]);
		if (actual === null) return false;
		if (filter.negated ? !(actual < filter.value) : !(actual >= filter.value)) return false;
	}

	for (const filter of plan.sourceUrls) {
		if (note.source_url == null) return false;
		const matched = sqlLikeMatch(filter.pattern, note.source_url);
		if (filter.negated ? matched : !matched) return false;
	}

	for (const filter of plan.ids) {
		const matched = sqlLikeMatch(filter.pattern, note.id);
		if (filter.negated ? matched : !matched) return false;
	}

	return true;
}
