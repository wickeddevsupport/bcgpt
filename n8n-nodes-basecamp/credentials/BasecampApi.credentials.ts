import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class BasecampApi implements ICredentialType {
	name = 'basecampApi';
	displayName = 'Basecamp API (via BCGPT)';
	documentationUrl = 'https://bcgpt.wickedlab.io/docs';
	properties: INodeProperties[] = [
		{
			displayName: 'BCGPT Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://bcgpt.wickedlab.io',
			description: 'The URL of your BCGPT gateway instance',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description: 'Your BCGPT API key. Get it from bcgpt.wickedlab.io/connect',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-bcgpt-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/basecamp/tool',
			method: 'POST',
			body: {
				tool: 'list_projects',
				params: { archived: false },
			},
		},
	};
}
