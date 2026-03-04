import {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import {
	callBcgptTool,
	getCardTableColumns,
	getCardTables,
	getCards,
	getDocuments,
	getMessageBoards,
	getMessages,
	getProjectPeople,
	getProjects,
	getTodosets,
	getTodolists,
	getUploads,
	getVaults,
} from './GenericFunctions';

function toInt(value: string, fieldName: string): number {
	const parsed = parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		throw new Error(`Invalid ${fieldName}: expected integer, got "${value}"`);
	}
	return parsed;
}

function parseJsonObject(raw: string, fieldName: string): IDataObject {
	if (!raw?.trim()) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error();
		}
		return parsed as IDataObject;
	} catch {
		throw new Error(`Invalid JSON in ${fieldName}`);
	}
}

function parseCsvInts(raw: string, fieldName: string): number[] {
	return raw
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id.length > 0)
		.map((id) => {
			const parsed = parseInt(id, 10);
			if (Number.isNaN(parsed)) {
				throw new Error(`Invalid ${fieldName} value: "${id}"`);
			}
			return parsed;
		});
}

export class Basecamp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Basecamp',
		name: 'basecamp',
		icon: 'file:basecamp.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Basecamp 3/4 via BCGPT Gateway',
		defaults: {
			name: 'Basecamp',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'basecampApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Project',
						value: 'project',
					},
					{
						name: 'Todo',
						value: 'todo',
					},
					{
						name: 'Todo List',
						value: 'todolist',
					},
					{
						name: 'Message',
						value: 'message',
					},
					{
						name: 'Card',
						value: 'card',
					},
					{
						name: 'Comment',
						value: 'comment',
					},
					{
						name: 'Document',
						value: 'document',
					},
					{
						name: 'File',
						value: 'file',
					},
					{
						name: 'Person',
						value: 'person',
					},
				],
				default: 'project',
			},

			// ========================================
			//             PROJECT
			// ========================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['project'],
					},
				},
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get all projects',
						action: 'Get many projects',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a project',
						action: 'Get a project',
					},
					{
						name: 'Find by Name',
						value: 'findByName',
						description: 'Find project by name',
						action: 'Find project by name',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a project',
						action: 'Create a project',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a project',
						action: 'Update a project',
					},
					{
						name: 'Trash',
						value: 'trash',
						description: 'Move project to trash',
						action: 'Trash a project',
					},
				],
				default: 'getAll',
			},

			// Project: getAll
			{
				displayName: 'Include Archived',
				name: 'includeArchived',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['project'],
						operation: ['getAll'],
					},
				},
				default: false,
				description: 'Whether to include archived projects',
			},

			// Project: get, update, trash
			{
				displayName: 'Project',
				name: 'projectId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProjects',
				},
				displayOptions: {
					show: {
						resource: ['project'],
						operation: ['get', 'update', 'trash'],
					},
				},
				default: '',
				required: true,
				description: 'The project to operate on',
			},

			// Project: findByName
			{
				displayName: 'Project Name',
				name: 'projectName',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['project'],
						operation: ['findByName'],
					},
				},
				default: '',
				required: true,
				description: 'Name of the project to find',
			},

			// Project: create, update
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['project'],
						operation: ['create', 'update'],
					},
				},
				default: '',
				description: 'Project name',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['project'],
						operation: ['create', 'update'],
					},
				},
				default: '',
				description: 'Project description',
			},

			// ========================================
			//             TODO LIST
			// ========================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['todolist'],
					},
				},
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get todo lists',
						action: 'Get many todo lists',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a todo list',
						action: 'Get a todo list',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a todo list',
						action: 'Create a todo list',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a todo list',
						action: 'Update a todo list',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Project',
				name: 'projectId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProjects',
				},
				displayOptions: {
					show: {
						resource: ['todolist'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Todo List',
				name: 'todolistId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getTodolists',
					loadOptionsDependsOn: ['projectId'],
				},
				displayOptions: {
					show: {
						resource: ['todolist'],
						operation: ['get', 'update'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Todo Set ID',
				name: 'todosetId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getTodosets',
					loadOptionsDependsOn: ['projectId'],
				},
				displayOptions: {
					show: {
						resource: ['todolist'],
						operation: ['create'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Title',
				name: 'todolistTitle',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['todolist'],
						operation: ['create', 'update'],
					},
				},
				default: '',
				description: 'Todo list title',
			},
			{
				displayName: 'Description',
				name: 'todolistDescription',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['todolist'],
						operation: ['create', 'update'],
					},
				},
				default: '',
				description: 'Todo list description',
			},
			{
				displayName: 'Body JSON',
				name: 'todolistBodyJson',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						resource: ['todolist'],
						operation: ['create', 'update'],
					},
				},
				default: '',
				description: 'Optional raw JSON body merged with title/description',
			},

			// ========================================
			//             TODO
			// ========================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['todo'],
					},
				},
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get todos from a list',
						action: 'Get many todos',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a todo',
						action: 'Create a todo',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a todo',
						action: 'Get a todo',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a todo',
						action: 'Update a todo',
					},
					{
						name: 'Complete',
						value: 'complete',
						description: 'Complete a todo',
						action: 'Complete a todo',
					},
					{
						name: 'Uncomplete',
						value: 'uncomplete',
						description: 'Uncomplete a todo',
						action: 'Uncomplete a todo',
					},
				],
				default: 'getAll',
			},

			// Todo: all operations need project
			{
				displayName: 'Project',
				name: 'projectId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProjects',
				},
				displayOptions: {
					show: {
						resource: ['todo'],
					},
				},
				default: '',
				required: true,
			},

			// Todo: create needs todolist
			{
				displayName: 'Todo List',
				name: 'todolistId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getTodolists',
					loadOptionsDependsOn: ['projectId'],
				},
				displayOptions: {
					show: {
						resource: ['todo'],
						operation: ['getAll', 'create'],
					},
				},
				default: '',
				required: true,
			},

			// Todo: get, update, complete, uncomplete, delete
			{
				displayName: 'Todo ID',
				name: 'todoId',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['todo'],
						operation: ['get', 'update', 'complete', 'uncomplete'],
					},
				},
				default: '',
				required: true,
			},

			// Todo: create, update
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['todo'],
						operation: ['create', 'update'],
					},
				},
				default: '',
				required: true,
				description: 'The todo description',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['todo'],
						operation: ['create', 'update'],
					},
				},
				options: [
					{
						displayName: 'Due Date',
						name: 'due_on',
						type: 'dateTime',
						default: '',
						description: 'Due date for the todo',
					},
					{
						displayName: 'Starts On',
						name: 'starts_on',
						type: 'dateTime',
						default: '',
						description: 'Start date for the todo',
					},
					{
						displayName: 'Assignee IDs',
						name: 'assignee_ids',
						type: 'string',
						default: '',
						description: 'Comma-separated list of person IDs to assign',
					},
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: '',
						description: 'Todo description',
					},
					{
						displayName: 'Completion Subscriber IDs',
						name: 'completion_subscriber_ids',
						type: 'string',
						default: '',
						description: 'Comma-separated list of completion subscriber person IDs',
					},
					{
						displayName: 'Notify',
						name: 'notify',
						type: 'boolean',
						default: false,
						description: 'Whether to notify assignees/subscribers',
					},
				],
			},

			// ========================================
			//             MESSAGE
			// ========================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['message'],
					},
				},
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get messages',
						action: 'Get many messages',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a message',
						action: 'Create a message',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a message',
						action: 'Get a message',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a message',
						action: 'Update a message',
					},
				],
				default: 'getAll',
			},

			// Message: all operations need project
			{
				displayName: 'Project',
				name: 'projectId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProjects',
				},
				displayOptions: {
					show: {
						resource: ['message'],
					},
				},
				default: '',
				required: true,
			},

			{
				displayName: 'Message Board',
				name: 'messageBoardId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getMessageBoards',
					loadOptionsDependsOn: ['projectId'],
				},
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['getAll', 'create'],
					},
				},
				default: '',
				description: 'Optional for Get Many, required for Create',
			},

			// Message: get, update, delete
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getMessages',
					loadOptionsDependsOn: ['projectId', 'messageBoardId'],
				},
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['get', 'update'],
					},
				},
				default: '',
				required: true,
			},

			// Message: create, update
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['create', 'update'],
					},
				},
				default: '',
				required: false,
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: {
					rows: 5,
				},
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['create', 'update'],
					},
				},
				default: '',
				description: 'Message content (HTML supported)',
			},

			// ========================================
			//             CARD
			// ========================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['card'],
					},
				},
				options: [
					{ name: 'Get Many', value: 'getAll', action: 'Get many cards' },
					{ name: 'Get', value: 'get', action: 'Get a card' },
					{ name: 'Create', value: 'create', action: 'Create a card' },
					{ name: 'Update', value: 'update', action: 'Update a card' },
					{ name: 'Move', value: 'move', action: 'Move a card' },
					{ name: 'Trash', value: 'trash', action: 'Trash a card' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Project',
				name: 'projectId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProjects',
				},
				displayOptions: {
					show: {
						resource: ['card'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Card Table',
				name: 'cardTableId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getCardTables',
					loadOptionsDependsOn: ['projectId'],
				},
				displayOptions: {
					show: {
						resource: ['card'],
						operation: ['getAll', 'create', 'get', 'update', 'move', 'trash'],
					},
				},
				default: '',
			},
			{
				displayName: 'Card',
				name: 'cardId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getCards',
					loadOptionsDependsOn: ['projectId', 'cardTableId'],
				},
				displayOptions: {
					show: {
						resource: ['card'],
						operation: ['get', 'update', 'move', 'trash'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Column',
				name: 'columnId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getCardTableColumns',
					loadOptionsDependsOn: ['projectId', 'cardTableId'],
				},
				displayOptions: {
					show: {
						resource: ['card'],
						operation: ['create', 'move'],
					},
				},
				default: '',
			},
			{
				displayName: 'Title',
				name: 'cardTitle',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['card'],
						operation: ['create'],
					},
				},
				default: '',
			},
			{
				displayName: 'Card Body JSON',
				name: 'cardBodyJson',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						resource: ['card'],
						operation: ['create', 'update', 'move'],
					},
				},
				default: '',
				description: 'Optional JSON merged into card params/body',
			},

			// ========================================
			//             COMMENT
			// ========================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['comment'],
					},
				},
				options: [
					{ name: 'Get Many', value: 'getAll', action: 'Get many comments' },
					{ name: 'Create', value: 'create', action: 'Create a comment' },
					{ name: 'Update', value: 'update', action: 'Update a comment' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Project',
				name: 'projectId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProjects',
				},
				displayOptions: {
					show: {
						resource: ['comment'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Recording ID',
				name: 'recordingId',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['getAll', 'create'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Comment ID',
				name: 'commentId',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['update'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Content',
				name: 'commentContent',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['create', 'update'],
					},
				},
				default: '',
			},
			{
				displayName: 'Body JSON',
				name: 'commentBodyJson',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['create', 'update'],
					},
				},
				default: '',
			},

			// ========================================
			//             DOCUMENT
			// ========================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['document'],
					},
				},
				options: [
					{ name: 'Get Many', value: 'getAll', action: 'Get many documents' },
					{ name: 'Get', value: 'get', action: 'Get a document' },
					{ name: 'Create', value: 'create', action: 'Create a document' },
					{ name: 'Update', value: 'update', action: 'Update a document' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Project',
				name: 'projectId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProjects',
				},
				displayOptions: {
					show: {
						resource: ['document'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Document',
				name: 'documentId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getDocuments',
					loadOptionsDependsOn: ['projectId'],
				},
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['get', 'update'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Vault',
				name: 'vaultId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getVaults',
					loadOptionsDependsOn: ['projectId'],
				},
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['create'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Title',
				name: 'documentTitle',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['create', 'update'],
					},
				},
				default: '',
			},
			{
				displayName: 'Content',
				name: 'documentContent',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['create', 'update'],
					},
				},
				default: '',
			},
			{
				displayName: 'Body JSON',
				name: 'documentBodyJson',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['create', 'update'],
					},
				},
				default: '',
			},

			// ========================================
			//             FILE
			// ========================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['file'],
					},
				},
				options: [
					{ name: 'Get Many', value: 'getAll', action: 'Get many uploads' },
					{ name: 'Get', value: 'get', action: 'Get an upload' },
					{ name: 'Create', value: 'create', action: 'Create an upload' },
					{ name: 'Update', value: 'update', action: 'Update an upload' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Project',
				name: 'projectId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProjects',
				},
				displayOptions: {
					show: {
						resource: ['file'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Vault',
				name: 'vaultId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getVaults',
					loadOptionsDependsOn: ['projectId'],
				},
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['getAll', 'create'],
					},
				},
				default: '',
				description: 'Optional for Get Many, required for Create',
			},
			{
				displayName: 'Upload',
				name: 'uploadId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getUploads',
					loadOptionsDependsOn: ['projectId', 'vaultId'],
				},
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['get', 'update'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Name',
				name: 'uploadName',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['create', 'update'],
					},
				},
				default: '',
			},
			{
				displayName: 'Content',
				name: 'uploadContent',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['create', 'update'],
					},
				},
				default: '',
			},
			{
				displayName: 'Body JSON',
				name: 'uploadBodyJson',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['create', 'update'],
					},
				},
				default: '',
			},

			// ========================================
			//             PERSON
			// ========================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['person'],
					},
				},
				options: [
					{ name: 'List Project People', value: 'getAll', action: 'Get project people' },
					{ name: 'Get', value: 'get', action: 'Get a person' },
					{ name: 'Search All', value: 'searchAll', action: 'Search all people' },
					{ name: 'List Person Projects', value: 'listProjects', action: 'Get person projects' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Project',
				name: 'personProjectId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProjects',
				},
				displayOptions: {
					show: {
						resource: ['person'],
						operation: ['getAll'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Person',
				name: 'personId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProjectPeople',
					loadOptionsDependsOn: ['personProjectId'],
				},
				displayOptions: {
					show: {
						resource: ['person'],
						operation: ['get', 'listProjects'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Search Query',
				name: 'peopleQuery',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['person'],
						operation: ['searchAll'],
					},
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Include Archived Projects',
				name: 'includeArchivedProjects',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['person'],
						operation: ['searchAll', 'listProjects'],
					},
				},
				default: false,
			},
			{
				displayName: 'Deep Scan',
				name: 'deepScan',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['person'],
						operation: ['searchAll'],
					},
				},
				default: false,
			},
		],
	};

	methods = {
		loadOptions: {
			async getProjects(this: ILoadOptionsFunctions) {
				return await getProjects.call(this);
			},
			async getTodolists(this: ILoadOptionsFunctions) {
				const projectId = this.getNodeParameter('projectId', 0) as string;
				return await getTodolists.call(this, projectId);
			},
			async getTodosets(this: ILoadOptionsFunctions) {
				const projectId = this.getNodeParameter('projectId', 0) as string;
				return await getTodosets.call(this, projectId);
			},
			async getMessageBoards(this: ILoadOptionsFunctions) {
				const projectId = this.getNodeParameter('projectId', 0) as string;
				return await getMessageBoards.call(this, projectId);
			},
			async getMessages(this: ILoadOptionsFunctions) {
				const projectId = this.getNodeParameter('projectId', 0) as string;
				let messageBoardId = '';
				try {
					messageBoardId = this.getNodeParameter('messageBoardId', 0) as string;
				} catch {
					messageBoardId = '';
				}
				return await getMessages.call(this, projectId, messageBoardId);
			},
			async getCardTables(this: ILoadOptionsFunctions) {
				const projectId = this.getNodeParameter('projectId', 0) as string;
				return await getCardTables.call(this, projectId);
			},
			async getCardTableColumns(this: ILoadOptionsFunctions) {
				const projectId = this.getNodeParameter('projectId', 0) as string;
				let cardTableId = '';
				try {
					cardTableId = this.getNodeParameter('cardTableId', 0) as string;
				} catch {
					cardTableId = '';
				}
				return await getCardTableColumns.call(this, projectId, cardTableId);
			},
			async getCards(this: ILoadOptionsFunctions) {
				const projectId = this.getNodeParameter('projectId', 0) as string;
				let cardTableId = '';
				try {
					cardTableId = this.getNodeParameter('cardTableId', 0) as string;
				} catch {
					cardTableId = '';
				}
				return await getCards.call(this, projectId, cardTableId);
			},
			async getVaults(this: ILoadOptionsFunctions) {
				const projectId = this.getNodeParameter('projectId', 0) as string;
				return await getVaults.call(this, projectId);
			},
			async getDocuments(this: ILoadOptionsFunctions) {
				const projectId = this.getNodeParameter('projectId', 0) as string;
				return await getDocuments.call(this, projectId);
			},
			async getUploads(this: ILoadOptionsFunctions) {
				const projectId = this.getNodeParameter('projectId', 0) as string;
				let vaultId = '';
				try {
					vaultId = this.getNodeParameter('vaultId', 0) as string;
				} catch {
					vaultId = '';
				}
				return await getUploads.call(this, projectId, vaultId);
			},
			async getProjectPeople(this: ILoadOptionsFunctions) {
				const projectId = this.getNodeParameter('personProjectId', 0) as string;
				return await getProjectPeople.call(this, projectId);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let responseData: any;

				if (resource === 'project') {
					if (operation === 'getAll') {
						const includeArchived = this.getNodeParameter('includeArchived', i) as boolean;
						responseData = await callBcgptTool.call(this, 'list_projects', { archived: includeArchived });
					} else if (operation === 'get') {
						const projectId = toInt(this.getNodeParameter('projectId', i) as string, 'projectId');
						responseData = await callBcgptTool.call(this, 'get_project', { project_id: projectId });
					} else if (operation === 'findByName') {
						const projectName = this.getNodeParameter('projectName', i) as string;
						responseData = await callBcgptTool.call(this, 'find_project', { name: projectName });
					} else if (operation === 'create') {
						const name = this.getNodeParameter('name', i) as string;
						const description = this.getNodeParameter('description', i, '') as string;
						const body: IDataObject = { name };
						if (description) body.description = description;
						responseData = await callBcgptTool.call(this, 'create_project', { body });
					} else if (operation === 'update') {
						const projectId = toInt(this.getNodeParameter('projectId', i) as string, 'projectId');
						const name = this.getNodeParameter('name', i, '') as string;
						const description = this.getNodeParameter('description', i, '') as string;
						const body: IDataObject = {};
						if (name) body.name = name;
						if (description) body.description = description;
						responseData = await callBcgptTool.call(this, 'update_project', { project_id: projectId, body });
					} else if (operation === 'trash') {
						const projectId = toInt(this.getNodeParameter('projectId', i) as string, 'projectId');
						responseData = await callBcgptTool.call(this, 'trash_project', { project_id: projectId });
					}
				} else if (resource === 'todolist') {
					const project = this.getNodeParameter('projectId', i) as string;
					if (operation === 'getAll') {
						responseData = await callBcgptTool.call(this, 'list_todolists', { project });
					} else if (operation === 'get') {
						const todolistId = toInt(this.getNodeParameter('todolistId', i) as string, 'todolistId');
						responseData = await callBcgptTool.call(this, 'get_todolist', { project, todolist_id: todolistId });
					} else if (operation === 'create') {
						const todosetId = toInt(this.getNodeParameter('todosetId', i) as string, 'todosetId');
						const title = this.getNodeParameter('todolistTitle', i, '') as string;
						const description = this.getNodeParameter('todolistDescription', i, '') as string;
						const body = parseJsonObject(
							this.getNodeParameter('todolistBodyJson', i, '') as string,
							'todolistBodyJson',
						);
						if (title) {
							body.name = title;
							body.title = title;
						}
						if (description) {
							body.description = description;
						}
						responseData = await callBcgptTool.call(this, 'create_todolist', {
							project,
							todoset_id: todosetId,
							body,
						});
					} else if (operation === 'update') {
						const todolistId = toInt(this.getNodeParameter('todolistId', i) as string, 'todolistId');
						const title = this.getNodeParameter('todolistTitle', i, '') as string;
						const description = this.getNodeParameter('todolistDescription', i, '') as string;
						const body = parseJsonObject(
							this.getNodeParameter('todolistBodyJson', i, '') as string,
							'todolistBodyJson',
						);
						if (title) {
							body.name = title;
							body.title = title;
						}
						if (description) {
							body.description = description;
						}
						responseData = await callBcgptTool.call(this, 'update_todolist', {
							project,
							todolist_id: todolistId,
							body,
						});
					}
				} else if (resource === 'todo') {
					const project = this.getNodeParameter('projectId', i) as string;
					if (operation === 'getAll') {
						const todolistId = toInt(this.getNodeParameter('todolistId', i) as string, 'todolistId');
						responseData = await callBcgptTool.call(this, 'list_todos_for_list', {
							project,
							todolist_id: todolistId,
						});
					} else if (operation === 'create') {
						const todolistId = this.getNodeParameter('todolistId', i) as string;
						const content = this.getNodeParameter('content', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
						const params: IDataObject = { project, content, task: content, todolist: todolistId };
						if (additionalFields.due_on) params.due_on = additionalFields.due_on;
						if (additionalFields.starts_on) params.starts_on = additionalFields.starts_on;
						if (additionalFields.assignee_ids) {
							params.assignee_ids = parseCsvInts(additionalFields.assignee_ids as string, 'assignee_ids');
						}
						if (additionalFields.description) params.description = additionalFields.description;
						if (additionalFields.completion_subscriber_ids) {
							params.completion_subscriber_ids = parseCsvInts(
								additionalFields.completion_subscriber_ids as string,
								'completion_subscriber_ids',
							);
						}
						if (typeof additionalFields.notify === 'boolean') params.notify = additionalFields.notify;
						responseData = await callBcgptTool.call(this, 'create_todo', params);
					} else if (operation === 'get') {
						const todoId = toInt(this.getNodeParameter('todoId', i) as string, 'todoId');
						responseData = await callBcgptTool.call(this, 'get_todo', { project, todo_id: todoId });
					} else if (operation === 'update') {
						const todoId = toInt(this.getNodeParameter('todoId', i) as string, 'todoId');
						const content = this.getNodeParameter('content', i, '') as string;
						const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
						const params: IDataObject = { project, todo_id: todoId };
						if (content) params.content = content;
						if (additionalFields.due_on) params.due_on = additionalFields.due_on;
						if (additionalFields.starts_on) params.starts_on = additionalFields.starts_on;
						if (additionalFields.assignee_ids) {
							params.assignee_ids = parseCsvInts(additionalFields.assignee_ids as string, 'assignee_ids');
						}
						if (additionalFields.description) params.description = additionalFields.description;
						if (additionalFields.completion_subscriber_ids) {
							params.completion_subscriber_ids = parseCsvInts(
								additionalFields.completion_subscriber_ids as string,
								'completion_subscriber_ids',
							);
						}
						if (typeof additionalFields.notify === 'boolean') params.notify = additionalFields.notify;
						responseData = await callBcgptTool.call(this, 'update_todo_details', params);
					} else if (operation === 'complete') {
						const todoId = toInt(this.getNodeParameter('todoId', i) as string, 'todoId');
						responseData = await callBcgptTool.call(this, 'complete_todo', { project, todo_id: todoId });
					} else if (operation === 'uncomplete') {
						const todoId = toInt(this.getNodeParameter('todoId', i) as string, 'todoId');
						responseData = await callBcgptTool.call(this, 'uncomplete_todo', { project, todo_id: todoId });
					}
				} else if (resource === 'message') {
					const project = this.getNodeParameter('projectId', i) as string;
					if (operation === 'getAll') {
						const messageBoardId = this.getNodeParameter('messageBoardId', i, '') as string;
						const params: IDataObject = { project };
						if (messageBoardId) params.message_board_id = toInt(messageBoardId, 'messageBoardId');
						responseData = await callBcgptTool.call(this, 'list_messages', params);
					} else if (operation === 'create') {
						const subject = this.getNodeParameter('subject', i, '') as string;
						const content = this.getNodeParameter('content', i, '') as string;
						const boardId = toInt(this.getNodeParameter('messageBoardId', i) as string, 'messageBoardId');
						responseData = await callBcgptTool.call(this, 'create_message', {
							project,
							board_id: boardId,
							subject,
							content,
						});
					} else if (operation === 'get') {
						const messageId = toInt(this.getNodeParameter('messageId', i) as string, 'messageId');
						responseData = await callBcgptTool.call(this, 'get_message', { project, message_id: messageId });
					} else if (operation === 'update') {
						const messageId = toInt(this.getNodeParameter('messageId', i) as string, 'messageId');
						const subject = this.getNodeParameter('subject', i, '') as string;
						const content = this.getNodeParameter('content', i, '') as string;
						responseData = await callBcgptTool.call(this, 'update_message', {
							project,
							message_id: messageId,
							subject,
							content,
						});
					}
				} else if (resource === 'card') {
					const project = this.getNodeParameter('projectId', i) as string;
					if (operation === 'getAll') {
						const cardTableId = this.getNodeParameter('cardTableId', i, '') as string;
						const params: IDataObject = { project };
						if (cardTableId) params.card_table_id = toInt(cardTableId, 'cardTableId');
						responseData = await callBcgptTool.call(this, 'list_card_table_cards', params);
					} else if (operation === 'get') {
						const cardId = toInt(this.getNodeParameter('cardId', i) as string, 'cardId');
						responseData = await callBcgptTool.call(this, 'get_card', { project, card_id: cardId });
					} else if (operation === 'create') {
						const cardTableId = toInt(this.getNodeParameter('cardTableId', i) as string, 'cardTableId');
						const cardTitle = this.getNodeParameter('cardTitle', i, '') as string;
						const columnId = this.getNodeParameter('columnId', i, '') as string;
						const params: IDataObject = { project, card_table_id: cardTableId, title: cardTitle };
						if (columnId) params.column_id = toInt(columnId, 'columnId');
						Object.assign(params, parseJsonObject(this.getNodeParameter('cardBodyJson', i, '') as string, 'cardBodyJson'));
						responseData = await callBcgptTool.call(this, 'create_card', params);
					} else if (operation === 'update') {
						const cardId = toInt(this.getNodeParameter('cardId', i) as string, 'cardId');
						const body = parseJsonObject(this.getNodeParameter('cardBodyJson', i, '') as string, 'cardBodyJson');
						responseData = await callBcgptTool.call(this, 'update_card', { project, card_id: cardId, body });
					} else if (operation === 'move') {
						const cardId = toInt(this.getNodeParameter('cardId', i) as string, 'cardId');
						const columnId = this.getNodeParameter('columnId', i, '') as string;
						const params: IDataObject = { project, card_id: cardId };
						if (columnId) params.column_id = toInt(columnId, 'columnId');
						Object.assign(params, parseJsonObject(this.getNodeParameter('cardBodyJson', i, '') as string, 'cardBodyJson'));
						responseData = await callBcgptTool.call(this, 'move_card', params);
					} else if (operation === 'trash') {
						const cardId = toInt(this.getNodeParameter('cardId', i) as string, 'cardId');
						responseData = await callBcgptTool.call(this, 'trash_card', { project, card_id: cardId });
					}
				} else if (resource === 'comment') {
					const project = this.getNodeParameter('projectId', i) as string;
					if (operation === 'getAll') {
						const recordingId = this.getNodeParameter('recordingId', i) as string;
						responseData = await callBcgptTool.call(this, 'list_comments', { project, recording_id: recordingId });
					} else if (operation === 'create') {
						const recordingId = this.getNodeParameter('recordingId', i) as string;
						const content = this.getNodeParameter('commentContent', i, '') as string;
						const params: IDataObject = { project, recording_id: recordingId };
						if (content) params.content = content;
						Object.assign(params, parseJsonObject(this.getNodeParameter('commentBodyJson', i, '') as string, 'commentBodyJson'));
						responseData = await callBcgptTool.call(this, 'create_comment', params);
					} else if (operation === 'update') {
						const commentId = toInt(this.getNodeParameter('commentId', i) as string, 'commentId');
						const content = this.getNodeParameter('commentContent', i, '') as string;
						const params: IDataObject = { project, comment_id: commentId };
						if (content) params.content = content;
						Object.assign(params, parseJsonObject(this.getNodeParameter('commentBodyJson', i, '') as string, 'commentBodyJson'));
						responseData = await callBcgptTool.call(this, 'update_comment', params);
					}
				} else if (resource === 'document') {
					const project = this.getNodeParameter('projectId', i) as string;
					if (operation === 'getAll') {
						responseData = await callBcgptTool.call(this, 'list_documents', { project });
					} else if (operation === 'get') {
						const documentId = toInt(this.getNodeParameter('documentId', i) as string, 'documentId');
						responseData = await callBcgptTool.call(this, 'get_document', { project, document_id: documentId });
					} else if (operation === 'create') {
						const vaultId = toInt(this.getNodeParameter('vaultId', i) as string, 'vaultId');
						const body = parseJsonObject(this.getNodeParameter('documentBodyJson', i, '') as string, 'documentBodyJson');
						const title = this.getNodeParameter('documentTitle', i, '') as string;
						const content = this.getNodeParameter('documentContent', i, '') as string;
						if (title) body.title = title;
						if (content) body.content = content;
						responseData = await callBcgptTool.call(this, 'create_document', { project, vault_id: vaultId, body });
					} else if (operation === 'update') {
						const documentId = toInt(this.getNodeParameter('documentId', i) as string, 'documentId');
						const body = parseJsonObject(this.getNodeParameter('documentBodyJson', i, '') as string, 'documentBodyJson');
						const title = this.getNodeParameter('documentTitle', i, '') as string;
						const content = this.getNodeParameter('documentContent', i, '') as string;
						if (title) body.title = title;
						if (content) body.content = content;
						responseData = await callBcgptTool.call(this, 'update_document', { project, document_id: documentId, body });
					}
				} else if (resource === 'file') {
					const project = this.getNodeParameter('projectId', i) as string;
					if (operation === 'getAll') {
						const vaultId = this.getNodeParameter('vaultId', i, '') as string;
						const params: IDataObject = { project };
						if (vaultId) params.vault_id = toInt(vaultId, 'vaultId');
						responseData = await callBcgptTool.call(this, 'list_uploads', params);
					} else if (operation === 'get') {
						const uploadId = toInt(this.getNodeParameter('uploadId', i) as string, 'uploadId');
						responseData = await callBcgptTool.call(this, 'get_upload', { project, upload_id: uploadId });
					} else if (operation === 'create') {
						const vaultId = toInt(this.getNodeParameter('vaultId', i) as string, 'vaultId');
						const body = parseJsonObject(this.getNodeParameter('uploadBodyJson', i, '') as string, 'uploadBodyJson');
						const name = this.getNodeParameter('uploadName', i, '') as string;
						const content = this.getNodeParameter('uploadContent', i, '') as string;
						if (name) body.name = name;
						if (content) body.content = content;
						responseData = await callBcgptTool.call(this, 'create_upload', { project, vault_id: vaultId, body });
					} else if (operation === 'update') {
						const uploadId = toInt(this.getNodeParameter('uploadId', i) as string, 'uploadId');
						const body = parseJsonObject(this.getNodeParameter('uploadBodyJson', i, '') as string, 'uploadBodyJson');
						const name = this.getNodeParameter('uploadName', i, '') as string;
						const content = this.getNodeParameter('uploadContent', i, '') as string;
						if (name) body.name = name;
						if (content) body.content = content;
						responseData = await callBcgptTool.call(this, 'update_upload', { project, upload_id: uploadId, body });
					}
				} else if (resource === 'person') {
					if (operation === 'getAll') {
						const project = this.getNodeParameter('personProjectId', i) as string;
						responseData = await callBcgptTool.call(this, 'list_project_people', { project });
					} else if (operation === 'get') {
						const personId = toInt(this.getNodeParameter('personId', i) as string, 'personId');
						responseData = await callBcgptTool.call(this, 'get_person', { person_id: personId });
					} else if (operation === 'searchAll') {
						const query = this.getNodeParameter('peopleQuery', i) as string;
						const deepScan = this.getNodeParameter('deepScan', i, false) as boolean;
						const includeArchivedProjects = this.getNodeParameter('includeArchivedProjects', i, false) as boolean;
						responseData = await callBcgptTool.call(this, 'list_all_people', {
							query,
							deep_scan: deepScan,
							include_archived_projects: includeArchivedProjects,
						});
					} else if (operation === 'listProjects') {
						const personRef = this.getNodeParameter('personId', i) as string;
						const includeArchivedProjects = this.getNodeParameter('includeArchivedProjects', i, false) as boolean;
						responseData = await callBcgptTool.call(this, 'list_person_projects', {
							person: personRef,
							include_archived_projects: includeArchivedProjects,
						});
					}
				}

				if (responseData === undefined) {
					throw new Error(`Unsupported operation "${operation}" for resource "${resource}"`);
				}

				if (Array.isArray(responseData)) {
					returnData.push(...responseData);
				} else {
					returnData.push(responseData as IDataObject);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ error: (error as Error).message });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}
