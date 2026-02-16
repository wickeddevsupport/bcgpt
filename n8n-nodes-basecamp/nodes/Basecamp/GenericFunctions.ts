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

/**
 * Make an API request to BCGPT Gateway
 */
export async function bcgptApiRequest(
	this: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions,
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
	this: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions,
	tool: string,
	params: IDataObject = {},
): Promise<any> {
	const body = {
		tool,
		params,
	};

	const response = await bcgptApiRequest.call(this, 'POST', '/api/basecamp/tool', body);

	// BCGPT returns { success: true, data: ... } or { success: false, error: ... }
	if (!response.success) {
		throw new Error(response.error || 'BCGPT tool call failed');
	}

	return response.data;
}

/**
 * Get all projects for dropdowns
 */
export async function getProjects(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const projects = await callBcgptTool.call(this, 'list_projects', { archived: false });

	return projects.map((project: any) => ({
		name: project.name,
		value: project.id.toString(),
	}));
}

/**
 * Get all todolists for a project
 */
export async function getTodolists(
	this: ILoadOptionsFunctions,
	projectId: string,
): Promise<INodePropertyOptions[]> {
	const todolists = await callBcgptTool.call(this, 'list_todolists', {
		project_id: parseInt(projectId, 10),
	});

	return todolists.map((list: any) => ({
		name: list.title || list.name,
		value: list.id.toString(),
	}));
}
