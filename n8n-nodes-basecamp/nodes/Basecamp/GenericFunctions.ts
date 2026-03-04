import {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IDataObject,
	IHttpRequestMethods,
	IHttpRequestOptions,
	INodePropertyOptions,
	NodeApiError,
} from 'n8n-workflow';

type BcgptContext = IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions;

const DEFAULT_COLLECTION_KEYS = [
	'projects',
	'todolists',
	'todos',
	'message_boards',
	'messages',
	'card_tables',
	'columns',
	'cards',
	'vaults',
	'documents',
	'uploads',
	'people',
	'comments',
	'results',
];

const CHUNK_VALUE_KEYS = ['items', 'chunk', 'data', 'results', 'records'];

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseErrorMessage(response: Record<string, any>, tool: string): string {
	const details =
		typeof response.details === 'string'
			? response.details
			: response.details
			? JSON.stringify(response.details)
			: '';
	const code = response.code ? ` (${response.code})` : '';
	const base = response.error || response.message || `BCGPT tool "${tool}" failed`;
	return details ? `${base}${code}: ${details}` : `${base}${code}`;
}

function extractCollectionFromResponse(
	response: unknown,
	preferredKeys: string[] = [],
): any[] {
	if (Array.isArray(response)) {
		return response;
	}
	if (!isRecord(response)) {
		return [];
	}

	const keys = [...preferredKeys, ...DEFAULT_COLLECTION_KEYS];
	for (const key of keys) {
		const value = response[key];
		if (Array.isArray(value)) {
			return value;
		}
	}

	for (const key of keys) {
		const previewValue = response[`${key}_preview`];
		if (Array.isArray(previewValue)) {
			return previewValue;
		}
	}

	return [];
}

function extractChunkItems(response: unknown): any[] {
	if (Array.isArray(response)) {
		return response;
	}
	if (!isRecord(response)) {
		return [];
	}

	for (const key of CHUNK_VALUE_KEYS) {
		const value = response[key];
		if (Array.isArray(value)) {
			return value;
		}
	}

	return [];
}

function getPayloadChunkMeta(
	response: Record<string, any>,
	preferredKey?: string,
): Array<{ payloadKey: string; chunkCount?: number }> {
	const metas: Array<{ payloadKey: string; chunkCount?: number }> = [];
	const seen = new Set<string>();

	const add = (payloadKey: unknown, chunkCount: unknown) => {
		if (typeof payloadKey !== 'string' || payloadKey.trim().length === 0 || seen.has(payloadKey)) {
			return;
		}
		seen.add(payloadKey);
		metas.push({
			payloadKey,
			chunkCount: typeof chunkCount === 'number' && chunkCount > 0 ? chunkCount : undefined,
		});
	};

	if (preferredKey) {
		add(response[`${preferredKey}_payload_key`], response[`${preferredKey}_chunk_count`]);
	}

	add(response.payload_key, response.chunk_count);

	for (const key of Object.keys(response)) {
		if (!key.endsWith('_payload_key')) {
			continue;
		}
		const prefix = key.slice(0, -'_payload_key'.length);
		add(response[key], response[`${prefix}_chunk_count`]);
	}

	return metas;
}

async function fetchChunkedItems(
	this: BcgptContext,
	payloadKey: string,
	chunkCount?: number,
): Promise<any[]> {
	const items: any[] = [];
	const maxIterations = chunkCount && chunkCount > 0 ? Math.min(chunkCount + 2, 200) : 200;
	let index = 0;

	for (let iteration = 0; iteration < maxIterations; iteration++) {
		const chunk = await bcgptApiRequest.call(
			this,
			'POST',
			'/action/get_cached_payload_chunk',
			{ payload_key: payloadKey, index },
		);

		if (isRecord(chunk) && chunk.ok === false) {
			throw new Error(parseErrorMessage(chunk, 'get_cached_payload_chunk'));
		}

		const chunkItems = extractChunkItems(chunk);
		if (chunkItems.length > 0) {
			items.push(...chunkItems);
		}

		if (isRecord(chunk) && chunk.done === true) {
			break;
		}

		if (chunkCount && index >= chunkCount - 1) {
			break;
		}

		if (isRecord(chunk) && typeof chunk.next_index === 'number') {
			index = chunk.next_index;
			continue;
		}

		index += 1;
	}

	return items;
}

async function resolveCollection(
	this: BcgptContext,
	response: unknown,
	preferredKeys: string[] = [],
): Promise<any[]> {
	const directItems = extractCollectionFromResponse(response, preferredKeys);
	if (directItems.length > 0) {
		return directItems;
	}

	if (!isRecord(response)) {
		return [];
	}

	const preferredKey = preferredKeys[0];
	const chunkMetas = getPayloadChunkMeta(response, preferredKey);
	if (chunkMetas.length === 0) {
		return [];
	}

	for (const meta of chunkMetas) {
		const chunkItems = await fetchChunkedItems.call(this, meta.payloadKey, meta.chunkCount);
		if (chunkItems.length > 0) {
			return chunkItems;
		}
	}

	return [];
}

/**
 * Make an API request to BCGPT Gateway
 */
export async function bcgptApiRequest(
	this: BcgptContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<any> {
	const credentials = await this.getCredentials('basecampApi');

	const options: IHttpRequestOptions = {
		method,
		body,
		qs,
		url: `${credentials.baseUrl}${endpoint}`,
		headers: {
			'Content-Type': 'application/json',
			'x-bcgpt-api-key': credentials.apiKey as string,
			'x-api-key': credentials.apiKey as string,
		},
		json: true,
	};

	try {
		return await this.helpers.httpRequest(options);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as any);
	}
}

/**
 * Call a BCGPT tool
 */
export async function callBcgptTool(
	this: BcgptContext,
	tool: string,
	params: IDataObject = {},
): Promise<any> {
	const response = await bcgptApiRequest.call(this, 'POST', `/action/${tool}`, params);

	// Legacy wrapper
	if (isRecord(response) && response.success === true && Object.prototype.hasOwnProperty.call(response, 'data')) {
		return response.data;
	}

	if (isRecord(response) && response.success === false) {
		throw new Error(parseErrorMessage(response, tool));
	}

	// Current /action error format
	if (isRecord(response) && response.ok === false) {
		throw new Error(parseErrorMessage(response, tool));
	}

	// Defensive guard for partial error objects
	if (isRecord(response) && typeof response.error === 'string' && typeof response.code === 'string') {
		throw new Error(parseErrorMessage(response, tool));
	}

	return response;
}

function normalizeOptionName(
	item: Record<string, any>,
	candidates: string[],
	fallbackPrefix: string,
): string {
	for (const key of candidates) {
		const value = item[key];
		if (typeof value === 'string' && value.trim().length > 0) {
			return value;
		}
	}
	const fallbackId = item.id ?? item.value ?? '';
	return `${fallbackPrefix} ${fallbackId}`.trim();
}

function normalizeOptions(
	items: any[],
	nameCandidates: string[],
	fallbackPrefix: string,
	valueCandidates: string[] = ['id'],
): INodePropertyOptions[] {
	return items
		.map((raw) => (isRecord(raw) ? raw : null))
		.filter((item): item is Record<string, any> => item !== null)
		.map((item) => {
			let value: unknown;
			for (const key of valueCandidates) {
				if (item[key] !== undefined && item[key] !== null && `${item[key]}`.trim().length > 0) {
					value = item[key];
					break;
				}
			}
			if (value === undefined) {
				value = item.id ?? item.name ?? item.title;
			}
			return {
				name: normalizeOptionName(item, nameCandidates, fallbackPrefix),
				value: String(value),
			};
		})
		.filter((option) => option.value.length > 0);
}

/**
 * Get all projects for dropdowns
 */
export async function getProjects(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	try {
		const response = await callBcgptTool.call(this, 'list_projects', { archived: false });
		const projects = await resolveCollection.call(this, response, ['projects']);
		return normalizeOptions(projects, ['name'], 'Project');
	} catch {
		return [];
	}
}

/**
 * Get all todolists for a project
 */
export async function getTodolists(
	this: ILoadOptionsFunctions,
	project: string,
): Promise<INodePropertyOptions[]> {
	if (!project) {
		return [];
	}
	try {
		const response = await callBcgptTool.call(this, 'list_todolists', { project });
		const todolists = await resolveCollection.call(this, response, ['todolists']);
		return normalizeOptions(todolists, ['title', 'name'], 'Todo List');
	} catch {
		return [];
	}
}

export async function getTodosets(
	this: ILoadOptionsFunctions,
	project: string,
): Promise<INodePropertyOptions[]> {
	if (!project) {
		return [];
	}
	try {
		const response = await callBcgptTool.call(this, 'list_todolists', { project });
		const todolists = await resolveCollection.call(this, response, ['todolists']);
		const seen = new Set<string>();
		const options: INodePropertyOptions[] = [];

		for (const item of todolists) {
			if (!isRecord(item) || !isRecord(item.parent)) {
				continue;
			}
			const parentId = item.parent.id;
			if (parentId === undefined || parentId === null) {
				continue;
			}
			const value = String(parentId);
			if (seen.has(value)) {
				continue;
			}
			seen.add(value);
			const parentName =
				(typeof item.parent.title === 'string' && item.parent.title) ||
				(typeof item.parent.name === 'string' && item.parent.name) ||
				`Todoset ${value}`;
			options.push({
				name: parentName,
				value,
			});
		}

		return options;
	} catch {
		return [];
	}
}

export async function getMessageBoards(
	this: ILoadOptionsFunctions,
	project: string,
): Promise<INodePropertyOptions[]> {
	if (!project) {
		return [];
	}
	try {
		const response = await callBcgptTool.call(this, 'list_message_boards', { project });
		const boards = await resolveCollection.call(this, response, ['message_boards']);
		return normalizeOptions(boards, ['title', 'name'], 'Message Board');
	} catch {
		return [];
	}
}

export async function getMessages(
	this: ILoadOptionsFunctions,
	project: string,
	messageBoardId?: string,
): Promise<INodePropertyOptions[]> {
	if (!project) {
		return [];
	}
	try {
		const params: IDataObject = { project };
		if (messageBoardId) {
			params.message_board_id = parseInt(messageBoardId, 10);
		}
		const response = await callBcgptTool.call(this, 'list_messages', params);
		const messages = await resolveCollection.call(this, response, ['messages']);
		return normalizeOptions(messages, ['subject', 'title'], 'Message');
	} catch {
		return [];
	}
}

export async function getCardTables(
	this: ILoadOptionsFunctions,
	project: string,
): Promise<INodePropertyOptions[]> {
	if (!project) {
		return [];
	}
	try {
		const response = await callBcgptTool.call(this, 'list_card_tables', { project });
		const tables = await resolveCollection.call(this, response, ['card_tables']);
		return normalizeOptions(tables, ['name', 'title'], 'Card Table');
	} catch {
		return [];
	}
}

export async function getCardTableColumns(
	this: ILoadOptionsFunctions,
	project: string,
	cardTableId: string,
): Promise<INodePropertyOptions[]> {
	if (!project || !cardTableId) {
		return [];
	}
	try {
		const response = await callBcgptTool.call(this, 'list_card_table_columns', {
			project,
			card_table_id: parseInt(cardTableId, 10),
		});
		const columns = await resolveCollection.call(this, response, ['columns']);
		return normalizeOptions(columns, ['title', 'name'], 'Column');
	} catch {
		return [];
	}
}

export async function getCards(
	this: ILoadOptionsFunctions,
	project: string,
	cardTableId?: string,
): Promise<INodePropertyOptions[]> {
	if (!project) {
		return [];
	}
	try {
		const params: IDataObject = { project };
		if (cardTableId) {
			params.card_table_id = parseInt(cardTableId, 10);
		}
		const response = await callBcgptTool.call(this, 'list_card_table_cards', params);
		const cards = await resolveCollection.call(this, response, ['cards']);
		return normalizeOptions(cards, ['title', 'name'], 'Card');
	} catch {
		return [];
	}
}

export async function getVaults(
	this: ILoadOptionsFunctions,
	project: string,
): Promise<INodePropertyOptions[]> {
	if (!project) {
		return [];
	}
	try {
		const response = await callBcgptTool.call(this, 'list_vaults', { project });
		const vaults = await resolveCollection.call(this, response, ['vaults']);
		return normalizeOptions(vaults, ['name', 'title'], 'Vault');
	} catch {
		return [];
	}
}

export async function getDocuments(
	this: ILoadOptionsFunctions,
	project: string,
): Promise<INodePropertyOptions[]> {
	if (!project) {
		return [];
	}
	try {
		const response = await callBcgptTool.call(this, 'list_documents', { project });
		const documents = await resolveCollection.call(this, response, ['documents']);
		return normalizeOptions(documents, ['title', 'name'], 'Document');
	} catch {
		return [];
	}
}

export async function getUploads(
	this: ILoadOptionsFunctions,
	project: string,
	vaultId?: string,
): Promise<INodePropertyOptions[]> {
	if (!project) {
		return [];
	}
	try {
		const params: IDataObject = { project };
		if (vaultId) {
			params.vault_id = parseInt(vaultId, 10);
		}
		const response = await callBcgptTool.call(this, 'list_uploads', params);
		const uploads = await resolveCollection.call(this, response, ['uploads']);
		return normalizeOptions(uploads, ['name', 'title'], 'Upload');
	} catch {
		return [];
	}
}

export async function getProjectPeople(
	this: ILoadOptionsFunctions,
	project: string,
): Promise<INodePropertyOptions[]> {
	if (!project) {
		return [];
	}
	try {
		const response = await callBcgptTool.call(this, 'list_project_people', { project });
		const people = await resolveCollection.call(this, response, ['people']);
		return normalizeOptions(people, ['name', 'email'], 'Person');
	} catch {
		return [];
	}
}
