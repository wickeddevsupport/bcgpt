import {
    isNil,
    Principal,
    PrincipalType,
    SeekPage,
    Template,
} from '@activepieces/shared'
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Static, Type } from '@sinclair/typebox'
import { StatusCodes } from 'http-status-codes'
import { flowGalleryService } from './flow-gallery.service'
import { RouteKind } from '@activepieces/server-shared'

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
            <h1>⚡ Workflow Apps</h1>
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

const appRuntimeHtml = (app: Template, platformUrl: string): string => `
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
            <!-- Form fields will be generated here -->
            <button type="submit" class="btn-execute" id="executeBtn">Execute</button>
        </form>
        
        <div class="result-container" id="resultContainer">
            <div class="result-header">Output</div>
            <div class="result-content" id="resultContent"></div>
        </div>
    </div>
    
    <script>
        // Form execution logic will be injected here
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

            // TODO: Integrate with Activepieces webhook execution
            // For now, return mock response
            let output = {
                status: 'executed',
                inputs: body.inputs,
                message: 'Workflow execution in progress',
            }

            const executionTime = Date.now() - startTime
            await service.logExecution({
                templateId: id,
                executionStatus: 'success',
                executionTimeMs: executionTime,
                outputs: output,
            })

            return reply.send({ output, executionTime })
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
