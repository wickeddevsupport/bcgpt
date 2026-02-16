import {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { callBcgptTool, getProjects, getTodolists } from './GenericFunctions';

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
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a todo',
						action: 'Delete a todo',
					},
				],
				default: 'create',
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
						operation: ['create'],
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
						operation: ['get', 'update', 'complete', 'uncomplete', 'delete'],
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
						displayName: 'Assignee IDs',
						name: 'assignee_ids',
						type: 'string',
						default: '',
						description: 'Comma-separated list of person IDs to assign',
					},
					{
						displayName: 'Notes',
						name: 'notes',
						type: 'string',
						default: '',
						description: 'Additional notes',
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
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a message',
						action: 'Delete a message',
					},
				],
				default: 'create',
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

			// Message: get, update, delete
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['get', 'update', 'delete'],
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
				required: true,
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
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: any;

				if (resource === 'project') {
					// ========================================
					//             PROJECT
					// ========================================
					if (operation === 'getAll') {
						const includeArchived = this.getNodeParameter('includeArchived', i) as boolean;
						responseData = await callBcgptTool.call(this, 'list_projects', {
							archived: includeArchived,
						});
					} else if (operation === 'get') {
						const projectId = this.getNodeParameter('projectId', i) as string;
						responseData = await callBcgptTool.call(this, 'get_project', {
							project_id: parseInt(projectId, 10),
						});
					} else if (operation === 'findByName') {
						const projectName = this.getNodeParameter('projectName', i) as string;
						responseData = await callBcgptTool.call(this, 'find_project', {
							name: projectName,
						});
					} else if (operation === 'create') {
						const name = this.getNodeParameter('name', i) as string;
						const description = this.getNodeParameter('description', i, '') as string;
						responseData = await callBcgptTool.call(this, 'create_project', {
							name,
							description,
						});
					} else if (operation === 'update') {
						const projectId = this.getNodeParameter('projectId', i) as string;
						const name = this.getNodeParameter('name', i, '') as string;
						const description = this.getNodeParameter('description', i, '') as string;
						const params: IDataObject = {
							project_id: parseInt(projectId, 10),
						};
						if (name) params.name = name;
						if (description) params.description = description;
						responseData = await callBcgptTool.call(this, 'update_project', params);
					} else if (operation === 'trash') {
						const projectId = this.getNodeParameter('projectId', i) as string;
						responseData = await callBcgptTool.call(this, 'trash_project', {
							project_id: parseInt(projectId, 10),
						});
					}
				} else if (resource === 'todo') {
					// ========================================
					//             TODO
					// ========================================
					const projectId = this.getNodeParameter('projectId', i) as string;

					if (operation === 'create') {
						const todolistId = this.getNodeParameter('todolistId', i) as string;
						const content = this.getNodeParameter('content', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;

						const params: IDataObject = {
							project_id: parseInt(projectId, 10),
							todolist_id: parseInt(todolistId, 10),
							content,
						};

						if (additionalFields.due_on) {
							params.due_on = additionalFields.due_on;
						}
						if (additionalFields.assignee_ids) {
							params.assignee_ids = (additionalFields.assignee_ids as string)
								.split(',')
								.map((id) => parseInt(id.trim(), 10));
						}
						if (additionalFields.notes) {
							params.notes = additionalFields.notes;
						}

						responseData = await callBcgptTool.call(this, 'create_todo', params);
					} else if (operation === 'get') {
						const todoId = this.getNodeParameter('todoId', i) as string;
						responseData = await callBcgptTool.call(this, 'get_todo', {
							project_id: parseInt(projectId, 10),
							todo_id: parseInt(todoId, 10),
						});
					} else if (operation === 'update') {
						const todoId = this.getNodeParameter('todoId', i) as string;
						const content = this.getNodeParameter('content', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;

						const params: IDataObject = {
							project_id: parseInt(projectId, 10),
							todo_id: parseInt(todoId, 10),
							content,
						};

						if (additionalFields.due_on) {
							params.due_on = additionalFields.due_on;
						}
						if (additionalFields.assignee_ids) {
							params.assignee_ids = (additionalFields.assignee_ids as string)
								.split(',')
								.map((id) => parseInt(id.trim(), 10));
						}
						if (additionalFields.notes) {
							params.notes = additionalFields.notes;
						}

						responseData = await callBcgptTool.call(this, 'update_todo', params);
					} else if (operation === 'complete') {
						const todoId = this.getNodeParameter('todoId', i) as string;
						responseData = await callBcgptTool.call(this, 'complete_todo', {
							project_id: parseInt(projectId, 10),
							todo_id: parseInt(todoId, 10),
						});
					} else if (operation === 'uncomplete') {
						const todoId = this.getNodeParameter('todoId', i) as string;
						responseData = await callBcgptTool.call(this, 'uncomplete_todo', {
							project_id: parseInt(projectId, 10),
							todo_id: parseInt(todoId, 10),
						});
					} else if (operation === 'delete') {
						const todoId = this.getNodeParameter('todoId', i) as string;
						responseData = await callBcgptTool.call(this, 'trash_todo', {
							project_id: parseInt(projectId, 10),
							todo_id: parseInt(todoId, 10),
						});
					}
				} else if (resource === 'message') {
					// ========================================
					//             MESSAGE
					// ========================================
					const projectId = this.getNodeParameter('projectId', i) as string;

					if (operation === 'create') {
						const subject = this.getNodeParameter('subject', i) as string;
						const content = this.getNodeParameter('content', i, '') as string;
						responseData = await callBcgptTool.call(this, 'create_message', {
							project_id: parseInt(projectId, 10),
							subject,
							content,
						});
					} else if (operation === 'get') {
						const messageId = this.getNodeParameter('messageId', i) as string;
						responseData = await callBcgptTool.call(this, 'get_message', {
							project_id: parseInt(projectId, 10),
							message_id: parseInt(messageId, 10),
						});
					} else if (operation === 'update') {
						const messageId = this.getNodeParameter('messageId', i) as string;
						const subject = this.getNodeParameter('subject', i) as string;
						const content = this.getNodeParameter('content', i, '') as string;
						responseData = await callBcgptTool.call(this, 'update_message', {
							project_id: parseInt(projectId, 10),
							message_id: parseInt(messageId, 10),
							subject,
							content,
						});
					} else if (operation === 'delete') {
						const messageId = this.getNodeParameter('messageId', i) as string;
						responseData = await callBcgptTool.call(this, 'trash_message', {
							project_id: parseInt(projectId, 10),
							message_id: parseInt(messageId, 10),
						});
					}
				}

				if (Array.isArray(responseData)) {
					returnData.push(...responseData);
				} else {
					returnData.push(responseData);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ error: (error as Error).message });
					continue;
				}
				throw error;
			}
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}
