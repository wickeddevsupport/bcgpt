import {
    PrincipalType,
    Template,
} from '@activepieces/shared'
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Static, Type } from '@sinclair/typebox'
import { StatusCodes } from 'http-status-codes'
import { flowGalleryService } from './flow-gallery.service'
import { RouteKind, securityAccess } from '@activepieces/server-shared'

/**
 * Flow Gallery Controller
 * 
 * Public API endpoints for:
 * - Browsing published workflow apps
 * - Viewing app details and documentation
 * - Executing workflows with user inputs
 * 
 * All endpoints are PUBLIC (no authentication required)
 * PRD Reference: Flow App Store - User Interface Layer
 */

// Request/Response Schema Definitions
const ListAppsQuery = Type.Object({
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number({ default: 20 })),
    search: Type.Optional(Type.String()),
    category: Type.Optional(Type.String()),
    featured: Type.Optional(Type.Boolean()),
})

const ExecuteFlowRequest = Type.Object({
    inputs: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
})

const ListPublisherAppsQuery = Type.Object({
    search: Type.Optional(Type.String()),
})

const ListPublisherTemplatesQuery = Type.Object({
    search: Type.Optional(Type.String()),
})

const PublisherAppPayload = Type.Object({
    templateId: Type.String(),
    flowId: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    icon: Type.Optional(Type.String()),
    category: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
    featured: Type.Optional(Type.Boolean()),
    displayOrder: Type.Optional(Type.Number()),
    inputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    outputType: Type.Optional(Type.String()),
    outputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

const UpdatePublisherAppPayload = Type.Object({
    flowId: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    icon: Type.Optional(Type.String()),
    category: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
    featured: Type.Optional(Type.Boolean()),
    displayOrder: Type.Optional(Type.Number()),
    inputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    outputType: Type.Optional(Type.String()),
    outputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

const PublisherTemplateParams = Type.Object({
    templateId: Type.String(),
})

/* HTML Template Components */

const galleryPageHtml = (apps: Template[], platformUrl: string): string => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flow Gallery - Workflow Apps</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 40px 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            color: white;
            margin-bottom: 50px;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            font-weight: 700;
        }
        
        .header p {
            font-size: 1.1em;
            opacity: 0.9;
        }
        
        .search-bar {
            max-width: 500px;
            margin: 0 auto 40px;
        }
        
        .search-bar input {
            width: 100%;
            padding: 12px 20px;
            border: none;
            border-radius: 50px;
            font-size: 1em;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        }
        
        .apps-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 30px;
            margin-bottom: 40px;
        }
        
        .app-card {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            cursor: pointer;
        }
        
        .app-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
        }
        
        .app-card-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            color: white;
        }
        
        .app-card-title {
            font-size: 1.3em;
            font-weight: 600;
            margin-bottom: 5px;
        }
        
        .app-card-summary {
            font-size: 0.9em;
            opacity: 0.9;
        }
        
        .app-card-body {
            padding: 20px;
        }
        
        .app-card-description {
            font-size: 0.95em;
            color: #555;
            margin-bottom: 15px;
            line-height: 1.5;
        }
        
        .app-card-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-bottom: 15px;
        }
        
        .tag {
            background: #f0f0f0;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 0.8em;
            color: #667eea;
            font-weight: 500;
        }
        
        .app-card-footer {
            display: flex;
            gap: 10px;
            padding-top: 15px;
            border-top: 1px solid #f0f0f0;
        }
        
        .btn {
            flex: 1;
            padding: 10px 15px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .btn-primary:hover {
            transform: scale(1.02);
        }
        
        .btn-secondary {
            background: #f0f0f0;
            color: #667eea;
        }
        
        .no-apps {
            text-align: center;
            color: white;
            padding: 40px 20px;
            font-size: 1.1em;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Workflow Apps</h1>
            <p>Discover and run powerful automated workflows</p>
        </div>
        
        <div class="search-bar">
            <input 
                type="text" 
                id="searchInput" 
                placeholder="Search apps by name or description..."
                onkeyup="filterApps(this.value)"
            >
        </div>
        
        <div class="apps-grid" id="appsGrid">
            ${apps.length === 0 ? '<div class="no-apps">No apps available yet. Check back soon!</div>' : apps.map(app => `
            <div class="app-card" data-search-text="${(app.name + ' ' + app.summary + ' ' + app.description).toLowerCase()}">
                <div class="app-card-header">
                    <div class="app-card-title">${escapeHtml(app.name)}</div>
                    <div class="app-card-summary">${escapeHtml(app.summary || '')}</div>
                </div>
                <div class="app-card-body">
                    <div class="app-card-description">${escapeHtml(app.description || '')}</div>
                    ${app.tags && app.tags.length > 0 ? `
                    <div class="app-card-tags">
                        ${app.tags.map((tag: any) => `<span class="tag">${escapeHtml(tag.title || tag)}</span>`).join('')}
                    </div>
                    ` : ''}
                    <div class="app-card-footer">
                        <button class="btn btn-primary" onclick="window.location.href = '/apps/${escapeHtml(app.id)}'">
                            Open App
                        </button>
                    </div>
                </div>
            </div>
            `).join('')}
        </div>
    </div>
    
    <script>
        function filterApps(searchTerm) {
            const cards = document.querySelectorAll('.app-card');
            const term = searchTerm.toLowerCase();
            
            cards.forEach(card => {
                const searchText = card.getAttribute('data-search-text');
                if (searchText.includes(term)) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                }
            });
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>
`

const appRuntimeHtml = (app: Template & { galleryMetadata?: unknown }, platformUrl: string): string => {
    const galleryMetadata = (app.galleryMetadata && typeof app.galleryMetadata === 'object'
        ? app.galleryMetadata as Record<string, unknown>
        : {}) as Record<string, unknown>
    const inputSchema = (galleryMetadata.inputSchema as Record<string, unknown> | undefined) ?? {}
    const serializedInputSchema = JSON.stringify(inputSchema)
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(app.name)} - Workflow App</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 40px 20px;
        }
        
        .container {
            max-width: 600px;
            margin: 0 auto;
        }
        
        .header {
            background: white;
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        }
        
        .header h1 {
            font-size: 1.8em;
            color: #333;
            margin-bottom: 10px;
        }
        
        .header p {
            color: #666;
            font-size: 0.95em;
            line-height: 1.6;
        }
        
        .form-container {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            margin-bottom: 30px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        
        .form-group input,
        .form-group textarea {
            width: 100%;
            padding: 10px 12px;
            border: 2px solid #e0e0e0;
            border-radius: 6px;
            font-size: 0.95em;
            font-family: inherit;
            transition: border-color 0.3s ease;
        }
        
        .form-group input:focus,
        .form-group textarea:focus {
            outline: none;
            border-color: #667eea;
        }
        
        .form-group textarea {
            min-height: 100px;
            resize: vertical;
        }
        
        .btn-execute {
            width: 100%;
            padding: 12px 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 1em;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .btn-execute:hover {
            transform: scale(1.02);
        }
        
        .btn-execute:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: scale(1);
        }
        
        .result-container {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            display: none;
        }
        
        .result-container.show {
            display: block;
        }
        
        .result-header {
            font-size: 1.2em;
            font-weight: 600;
            margin-bottom: 20px;
            color: #333;
        }
        
        .result-content {
            background: #f5f5f5;
            padding: 20px;
            border-radius: 6px;
            word-break: break-all;
            white-space: pre-wrap;
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 0.9em;
        }
        
        .loading {
            text-align: center;
            color: white;
            font-size: 1.1em;
        }
        
        .error {
            background: #fee;
            border: 1px solid #fcc;
            color: #c33;
            padding: 15px;
            border-radius: 6px;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${escapeHtml(app.name)}</h1>
            <p>${escapeHtml(app.description || app.summary || '')}</p>
        </div>
        
        <form id="flowForm" class="form-container" onsubmit="executeFlow(event)">
            <div id="dynamicFields"></div>
            <button type="submit" class="btn-execute" id="executeBtn">Execute</button>
        </form>
        
        <div class="result-container" id="resultContainer">
            <div class="result-header">Output</div>
            <div class="result-content" id="resultContent"></div>
        </div>
    </div>
    
    <script>
        const inputSchema = ${serializedInputSchema};

        function normalizeFields(schema) {
            if (!schema || typeof schema !== 'object') return [];
            if (Array.isArray(schema.fields)) return schema.fields;
            return Object.entries(schema).map(([name, config]) => {
                if (typeof config === 'string') {
                    return { name, type: config, label: name };
                }
                if (config && typeof config === 'object') {
                    return { name, label: name, ...config };
                }
                return { name, type: 'text', label: name };
            });
        }

        function renderDynamicFields() {
            const container = document.getElementById('dynamicFields');
            const fields = normalizeFields(inputSchema);

            if (!fields.length) {
                container.innerHTML = \`
                    <div class="form-group">
                        <label for="input">Input</label>
                        <textarea id="input" name="input" placeholder="Enter app input"></textarea>
                    </div>
                \`;
                return;
            }

            container.innerHTML = fields.map((field) => {
                const label = escapeHtml(field.label || field.name || 'Input');
                const name = escapeHtml(field.name || 'input');
                const type = (field.type || 'text').toLowerCase();
                const required = field.required ? 'required' : '';
                const placeholder = escapeHtml(field.placeholder || '');

                if (type === 'textarea' || type === 'multiline') {
                    return \`
                        <div class="form-group">
                            <label for="\${name}">\${label}</label>
                            <textarea id="\${name}" name="\${name}" placeholder="\${placeholder}" \${required}></textarea>
                        </div>
                    \`;
                }

                if (type === 'number') {
                    return \`
                        <div class="form-group">
                            <label for="\${name}">\${label}</label>
                            <input id="\${name}" name="\${name}" type="number" placeholder="\${placeholder}" \${required} />
                        </div>
                    \`;
                }

                return \`
                    <div class="form-group">
                        <label for="\${name}">\${label}</label>
                        <input id="\${name}" name="\${name}" type="text" placeholder="\${placeholder}" \${required} />
                    </div>
                \`;
            }).join('');
        }

        async function executeFlow(e) {
            e.preventDefault();
            
            const btn = document.getElementById('executeBtn');
            const resultContainer = document.getElementById('resultContainer');
            const resultContent = document.getElementById('resultContent');
            
            btn.disabled = true;
            btn.textContent = 'Executing...';
            resultContainer.classList.remove('show');
            
            try {
                const formData = new FormData(document.getElementById('flowForm'));
                const inputs = Object.fromEntries(formData);
                
                const response = await fetch('/apps/api/${escapeHtml(app.id)}/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ inputs }),
                });
                
                const data = await response.json();
                
                if (!response.ok) {
                    resultContent.innerHTML = \`<div class="error">Error: \${data.error || 'Execution failed'}</div>\`;
                } else {
                    resultContent.textContent = JSON.stringify(data.output, null, 2);
                }
                
                resultContainer.classList.add('show');
            } catch (error) {
                resultContent.innerHTML = \`<div class="error">Error: \${error.message}</div>\`;
                resultContainer.classList.add('show');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Execute';
            }
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        renderDynamicFields();
    </script>
</body>
</html>
`
}

const publisherPageHtml = (): string => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Apps Publisher</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; background: #f7f7fb; color: #111; }
        h1 { margin: 0 0 8px 0; }
        p { margin: 0 0 20px 0; color: #555; }
        .card { background: #fff; border: 1px solid #e7e7ef; border-radius: 12px; padding: 16px; margin-bottom: 14px; }
        .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        input, textarea { width: 100%; border: 1px solid #d6d6e3; border-radius: 8px; padding: 8px 10px; }
        textarea { min-height: 70px; }
        .btn { border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer; font-weight: 600; }
        .btn-primary { background: #2b6af3; color: white; }
        .btn-danger { background: #e5484d; color: white; }
        .meta { font-size: 12px; color: #666; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <h1>Apps Publisher</h1>
    <p>Publish your templates as apps for <code>/apps</code>.</p>
    <div class="grid">
        <section>
            <h2>Templates</h2>
            <div id="templates"></div>
        </section>
        <section>
            <h2>Published Apps</h2>
            <div id="published"></div>
        </section>
    </div>

    <script>
        function getStoredToken() {
            return window.localStorage.getItem('token') || window.sessionStorage.getItem('token');
        }

        function buildAuthHeaders(existingHeaders = {}) {
            const token = getStoredToken();
            if (!token) return existingHeaders;
            return { ...existingHeaders, Authorization: 'Bearer ' + token };
        }

        async function fetchJson(url, options = {}) {
            const headers = buildAuthHeaders(options.headers || {});
            const res = await fetch(url, { credentials: 'include', ...options, headers });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || ('Request failed: ' + res.status));
            return body;
        }

        async function loadTemplates() {
            const data = await fetchJson('/apps/api/publisher/templates');
            const root = document.getElementById('templates');
            const templates = data.data || [];
            if (!templates.length) {
                root.innerHTML = '<div class="card">No templates found.</div>';
                return;
            }
            root.innerHTML = templates.map((t) => \`
                <div class="card">
                    <div class="row"><strong>\${t.name}</strong></div>
                    <div class="meta">\${t.summary || ''}</div>
                    <div class="row" style="margin-top:10px">
                        <button class="btn btn-primary" onclick="publishTemplate('\${t.id}')">Publish as App</button>
                    </div>
                </div>
            \`).join('');
        }

        async function loadPublished() {
            const data = await fetchJson('/apps/api/publisher/apps');
            const root = document.getElementById('published');
            const apps = data.data || [];
            if (!apps.length) {
                root.innerHTML = '<div class="card">No published apps yet.</div>';
                return;
            }
            root.innerHTML = apps.map((a) => \`
                <div class="card">
                    <div class="row"><strong>\${a.name}</strong></div>
                    <div class="meta">templateId: \${a.id}</div>
                    <div class="row" style="margin-top:10px">
                        <a class="btn" href="/apps/\${a.id}" target="_blank" rel="noreferrer">Open</a>
                        <button class="btn btn-danger" onclick="unpublishTemplate('\${a.id}')">Unpublish</button>
                    </div>
                </div>
            \`).join('');
        }

        async function publishTemplate(templateId) {
            await fetchJson('/apps/api/publisher/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateId }),
            });
            await loadPublished();
            alert('Published');
        }

        async function unpublishTemplate(templateId) {
            await fetchJson('/apps/api/publisher/apps/' + templateId, { method: 'DELETE' });
            await loadPublished();
            alert('Unpublished');
        }

        (async () => {
            try {
                const token = getStoredToken();
                if (!token) {
                    window.location.href = '/sign-in?redirectAfterLogin=' + encodeURIComponent('/apps/publisher');
                    return;
                }
                await Promise.all([loadTemplates(), loadPublished()]);
            } catch (e) {
                document.body.insertAdjacentHTML('beforeend', '<pre style="color:#e5484d">' + e.message + '</pre>');
            }
        })();
    </script>
</body>
</html>
`

function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    }
    return text.replace(/[&<>"']/g, (m) => map[m])
}

/**
 * Flow Gallery Controller
 * Registers public routes for gallery and app execution
 */
export const flowGalleryController: FastifyPluginAsyncTypebox = async (fastify) => {
    const service = flowGalleryService(fastify.log)

    // PUBLIC: Gallery home page
    fastify.get('/', {
        config: {
            security: {
                kind: RouteKind.PUBLIC,
            },
        },
    }, async (request, reply) => {
        try {
            const apps = await service.listPublicApps({
                cursor: null,
                limit: 100,
                platformId: null,
            })

            const html = galleryPageHtml(apps.data, request.hostname)
            return reply.type('text/html').send(html)
        } catch (error) {
            fastify.log.error(error)
            return reply.code(500).send({ error: 'Failed to load gallery' })
        }
    })

    // PUBLIC: JSON API - List apps
    fastify.get('/api/apps', {
        config: {
            security: {
                kind: RouteKind.PUBLIC,
            },
        },
    }, async (request, reply) => {
        const query = request.query as Static<typeof ListAppsQuery>
        try {
            const apps = await service.listPublicApps({
                cursor: query.cursor || null,
                limit: query.limit || 20,
                search: query.search,
                category: query.category,
                featured: query.featured,
                platformId: null,
            })
            return reply.send(apps)
        } catch (error) {
            fastify.log.error(error)
            return reply.code(500).send({ error: 'Failed to list apps' })
        }
    })

    // PUBLIC: Publisher page shell (API calls are authenticated via bearer token)
    fastify.get('/publisher', {
        config: {
            security: {
                kind: RouteKind.PUBLIC,
            },
        },
    }, async (_, reply) => {
        return reply.type('text/html').send(publisherPageHtml())
    })

    // AUTHENTICATED: Publisher - List my published apps
    fastify.get('/api/publisher/apps', {
        config: {
            security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
        },
        schema: {
            querystring: ListPublisherAppsQuery,
        },
    }, async (request, reply) => {
        const query = request.query as Static<typeof ListPublisherAppsQuery>
        try {
            const apps = await service.listPublisherApps({
                platformId: request.principal.platform.id,
                search: query.search,
            })
            return reply.send({ data: apps })
        } catch (error) {
            fastify.log.error(error)
            return reply.code(500).send({ error: 'Failed to list published apps' })
        }
    })

    // AUTHENTICATED: Publisher - List eligible templates for publish
    fastify.get('/api/publisher/templates', {
        config: {
            security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
        },
        schema: {
            querystring: ListPublisherTemplatesQuery,
        },
    }, async (request, reply) => {
        const query = request.query as Static<typeof ListPublisherTemplatesQuery>
        try {
            const templates = await service.listPublisherTemplates({
                platformId: request.principal.platform.id,
                search: query.search,
            })
            return reply.send({ data: templates })
        } catch (error) {
            fastify.log.error(error)
            return reply.code(500).send({ error: 'Failed to list templates' })
        }
    })

    // AUTHENTICATED: Publisher - Publish template as app
    fastify.post('/api/publisher/publish', {
        config: {
            security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
        },
        schema: {
            body: PublisherAppPayload,
        },
    }, async (request, reply) => {
        const body = request.body as Static<typeof PublisherAppPayload>
        try {
            const app = await service.publishTemplateAsApp({
                ...body,
                platformId: request.principal.platform.id,
                publishedBy: request.principal.id,
            })
            return reply.code(StatusCodes.CREATED).send(app)
        } catch (error: any) {
            fastify.log.error(error)
            return reply.code(StatusCodes.BAD_REQUEST).send({
                error: error?.message ?? 'Failed to publish app',
            })
        }
    })

    // AUTHENTICATED: Publisher - Update published app metadata
    fastify.put('/api/publisher/apps/:templateId', {
        config: {
            security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
        },
        schema: {
            params: PublisherTemplateParams,
            body: UpdatePublisherAppPayload,
        },
    }, async (request, reply) => {
        const params = request.params as Static<typeof PublisherTemplateParams>
        const body = request.body as Static<typeof UpdatePublisherAppPayload>
        try {
            const app = await service.updatePublishedApp({
                ...body,
                templateId: params.templateId,
                platformId: request.principal.platform.id,
            })
            return reply.send(app)
        } catch (error: any) {
            fastify.log.error(error)
            return reply.code(StatusCodes.BAD_REQUEST).send({
                error: error?.message ?? 'Failed to update app metadata',
            })
        }
    })

    // AUTHENTICATED: Publisher - Unpublish app
    fastify.delete('/api/publisher/apps/:templateId', {
        config: {
            security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
        },
        schema: {
            params: PublisherTemplateParams,
        },
    }, async (request, reply) => {
        const params = request.params as Static<typeof PublisherTemplateParams>
        try {
            await service.unpublishTemplateApp({
                templateId: params.templateId,
                platformId: request.principal.platform.id,
            })
            return reply.code(StatusCodes.NO_CONTENT).send()
        } catch (error: any) {
            fastify.log.error(error)
            return reply.code(StatusCodes.BAD_REQUEST).send({
                error: error?.message ?? 'Failed to unpublish app',
            })
        }
    })

    // PUBLIC: App runtime page
    fastify.get('/:id', {
        config: {
            security: {
                kind: RouteKind.PUBLIC,
            },
        },
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        try {
            const app = await service.getPublicApp({
                id,
                platformId: null,
            })

            if (!app) {
                return reply.code(404).send({ error: 'App not found' })
            }

            const html = appRuntimeHtml(app, request.hostname)
            return reply.type('text/html').send(html)
        } catch (error) {
            fastify.log.error(error)
            return reply.code(500).send({ error: 'Failed to load app' })
        }
    })

    // PUBLIC: Execute workflow
    fastify.post('/:id/execute', {
        config: {
            security: {
                kind: RouteKind.PUBLIC,
            },
        },
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const body = request.body as Static<typeof ExecuteFlowRequest>

        const startTime = Date.now()

        try {
            const app = await service.getPublicApp({
                id,
                platformId: null,
            })

            if (!app) {
                return reply.code(404).send({ error: 'App not found' })
            }

            const flowResponse = await service.executePublicApp({
                appId: id,
                inputs: body.inputs,
            })

            const output = flowResponse.body

            const executionTime = Date.now() - startTime
            await service.logExecution({
                templateId: id,
                executionStatus: flowResponse.status >= 200 && flowResponse.status < 300 ? 'success' : 'failed',
                executionTimeMs: executionTime,
                outputs: output,
            })

            return reply.status(flowResponse.status).send({ output, executionTime })
        } catch (error: any) {
            fastify.log.error(error)

            const executionTime = Date.now() - startTime
            await service.logExecution({
                templateId: id,
                executionStatus: 'failed',
                executionTimeMs: executionTime,
                error: error.message,
            })

            return reply.code(500).send({ error: error.message || 'Execution failed' })
        }
    })
}
