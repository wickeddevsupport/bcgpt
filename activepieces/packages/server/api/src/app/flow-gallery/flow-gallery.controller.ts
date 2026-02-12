import {
    PlatformRole,
    PrincipalType,
    Template,
} from '@activepieces/shared'
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { RateLimitOptions } from '@fastify/rate-limit'
import { Static, Type } from '@sinclair/typebox'
import { StatusCodes } from 'http-status-codes'
import { flowGalleryService } from './flow-gallery.service'
import { RouteKind, securityAccess } from '@activepieces/server-shared'
import { userService } from '../user/user-service'

const ListAppsQuery = Type.Object({
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number({ default: 20 })),
    search: Type.Optional(Type.String()),
    category: Type.Optional(Type.String()),
    featured: Type.Optional(Type.Boolean()),
})

const AppIdParams = Type.Object({
    id: Type.String(),
})

const ExecuteFlowRequest = Type.Object({
    inputs: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
})

const ExecuteFlowQuery = Type.Object({
    mode: Type.Optional(Type.Union([Type.Literal('sync'), Type.Literal('async')])),
})

const AppRunsQuery = Type.Object({
    limit: Type.Optional(Type.Number({ default: 10 })),
})

const ListPublisherAppsQuery = Type.Object({
    search: Type.Optional(Type.String()),
})

const ListPublisherTemplatesQuery = Type.Object({
    search: Type.Optional(Type.String()),
})

const InputFieldOptionSchema = Type.Object({
    label: Type.String({ minLength: 1, maxLength: 100 }),
    value: Type.String({ minLength: 1, maxLength: 100 }),
})

const InputFieldSchema = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    type: Type.Optional(
        Type.Union([
            Type.Literal('text'),
            Type.Literal('textarea'),
            Type.Literal('number'),
            Type.Literal('select'),
            Type.Literal('boolean'),
            Type.Literal('password'),
        ]),
    ),
    required: Type.Optional(Type.Boolean()),
    placeholder: Type.Optional(Type.String({ maxLength: 200 })),
    options: Type.Optional(Type.Array(InputFieldOptionSchema, { maxItems: 50 })),
})

const FlexibleInputSchema = Type.Union([
    Type.Object({
        fields: Type.Array(InputFieldSchema, { maxItems: 30 }),
    }),
    Type.Record(Type.String(), Type.Unknown()),
])

const PublisherAppPayload = Type.Object({
    templateId: Type.String(),
    flowId: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    icon: Type.Optional(Type.String()),
    category: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
    featured: Type.Optional(Type.Boolean()),
    displayOrder: Type.Optional(Type.Number()),
    inputSchema: Type.Optional(FlexibleInputSchema),
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
    inputSchema: Type.Optional(FlexibleInputSchema),
    outputType: Type.Optional(Type.String()),
    outputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

const PublisherTemplateParams = Type.Object({
    templateId: Type.String(),
})

const SeedDefaultsBody = Type.Object({
    confirm: Type.String(),
    reset: Type.Optional(Type.Boolean()),
})

const executeRateLimit: RateLimitOptions = {
    max: 60,
    timeWindow: '1 minute',
}

type AppInputField = {
    name: string
    label: string
    type: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'password'
    required: boolean
    options?: Array<{ label: string, value: string }>
}

function extractAppInputFields(schema: unknown): AppInputField[] {
    if (!schema || typeof schema !== 'object') {
        return []
    }
    const root = schema as { fields?: unknown }
    if (!Array.isArray(root.fields)) {
        return []
    }
    return root.fields
        .map((raw) => {
            if (!raw || typeof raw !== 'object') return null
            const field = raw as Record<string, unknown>
            const name = typeof field.name === 'string' ? field.name.trim() : ''
            if (!name.length) return null
            const type = typeof field.type === 'string' ? field.type : 'text'
            const label = typeof field.label === 'string' && field.label.trim().length > 0 ? field.label : name
            const options = Array.isArray(field.options)
                ? field.options
                    .map((option) => {
                        if (!option || typeof option !== 'object') return null
                        const o = option as Record<string, unknown>
                        const value = typeof o.value === 'string' ? o.value : ''
                        const optLabel = typeof o.label === 'string' ? o.label : value
                        if (!value.length) return null
                        return { label: optLabel, value }
                    })
                    .filter((option): option is { label: string, value: string } => !!option)
                : undefined
            return {
                name,
                label,
                type: (['text', 'textarea', 'number', 'select', 'boolean', 'password'].includes(type) ? type : 'text') as AppInputField['type'],
                required: Boolean(field.required),
                ...(options && options.length ? { options } : {}),
            }
        })
        .filter((field): field is AppInputField => !!field)
}

function validateAppInputs(fields: AppInputField[], inputs: Record<string, unknown>): string[] {
    const errors: string[] = []
    const available = new Map(fields.map((field) => [field.name, field]))

    for (const field of fields) {
        const value = inputs[field.name]
        const missing = value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)
        if (field.required && missing) {
            errors.push(`"${field.label}" is required.`)
            continue
        }
        if (missing) {
            continue
        }
        if (field.type === 'number' && typeof value !== 'number') {
            errors.push(`"${field.label}" must be a number.`)
        }
        if (field.type === 'boolean' && typeof value !== 'boolean') {
            errors.push(`"${field.label}" must be true or false.`)
        }
        if (field.type === 'select' && field.options?.length) {
            const allowed = new Set(field.options.map((option) => option.value))
            if (typeof value !== 'string' || !allowed.has(value)) {
                errors.push(`"${field.label}" has an invalid option.`)
            }
        }
    }

    for (const inputKey of Object.keys(inputs)) {
        if (!available.has(inputKey)) {
            errors.push(`"${inputKey}" is not a supported input for this app.`)
        }
    }

    return errors.slice(0, 6)
}

function sanitizePublicError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? 'Execution failed')
    return message
        .replace(/(api[_-]?key|token|authorization|password)\s*[:=]\s*['"]?([^\s,'"]+)/gi, '$1=[REDACTED]')
        .replace(/([A-Za-z0-9_\-]{24,})/g, (match) => {
            if (match.startsWith('flow_') || match.startsWith('tmpl_') || match.startsWith('req_')) {
                return match
            }
            return '[REDACTED]'
        })
        .slice(0, 1000)
}

function serializeForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
}

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

function pageShell(title: string, body: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root{--bg:#f6f7f9;--card:#ffffff;--border:#e5e7eb;--text:#0f172a;--muted:#64748b;--accent:#FF415B;--accent-soft:#ffe4e9}
    *{box-sizing:border-box}
    body{margin:0;font-family:Inter,system-ui;background:var(--bg);color:var(--text)}
    .container{width:min(1240px,95vw);margin:24px auto}
    .brand{display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border:1px solid var(--border);border-radius:999px;background:#fff;color:#334155;font-size:12px;font-weight:600}
    .brand .dot{width:8px;height:8px;border-radius:50%;background:var(--accent)}
    .top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}
    .title h1{margin:0;font-size:30px}.title p{margin:6px 0 0;color:var(--muted)}
    .btn{border:1px solid var(--border);background:#fff;border-radius:10px;padding:9px 12px;font-weight:600;cursor:pointer;color:#111827;text-decoration:none}
    .btn.primary{background:var(--accent);color:#fff;border:1px solid var(--accent)}
    .btn.primary:hover{filter:brightness(0.97)}
    .input,.select,textarea{width:100%;border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:#fff}
    .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
    .featured-strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:12px}
    .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px}
    .muted{color:var(--muted);font-size:13px}.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:var(--accent-soft);border:1px solid #ffc7d0;color:#b4233b;border-radius:999px;padding:3px 8px;font-size:12px}
    .creator{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border:1px solid var(--border);border-radius:999px;background:#fff;font-size:11px;color:#475569}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.grid2{display:grid;grid-template-columns:1.1fr 1fr;gap:12px}
    .panel{background:#fff;border:1px solid var(--border);border-radius:14px;padding:14px}
    .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
    .stat{border:1px solid var(--border);background:#fafafa;border-radius:10px;padding:8px;text-align:center}.stat b{display:block}
    .state{display:grid;gap:8px;place-items:start;background:#fff;border:1px dashed var(--border);border-radius:14px;padding:16px}
    .state h3{margin:0;font-size:18px}
    .state .actions{display:flex;gap:8px;flex-wrap:wrap}
    .skeleton{display:inline-block;height:12px;border-radius:999px;background:linear-gradient(90deg,#eef2ff 25%,#f8fafc 37%,#eef2ff 63%);background-size:400% 100%;animation:sh 1.2s ease-in-out infinite}
    @keyframes sh{0%{background-position:100% 0}100%{background-position:0 0}}
    .hidden{display:none !important}.danger{color:#dc2626}.success{color:#16a34a}
    .field-row{display:grid;grid-template-columns:1fr 1fr 120px 90px auto;gap:8px;align-items:center}
    .code{background:#0f172a;color:#dbeafe;border:1px solid #1e293b;border-radius:10px;padding:12px;overflow:auto;font-family:ui-monospace;font-size:12px}
    @media(max-width:980px){
      .container{width:min(100%,95vw);margin:14px auto}
      .top{flex-direction:column;align-items:stretch}
      .top .row{width:100%}
      .top .row .btn{flex:1 1 160px;text-align:center}
      .grid2{grid-template-columns:1fr}
      .field-row{grid-template-columns:1fr}
      .stats{grid-template-columns:1fr 1fr}
    }
    @media(max-width:640px){
      .title h1{font-size:24px}
      .cards,.featured-strip{grid-template-columns:1fr}
      .stats{grid-template-columns:1fr}
    }
  </style>
</head>
<body>${body}</body>
</html>`
}

function galleryPageHtml(apps: Template[]): string {
    return pageShell('Apps - Wicked Flow', `
      <div class="container">
        <div class="brand"><span class="dot"></span> Wicked Flow Apps</div>
        <section class="panel" style="margin:12px 0 14px;background:linear-gradient(135deg,#fff1f3 0%,#ffffff 55%,#fff5f6 100%);border-color:#ffd4dc">
          <div class="grid2" style="align-items:center">
            <div>
              <h2 style="margin:0 0 8px;font-size:28px;line-height:1.1">Workflow apps your team can run without building flows</h2>
              <p class="muted" style="margin:0 0 12px;font-size:14px">Discover ready-to-run apps for design, marketing, sales, and delivery. Powered by your existing Activepieces workflows.</p>
              <div class="row">
                <a class="btn primary" href="/sign-up?redirectAfterLogin=%2Fapps">Start free</a>
                <a class="btn" href="/templates">Browse templates</a>
              </div>
            </div>
            <div style="display:grid;gap:8px">
              <div class="row" style="justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:8px;background:#fff"><span class="muted">No-code execution</span><b>For non-technical users</b></div>
              <div class="row" style="justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:8px;background:#fff"><span class="muted">Integrated stack</span><b>Basecamp + Agency workflows</b></div>
              <div class="row" style="justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:8px;background:#fff"><span class="muted">Team-ready output</span><b>Shareable, repeatable runs</b></div>
            </div>
          </div>
        </section>
        <div class="top">
          <div class="title"><h1>Apps</h1><p>Run workflow-powered apps without editing flows.</p></div>
          <div class="row" id="topActions"></div>
        </div>
        <div class="row" style="margin-bottom:12px">
          <input id="search" class="input" placeholder="Search apps" />
          <select id="category" class="select"><option value="">All categories</option></select>
          <select id="sort" class="select"><option value="featured">Featured</option><option value="runs">Most runs</option><option value="recent">Recent</option><option value="name">Name A-Z</option></select>
        </div>
        <div id="featuredWrap" class="hidden">
          <h3 style="margin:0 0 8px">Featured apps</h3>
          <div id="featuredStrip" class="featured-strip"></div>
        </div>
        <div id="galleryState" class="state">
          <h3>Loading apps...</h3>
          <div class="muted"><span class="skeleton" style="width:220px"></span></div>
        </div>
        <div id="cards" class="cards hidden"></div>
      </div>
      <script id="apps-data" type="application/json">${serializeForScript(apps)}</script>
      <script>
        let apps = [];
        let parseError = '';
        try {
          const parsed = JSON.parse(document.getElementById('apps-data').textContent || '[]');
          if (Array.isArray(parsed)) apps = parsed;
          else parseError = 'App data format is invalid.';
        } catch (e) {
          parseError = 'App data could not be loaded.';
        }
        const state = { search:'', category:'', sort:'featured' };
        const galleryState = document.getElementById('galleryState');
        const cardsRoot = document.getElementById('cards');
        const topActions = document.getElementById('topActions');
        const meta = (a)=>{const m=a.galleryMetadata||{};return {category:m.category||'GENERAL',tags:Array.isArray(m.tags)?m.tags:[],featured:!!m.featured,runCount:Number(m.runCount||0),successCount:Number(m.successCount||0),failedCount:Number(m.failedCount||0),avg:m.averageExecutionMs==null?'-':Math.round(Number(m.averageExecutionMs)),updated:m.updated||a.updated,icon:m.icon||'',author:a.author||'Wicked Flow'};};
        const esc=(t)=>{const d=document.createElement('div');d.textContent=String(t||'');return d.innerHTML;};
        const action=(href,label,primary=false)=>'<a class="btn'+(primary?' primary':'')+'" href="'+href+'">'+label+'</a>';
        async function detectSession(){
          const candidateTokens = [
            null,
            window.localStorage.getItem('token') || null,
            window.sessionStorage.getItem('token') || null,
          ].filter((value, index, arr) => arr.indexOf(value) === index);
          for (const tokenValue of candidateTokens) {
            try {
              const headers = {};
              if (tokenValue) {
                headers.Authorization = 'Bearer ' + tokenValue;
              }
              const response = await fetch('/apps/api/session', {
                credentials: 'same-origin',
                headers,
              });
              if (response.ok) {
                const payload = await response.json();
                return { authenticated: true, ...payload };
              }
            } catch (e) {}
          }
          return { authenticated: false };
        }
        function renderTopActions(session){
          if(!topActions)return;
          if(session && session.authenticated){
            topActions.innerHTML = [
              action('/','Dashboard'),
              action('/templates','Templates'),
              action('/apps/publisher','Publisher'),
            ].join('');
            return;
          }
          topActions.innerHTML = [
            action('/templates','Templates'),
            action('/apps/publisher','Become a publisher'),
            action('/sign-in?redirectAfterLogin='+encodeURIComponent('/apps'),'Sign in'),
            action('/sign-up?redirectAfterLogin='+encodeURIComponent('/apps'),'Start free',true),
          ].join('');
        }
        function setGalleryState(kind,title,desc,actionLabel,actionHandler){
          galleryState.classList.remove('hidden');
          cardsRoot.classList.add('hidden');
          const variant = kind === 'error' ? 'danger' : 'muted';
          galleryState.innerHTML = '<h3>'+esc(title)+'</h3><div class="'+variant+'">'+esc(desc||'')+'</div>' + (actionLabel ? '<div class="actions"><button id="galleryStateAction" class="btn'+(kind==='error'?' primary':'')+'">'+esc(actionLabel)+'</button></div>' : '');
          const btn = document.getElementById('galleryStateAction');
          if (btn && typeof actionHandler === 'function') btn.addEventListener('click', actionHandler);
        }
        function clearGalleryState(){
          galleryState.classList.add('hidden');
          cardsRoot.classList.remove('hidden');
        }
        function resetFilters(){
          state.search=''; state.category=''; state.sort='featured';
          document.getElementById('search').value='';
          document.getElementById('category').value='';
          document.getElementById('sort').value='featured';
          render();
        }
        function categories(){const set=new Set(apps.map(a=>meta(a).category));document.getElementById('category').innerHTML='<option value="">All categories</option>'+Array.from(set).sort().map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');}
        function matches(a){const m=meta(a);const t=[a.name,a.summary||'',a.description||'',...m.tags,m.category].join(' ').toLowerCase();if(state.search&&!t.includes(state.search))return false;if(state.category&&m.category!==state.category)return false;return true;}
        function sorted(list){const x=list.map(a=>({a,m:meta(a)}));if(state.sort==='name')return x.sort((p,q)=>p.a.name.localeCompare(q.a.name));if(state.sort==='runs')return x.sort((p,q)=>q.m.runCount-p.m.runCount);if(state.sort==='recent')return x.sort((p,q)=>new Date(q.m.updated)-new Date(p.m.updated));return x.sort((p,q)=>Number(q.m.featured)-Number(p.m.featured)||q.m.runCount-p.m.runCount);}
        function cardMarkup(a,m){const sr=m.runCount?Math.round((m.successCount/m.runCount)*100)+'%':'-';const icon=typeof m.icon==='string'&&m.icon.length?m.icon:'/branding/wicked-flow-icon.svg?v=20260208';const updated=new Date(m.updated||a.updated).toLocaleDateString();const creator=esc(m.author||'Wicked Flow');return '<article class="card"><div class="row" style="justify-content:space-between"><div class="row" style="gap:10px;align-items:flex-start"><img src="'+esc(icon)+'" alt="" style="width:40px;height:40px;border-radius:10px;object-fit:cover;border:1px solid var(--border)"><div><h3 style="margin:0">'+esc(a.name)+'</h3><div class="muted">'+esc(a.summary||a.description||'Workflow app')+'</div><div class="row" style="margin-top:6px"><span class="creator">By '+creator+'</span><span class="muted">Updated '+updated+'</span></div></div></div><span class="chip">'+(m.featured?'Featured':esc(m.category))+'</span></div><div class="chips" style="margin-top:8px">'+m.tags.slice(0,4).map(t=>'<span class="chip">'+esc(t)+'</span>').join('')+'</div><div class="stats" style="margin-top:10px"><div class="stat"><b>'+m.runCount+'</b><span class="muted">Runs</span></div><div class="stat"><b>'+sr+'</b><span class="muted">Success</span></div><div class="stat"><b>'+(m.avg==='-'?'-':m.avg+'ms')+'</b><span class="muted">Avg</span></div><div class="stat"><b>'+m.failedCount+'</b><span class="muted">Failed</span></div></div><div class="row" style="margin-top:10px"><a class="btn primary" href="/apps/'+a.id+'">Use app</a><a class="btn" href="/apps/'+a.id+'#details">View details</a></div></article>';}
        function renderFeatured(list){const wrap=document.getElementById('featuredWrap');const root=document.getElementById('featuredStrip');const featured=list.filter(({m})=>m.featured).slice(0,4);if(!featured.length){wrap.classList.add('hidden');root.innerHTML='';return;}wrap.classList.remove('hidden');root.innerHTML=featured.map(({a,m})=>cardMarkup(a,m)).join('');}
        function render(){
          const root = cardsRoot;
          if (parseError) {
            document.getElementById('featuredWrap').classList.add('hidden');
            root.innerHTML = '';
            setGalleryState('error', 'Failed to load apps', parseError + ' Refresh and try again.', 'Refresh', () => window.location.reload());
            return;
          }
          if (!apps.length) {
            document.getElementById('featuredWrap').classList.add('hidden');
            root.innerHTML = '';
            setGalleryState('empty', 'No apps published yet', 'Publish your first app from Publisher to see it here.', 'Open Publisher', () => window.location.href='/apps/publisher');
            return;
          }
          const list = sorted(apps.filter(matches));
          if (!list.length) {
            document.getElementById('featuredWrap').classList.add('hidden');
            root.innerHTML = '';
            setGalleryState('empty', 'No apps found', 'Try a different search or reset filters.', 'Reset filters', resetFilters);
            return;
          }
          clearGalleryState();
          renderFeatured(list);
          root.innerHTML = list.map(({a,m})=>cardMarkup(a,m)).join('');
        }
        renderTopActions({ authenticated:false });
        detectSession().then((session)=>renderTopActions(session));
        categories(); render();
        document.getElementById('search').addEventListener('input',e=>{state.search=(e.target.value||'').trim().toLowerCase();render();});
        document.getElementById('category').addEventListener('change',e=>{state.category=e.target.value;render();});
        document.getElementById('sort').addEventListener('change',e=>{state.sort=e.target.value;render();});
      </script>`)
}

function appRuntimeHtml(app: Template & { galleryMetadata?: Record<string, unknown> }): string {
    const meta = (app.galleryMetadata ?? {}) as Record<string, unknown>
    const schema = meta.inputSchema && typeof meta.inputSchema === 'object'
        ? meta.inputSchema as Record<string, unknown>
        : { fields: [] }
    const outputType = typeof meta.outputType === 'string' ? meta.outputType : 'json'
    return pageShell(`${app.name} - App`, `
      <div class="container">
        <div class="brand"><span class="dot"></span> Wicked Flow Apps</div>
        <div class="top">
          <div class="title"><h1>${escapeHtml(app.name)}</h1><p>${escapeHtml(app.description || app.summary || 'Run this app using your own inputs.')}</p></div>
          <div class="row"><a class="btn" href="/">Dashboard</a><a class="btn" href="/apps">Back</a><a class="btn" href="/apps/${escapeHtml(app.id)}#details">Details</a></div>
        </div>
        <div class="grid2">
          <section class="panel" id="details">
            <h2 style="margin:0 0 10px">Run app</h2>
            <div id="appContract" class="muted" style="margin-bottom:10px"></div>
            <div id="formFields" class="row" style="display:grid;gap:10px"></div>
            <div class="row" style="margin-top:10px">
              <button id="runBtn" class="btn primary">Run app</button>
              <button id="runAsyncBtn" class="btn">Run in background</button>
              <button id="cancelBtn" class="btn hidden">Cancel run</button>
              <button id="resetBtn" class="btn">Reset</button>
            </div>
            <div id="runError" class="danger hidden" style="margin-top:8px"></div>
          </section>
          <section class="panel">
            <h2 style="margin:0 0 10px">Output</h2>
            <div id="runMeta" class="muted">No runs yet.</div>
            <div id="output" class="hidden" style="margin-top:10px"></div>
            <div id="stats" style="margin-top:12px" class="muted">Loading stats...</div>
            <div id="runHistory" style="margin-top:12px" class="muted">Loading recent runs...</div>
          </section>
        </div>
      </div>
      <script id="schema-data" type="application/json">${serializeForScript(schema)}</script>
      <script id="output-type" type="application/json">${serializeForScript(outputType)}</script>
      <script>
        const appId = ${serializeForScript(app.id)};
        const schema = JSON.parse(document.getElementById('schema-data').textContent || '{"fields":[]}');
        const configuredOutputType = JSON.parse(document.getElementById('output-type').textContent || '"json"');
        const esc=(t)=>{const d=document.createElement('div');d.textContent=String(t||'');return d.innerHTML;};
        const formFields=document.getElementById('formFields');
        const runBtn=document.getElementById('runBtn');
        const runAsyncBtn=document.getElementById('runAsyncBtn');
        const cancelBtn=document.getElementById('cancelBtn');
        const resetBtn=document.getElementById('resetBtn');
        const runError=document.getElementById('runError');
        const output=document.getElementById('output');
        const runMeta=document.getElementById('runMeta');
        const appContract=document.getElementById('appContract');
        const stats=document.getElementById('stats');
        const runHistory=document.getElementById('runHistory');
        let activeRunController = null;

        function normalizeFields(raw){if(!raw||typeof raw!=='object')return [];if(Array.isArray(raw.fields))return raw.fields;return Object.entries(raw).map(([name,config])=>{if(typeof config==='string')return {name,label:name,type:config};if(config&&typeof config==='object')return {name,label:name,...config};return {name,label:name,type:'text'};});}
        function fieldHtml(field){const n=String(field.name||'').replace(/[^a-zA-Z0-9_]/g,'_');const type=String(field.type||'text').toLowerCase();const label=field.label||n;const req=field.required?'required':'';const ph=field.placeholder||'';if(type==='textarea')return '<label class="muted">'+esc(label)+'</label><textarea class="input" name="'+esc(n)+'" placeholder="'+esc(ph)+'" '+req+'></textarea>';if(type==='number')return '<label class="muted">'+esc(label)+'</label><input class="input" type="number" name="'+esc(n)+'" placeholder="'+esc(ph)+'" '+req+' />';if(type==='boolean')return '<label class="muted" style="display:flex;gap:8px;align-items:center;"><input type="checkbox" name="'+esc(n)+'" />'+esc(label)+'</label>';if(type==='select'){const options=Array.isArray(field.options)?field.options:[];return '<label class="muted">'+esc(label)+'</label><select class="select" name="'+esc(n)+'" '+req+'><option value="">Select...</option>'+options.map((opt)=>{if(typeof opt==='string')return '<option value="'+esc(opt)+'">'+esc(opt)+'</option>';return '<option value="'+esc(opt.value||opt.label||'')+'">'+esc(opt.label||opt.value||'')+'</option>';}).join('')+'</select>';}const inputType=type==='password'?'password':'text';return '<label class="muted">'+esc(label)+'</label><input class="input" type="'+inputType+'" name="'+esc(n)+'" placeholder="'+esc(ph)+'" '+req+' />';}
        function renderForm(){const fields=normalizeFields(schema);if(!fields.length){formFields.innerHTML='<label class="muted">Input</label><textarea class="input" name="input" placeholder="Enter input"></textarea>';return;}formFields.innerHTML=fields.map((f)=>'<div>'+fieldHtml(f)+'</div>').join('');}
        function renderContract(){const fields=normalizeFields(schema);const required=fields.filter(f=>f.required).map(f=>f.label||f.name);const outputTypeLabel=(configuredOutputType||'json').toUpperCase();if(!fields.length){appContract.innerHTML='No structured inputs required. Output format: <b>'+outputTypeLabel+'</b>.';return;}appContract.innerHTML='Expected output: <b>'+outputTypeLabel+'</b>. '+(required.length?'Required inputs: <b>'+required.map(esc).join(', ')+'</b>.':'All inputs are optional.');}
        async function loadStats(){
          stats.innerHTML='<span class="skeleton" style="width:180px"></span>';
          try{
            const res=await fetch('/apps/api/apps/'+encodeURIComponent(appId)+'/stats');
            const body=await res.json();
            if(!res.ok){
              stats.innerHTML='<div class="danger">Stats unavailable.</div><div class="actions"><button id="statsRetryBtn" class="btn">Retry</button></div>';
              document.getElementById('statsRetryBtn').addEventListener('click',()=>loadStats());
              return;
            }
            const sr=body.runCount?Math.round((body.successCount/body.runCount)*100):0;
            stats.innerHTML='<div class="stats"><div class="stat"><b>'+body.runCount+'</b><span class="muted">Runs</span></div><div class="stat"><b>'+body.successCount+'</b><span class="muted">Success</span></div><div class="stat"><b>'+body.failedCount+'</b><span class="muted">Failed</span></div><div class="stat"><b>'+(body.averageExecutionMs?Math.round(body.averageExecutionMs)+'ms':'-')+'</b><span class="muted">Avg</span></div></div><div class="muted" style="margin-top:8px">Success rate: '+sr+'%</div>';
          }catch(e){
            stats.innerHTML='<div class="danger">Stats unavailable.</div><div class="actions"><button id="statsRetryBtn" class="btn">Retry</button></div>';
            document.getElementById('statsRetryBtn').addEventListener('click',()=>loadStats());
          }
        }
        async function loadRuns(){
          runHistory.innerHTML='<span class="skeleton" style="width:220px"></span>';
          try{
            const res=await fetch('/apps/api/apps/'+encodeURIComponent(appId)+'/runs?limit=8');
            const body=await res.json();
            if(!res.ok){
              runHistory.innerHTML='<div class="danger">Run history unavailable.</div><div class="actions"><button id="runsRetryBtn" class="btn">Retry</button></div>';
              document.getElementById('runsRetryBtn').addEventListener('click',()=>loadRuns());
              return;
            }
            const rows=Array.isArray(body.data)?body.data:[];
            if(!rows.length){
              runHistory.innerHTML='<div class="muted">No recent runs yet.</div>';
              return;
            }
            runHistory.innerHTML='<h3 style=\"margin:0 0 8px\">Recent runs</h3>'+rows.map((r)=>{const when=new Date(r.created).toLocaleString();const status=r.status==='success'?'<span class=\"success\">success</span>':(r.status==='failed'?'<span class=\"danger\">failed</span>':'queued');const ms=r.executionTimeMs?(' - '+r.executionTimeMs+'ms'):'';const err=r.error?('<div class=\"danger\" style=\"font-size:12px\">'+esc(r.error)+'</div>'):'';return '<div style=\"border:1px solid #e4e8f3;border-radius:10px;padding:8px;margin:6px 0\"><div><b>'+status+'</b><span class=\"muted\"> - '+when+ms+'</span></div>'+err+'</div>';}).join('');
          }catch(e){
            runHistory.innerHTML='<div class="danger">Run history unavailable.</div><div class="actions"><button id="runsRetryBtn" class="btn">Retry</button></div>';
            document.getElementById('runsRetryBtn').addEventListener('click',()=>loadRuns());
          }
        }
        function renderOutput(data){const t=String(configuredOutputType||'json').toLowerCase();if(t==='image'){const url=typeof data==='string'?data:(data&&data.imageUrl)||((data&&data.url)||'');if(url)return '<img src="'+esc(String(url))+'" alt="Output" style="max-width:100%;border:1px solid #dce1ef;border-radius:10px" />';}if(t==='text'){const text=typeof data==='string'?data:(data&&data.text)||JSON.stringify(data);return '<div style="white-space:pre-wrap;line-height:1.5">'+esc(String(text))+'</div>';}if(t==='markdown'){const text=typeof data==='string'?data:(data&&data.markdown)||(data&&data.text)||JSON.stringify(data);return '<pre class="code" style="white-space:pre-wrap">'+esc(String(text))+'</pre>';}return '<pre class="code">'+esc(JSON.stringify(data,null,2))+'</pre>';}
        function setRunningState(isRunning, mode){
          runBtn.disabled=isRunning;
          runAsyncBtn.disabled=isRunning;
          resetBtn.disabled=isRunning;
          runBtn.textContent=isRunning?(mode==='async'?'Queueing...':'Running...'):'Run app';
          cancelBtn.classList.toggle('hidden',!isRunning);
          cancelBtn.disabled=!isRunning;
        }
        async function runApp(mode){runError.classList.add('hidden');runError.textContent='';setRunningState(true,mode);output.classList.add('hidden');const fields=formFields.querySelectorAll('[name]');const inputs={};fields.forEach((el)=>{if(el.type==='checkbox')inputs[el.name]=el.checked;else if(el.type==='number')inputs[el.name]=el.value===''?null:Number(el.value);else inputs[el.name]=el.value;});const start=Date.now();const controller=new AbortController();activeRunController=controller;try{const res=await fetch('/apps/'+encodeURIComponent(appId)+'/execute?mode='+encodeURIComponent(mode||'sync'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({inputs}),signal:controller.signal});const body=await res.json();if(!res.ok)throw new Error(body.error||'Execution failed');if(body.queued){runMeta.textContent='Run queued at '+new Date().toLocaleString()+'. It will complete in background.';output.innerHTML='<div class=\"muted\">Queued successfully. Check recent runs for updates.</div>';output.classList.remove('hidden');await loadRuns();return;}const ms=body.executionTime||(Date.now()-start);runMeta.textContent='Last run: '+new Date().toLocaleString()+' ('+ms+'ms)';output.innerHTML=renderOutput(body.output);output.classList.remove('hidden');await loadStats();await loadRuns();}catch(e){if(e&&e.name==='AbortError'){runError.textContent='Run cancelled.';}else{runError.textContent=e.message||String(e);}runError.classList.remove('hidden');}finally{activeRunController=null;setRunningState(false,mode);}}
        runBtn.addEventListener('click',(e)=>{e.preventDefault();runApp('sync');});
        runAsyncBtn.addEventListener('click',(e)=>{e.preventDefault();runApp('async');});
        cancelBtn.addEventListener('click',(e)=>{e.preventDefault();if(activeRunController){activeRunController.abort();}});
        resetBtn.addEventListener('click',(e)=>{e.preventDefault();document.querySelectorAll('#formFields [name]').forEach((el)=>{if(el.type==='checkbox')el.checked=false;else el.value='';});output.classList.add('hidden');runError.classList.add('hidden');});
        renderForm();renderContract();loadStats();loadRuns();
      </script>`)
}

function publisherPageHtml(): string {
    return pageShell('Apps Publisher', `
      <div class="container">
        <div class="brand"><span class="dot"></span> Wicked Flow Publisher</div>
        <div class="top" style="margin-bottom:10px">
          <div class="title"><h1>Publish your workflow as an app</h1><p>Turn templates into no-code apps your team and clients can run in seconds.</p></div>
          <div class="row"><a class="btn" href="/apps">Open gallery</a><a id="publisherTopCta" class="btn primary" href="/sign-in?redirectAfterLogin=%2Fapps%2Fpublisher">Sign in to publish</a></div>
        </div>
        <div class="grid2" style="margin-top:12px">
          <section class="panel">
            <h2 style="margin:0 0 8px">How it works</h2>
            <ol class="muted" style="display:grid;gap:8px;padding-left:18px;margin:0">
              <li>Create or pick a template in your dashboard.</li>
              <li>Open Publisher inside your project workspace.</li>
              <li>Define app inputs, output type, and publish.</li>
              <li>Share your app URL from the public gallery.</li>
            </ol>
            <div class="row" style="margin-top:12px">
              <a id="publisherMainCta" class="btn primary" href="/sign-in?redirectAfterLogin=%2Fapps%2Fpublisher">Go to Publisher Dashboard</a>
            </div>
          </section>
          <section class="panel">
            <h2 style="margin:0 0 8px">Publisher capabilities</h2>
            <div style="display:grid;gap:8px">
              <div class="row" style="justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:8px;background:#fff"><span class="muted">Template to app</span><b>One-click publish</b></div>
              <div class="row" style="justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:8px;background:#fff"><span class="muted">Input schema</span><b>Form-driven execution</b></div>
              <div class="row" style="justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:8px;background:#fff"><span class="muted">Lifecycle</span><b>Update + unpublish</b></div>
              <div class="row" style="justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:8px;background:#fff"><span class="muted">Catalog seeding</span><b>Admin-ready defaults</b></div>
            </div>
          </section>
        </div>
        <section class="panel" style="margin-top:12px">
          <h2 style="margin:0 0 8px">Why this matters for agencies</h2>
          <p class="muted" style="margin:0">Publisher lets non-technical team members run repeatable workflows as simple apps, while your builders keep logic centralized in templates.</p>
        </section>
      </div>
      <script>
        async function detectSession(){
          const candidateTokens = [
            null,
            window.localStorage.getItem('token') || null,
            window.sessionStorage.getItem('token') || null,
          ].filter((value, index, arr) => arr.indexOf(value) === index);
          for (const tokenValue of candidateTokens) {
            try {
              const headers = {};
              if (tokenValue) {
                headers.Authorization = 'Bearer ' + tokenValue;
              }
              const response = await fetch('/apps/api/session', {
                credentials: 'same-origin',
                headers,
              });
              if (response.ok) return true;
            } catch (e) {}
          }
          return false;
        }
        detectSession().then((isSignedIn) => {
          if (!isSignedIn) return;
          const topCta = document.getElementById('publisherTopCta');
          const mainCta = document.getElementById('publisherMainCta');
          if (topCta) {
            topCta.setAttribute('href', '/');
            topCta.textContent = 'Open dashboard';
          }
          if (mainCta) {
            mainCta.setAttribute('href', '/');
            mainCta.textContent = 'Go to Dashboard Publisher';
          }
          const cta = document.createElement('div');
          cta.className = 'panel';
          cta.style.marginTop = '12px';
          cta.innerHTML = '<h2 style=\"margin:0 0 8px\">Already signed in?</h2><p class=\"muted\" style=\"margin:0 0 10px\">Open your project dashboard and use Apps -> Publisher to manage app publishing in-app.</p><div class=\"row\"><a class=\"btn primary\" href=\"/\">Open dashboard</a></div>';
          document.querySelector('.container')?.appendChild(cta);
        });
      </script>`)
}

export const flowGalleryController: FastifyPluginAsyncTypebox = async (fastify) => {
    const service = flowGalleryService(fastify.log)

    fastify.get('/', { config: { security: { kind: RouteKind.PUBLIC } } }, async (_, reply) => {
        try {
            const apps = await service.listPublicApps({ cursor: null, limit: 200, platformId: null })
            return reply.type('text/html').send(galleryPageHtml(apps.data))
        } catch (error) {
            fastify.log.error(error)
            return reply.code(500).send({ error: 'Failed to load gallery' })
        }
    })

    fastify.get('/api/apps', { config: { security: { kind: RouteKind.PUBLIC } }, schema: { querystring: ListAppsQuery } }, async (request, reply) => {
        const query = request.query as Static<typeof ListAppsQuery>
        try {
            const apps = await service.listPublicApps({
                cursor: query.cursor || null,
                limit: Math.min(query.limit || 20, 100),
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

    fastify.get('/api/session', {
        config: {
            security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
        },
    }, async (request, reply) => {
        return reply.send({
            authenticated: true,
            userId: request.principal.id,
            platformId: request.principal.platform.id,
        })
    })

    fastify.get('/api/apps/:id', { config: { security: { kind: RouteKind.PUBLIC } }, schema: { params: AppIdParams } }, async (request, reply) => {
        const params = request.params as Static<typeof AppIdParams>
        const app = await service.getPublicApp({ id: params.id, platformId: null })
        if (!app) return reply.code(StatusCodes.NOT_FOUND).send({ error: 'App not found' })
        return reply.send(app)
    })

    fastify.get('/api/apps/:id/stats', { config: { security: { kind: RouteKind.PUBLIC } }, schema: { params: AppIdParams } }, async (request, reply) => {
        const params = request.params as Static<typeof AppIdParams>
        const stats = await service.getPublicAppStats(params.id)
        if (!stats) return reply.code(StatusCodes.NOT_FOUND).send({ error: 'App stats not found' })
        return reply.send(stats)
    })

    fastify.get('/api/apps/:id/runs', { config: { security: { kind: RouteKind.PUBLIC } }, schema: { params: AppIdParams, querystring: AppRunsQuery } }, async (request, reply) => {
        const params = request.params as Static<typeof AppIdParams>
        const query = request.query as Static<typeof AppRunsQuery>
        const runs = await service.listRecentRuns({
            templateId: params.id,
            limit: query.limit ?? 10,
        })
        return reply.send({
            data: runs,
        })
    })

    fastify.get('/publisher', { config: { security: { kind: RouteKind.PUBLIC } } }, async (_, reply) => {
        return reply.type('text/html').send(publisherPageHtml())
    })

    fastify.get('/api/publisher/apps', {
        config: { security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]) },
        schema: { querystring: ListPublisherAppsQuery },
    }, async (request, reply) => {
        const query = request.query as Static<typeof ListPublisherAppsQuery>
        try {
            const apps = await service.listPublisherApps({ platformId: request.principal.platform.id, search: query.search })
            return reply.send({ data: apps })
        } catch (error) {
            fastify.log.error(error)
            return reply.code(500).send({ error: 'Failed to list published apps' })
        }
    })

    fastify.get('/api/publisher/templates', {
        config: { security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]) },
        schema: { querystring: ListPublisherTemplatesQuery },
    }, async (request, reply) => {
        const query = request.query as Static<typeof ListPublisherTemplatesQuery>
        try {
            const templates = await service.listPublisherTemplates({ platformId: request.principal.platform.id, search: query.search })
            return reply.send({ data: templates })
        } catch (error) {
            fastify.log.error(error)
            return reply.code(500).send({ error: 'Failed to list templates' })
        }
    })

    fastify.post('/api/publisher/publish', {
        config: { security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]) },
        schema: { body: PublisherAppPayload },
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
            return reply.code(StatusCodes.BAD_REQUEST).send({ error: error?.message ?? 'Failed to publish app' })
        }
    })

    fastify.put('/api/publisher/apps/:templateId', {
        config: { security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]) },
        schema: { params: PublisherTemplateParams, body: UpdatePublisherAppPayload },
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
            return reply.code(StatusCodes.BAD_REQUEST).send({ error: error?.message ?? 'Failed to update app metadata' })
        }
    })

    fastify.delete('/api/publisher/apps/:templateId', {
        config: { security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]) },
        schema: { params: PublisherTemplateParams },
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
            return reply.code(StatusCodes.BAD_REQUEST).send({ error: error?.message ?? 'Failed to unpublish app' })
        }
    })

    fastify.post('/api/publisher/seed-defaults', {
        config: { security: securityAccess.publicPlatform([PrincipalType.USER]) },
        schema: { body: SeedDefaultsBody },
    }, async (request, reply) => {
        const body = request.body as Static<typeof SeedDefaultsBody>
        if (body.confirm !== 'SEED_DEFAULTS') {
            return reply.code(StatusCodes.BAD_REQUEST).send({
                error: 'Invalid confirmation. Send confirm=SEED_DEFAULTS',
            })
        }

        const user = await userService.getOneOrFail({ id: request.principal.id })
        if (user.platformRole !== PlatformRole.ADMIN) {
            return reply.code(StatusCodes.FORBIDDEN).send({
                error: 'Only platform admins can seed default apps/templates',
            })
        }

        try {
            const result = await service.seedDefaultCatalog({
                platformId: request.principal.platform.id,
                publishedBy: request.principal.id,
                reset: body.reset ?? false,
            })
            return reply.code(StatusCodes.OK).send(result)
        } catch (error: any) {
            fastify.log.error(error)
            return reply.code(StatusCodes.BAD_REQUEST).send({ error: error?.message ?? 'Failed to seed defaults' })
        }
    })

    fastify.get('/:id', { config: { security: { kind: RouteKind.PUBLIC } }, schema: { params: AppIdParams } }, async (request, reply) => {
        const params = request.params as Static<typeof AppIdParams>
        try {
            const app = await service.getPublicApp({ id: params.id, platformId: null })
            if (!app) return reply.code(404).send({ error: 'App not found' })
            return reply.type('text/html').send(appRuntimeHtml(app as Template & { galleryMetadata?: Record<string, unknown> }))
        } catch (error) {
            fastify.log.error(error)
            return reply.code(500).send({ error: 'Failed to load app' })
        }
    })

    fastify.post('/:id/execute', { config: { security: { kind: RouteKind.PUBLIC }, rateLimit: executeRateLimit }, schema: { params: AppIdParams, querystring: ExecuteFlowQuery, body: ExecuteFlowRequest } }, async (request, reply) => {
        const params = request.params as Static<typeof AppIdParams>
        const query = request.query as Static<typeof ExecuteFlowQuery>
        const body = request.body as Static<typeof ExecuteFlowRequest>
        const serializedInputs = JSON.stringify(body.inputs ?? {})
        if (Buffer.byteLength(serializedInputs, 'utf8') > 200_000) {
            return reply.code(StatusCodes.REQUEST_TOO_LONG).send({ error: 'Inputs payload is too large. Reduce request size and retry.' })
        }

        const started = Date.now()
        try {
            const app = await service.getPublicApp({ id: params.id, platformId: null })
            if (!app) return reply.code(404).send({ error: 'App not found' })

            const meta = (app.galleryMetadata ?? {}) as Record<string, unknown>
            const fields = extractAppInputFields(meta.inputSchema)
            const validationErrors = validateAppInputs(fields, body.inputs ?? {})
            if (validationErrors.length > 0) {
                return reply.code(StatusCodes.BAD_REQUEST).send({
                    error: validationErrors[0],
                    details: validationErrors,
                })
            }

            const executionMode = query.mode === 'async' ? 'async' : 'sync'
            const executionPromise = service.executePublicApp({
                appId: params.id,
                inputs: body.inputs ?? {},
                mode: executionMode,
            })

            const flowResponse = executionMode === 'async'
                ? await executionPromise
                : await Promise.race([
                    executionPromise,
                    new Promise<never>((_, reject) => {
                        setTimeout(() => reject(new Error('This app is taking longer than expected. Use "Run in background" for long tasks.')), 30_000)
                    }),
                ])

            const executionTime = Date.now() - started
            const requestIdHeader = typeof flowResponse.headers === 'object' && flowResponse.headers
                ? (flowResponse.headers['x-webhook-id'] ?? flowResponse.headers['X-WEBHOOK-ID'])
                : undefined
            await service.logExecution({
                templateId: params.id,
                executionStatus: executionMode === 'async'
                    ? 'queued'
                    : flowResponse.status >= 200 && flowResponse.status < 300
                        ? 'success'
                        : 'failed',
                executionTimeMs: executionTime,
                outputs: flowResponse.body,
                inputKeys: Object.keys(body.inputs ?? {}),
                requestId: typeof requestIdHeader === 'string' ? requestIdHeader : undefined,
            })

            if (executionMode === 'async') {
                return reply.status(StatusCodes.ACCEPTED).send({
                    queued: true,
                    requestId: requestIdHeader ?? null,
                    executionTime,
                    message: 'App run queued. Refresh run history to track completion.',
                })
            }

            return reply.status(flowResponse.status).send({ output: flowResponse.body, executionTime })
        } catch (error: any) {
            fastify.log.error(error)
            const safeError = sanitizePublicError(error)
            await service.logExecution({
                templateId: params.id,
                executionStatus: 'failed',
                executionTimeMs: Date.now() - started,
                error: safeError,
                inputKeys: Object.keys(body.inputs ?? {}),
            })
            return reply.code(StatusCodes.BAD_REQUEST).send({ error: safeError })
        }
    })
}
