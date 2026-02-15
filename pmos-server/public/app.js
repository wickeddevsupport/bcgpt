const outputArea = document.getElementById('outputArea');
const insightsList = document.getElementById('insightsList');
const operationsList = document.getElementById('operationsList');
const chatLog = document.getElementById('chatLog');

const pmosStatusValue = document.getElementById('pmosStatusValue');
const pmosToolsValue = document.getElementById('pmosToolsValue');
const bcgptStatusValue = document.getElementById('bcgptStatusValue');
const bcgptStatusHint = document.getElementById('bcgptStatusHint');
const flowStatusValue = document.getElementById('flowStatusValue');
const flowStatusHint = document.getElementById('flowStatusHint');
const readinessValue = document.getElementById('readinessValue');
const readinessHint = document.getElementById('readinessHint');

const tokenInput = document.getElementById('pmosTokenInput');
const tokenStatusHint = document.getElementById('tokenStatusHint');
const chatInput = document.getElementById('chatInput');
const projectIdInput = document.getElementById('projectIdInput');

const TOKEN_KEY = 'pmos_shell_token';
const SESSION_KEY = 'pmos_shell_session_id';

let shellToken = localStorage.getItem(TOKEN_KEY) || '';
let sessionId = localStorage.getItem(SESSION_KEY) || `ui-${Date.now().toString(36)}`;
localStorage.setItem(SESSION_KEY, sessionId);

function writeOutput(payload) {
  outputArea.textContent = JSON.stringify(payload, null, 2);
}

function appendChat(role, message) {
  const item = document.createElement('div');
  item.className = `chat-item chat-${role}`;
  item.textContent = message;
  chatLog.appendChild(item);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setTokenHint(message) {
  tokenStatusHint.textContent = message;
}

function updateTokenUI() {
  tokenInput.value = shellToken;
  setTokenHint(shellToken ? 'Token loaded from this browser session.' : 'No token set. Only needed when PMOS_SHELL_TOKEN is enabled.');
}

function authHeaders(base = {}) {
  const headers = { ...base };
  if (shellToken) {
    headers['x-pmos-token'] = shellToken;
  }
  return headers;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: authHeaders(options.headers || {})
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { error: 'Invalid JSON response' };
  }

  return { response, payload };
}

function setExternalStatus(valueNode, hintNode, integration) {
  if (!integration) {
    valueNode.textContent = 'Unavailable';
    valueNode.className = 'value status-bad';
    hintNode.textContent = '';
    return;
  }

  valueNode.textContent = integration.ok ? 'Online' : 'Offline';
  valueNode.className = `value ${integration.ok ? 'status-ok' : 'status-bad'}`;
  hintNode.textContent = integration.ok
    ? `${integration.url} (${integration.status})`
    : `${integration.url} (${integration.status || 'no response'})`;
}

function renderInsights(insightsPayload) {
  const items = insightsPayload?.insights || insightsPayload?.items || insightsPayload?.data || [];
  insightsList.innerHTML = '';

  if (!Array.isArray(items) || items.length === 0) {
    const li = document.createElement('li');
    li.className = 'insight-empty';
    li.textContent = 'No active insights yet.';
    insightsList.appendChild(li);
    return;
  }

  items.slice(0, 8).forEach((item) => {
    const li = document.createElement('li');
    const title = item.title || item.type || 'Insight';
    const body = item.description || item.message || JSON.stringify(item);
    li.innerHTML = `<strong>${title}</strong><div>${body}</div>`;
    insightsList.appendChild(li);
  });
}

function renderOperations(items = []) {
  operationsList.innerHTML = '';

  if (!Array.isArray(items) || items.length === 0) {
    const li = document.createElement('li');
    li.className = 'insight-empty';
    li.textContent = 'No operations yet.';
    operationsList.appendChild(li);
    return;
  }

  items.slice(0, 20).forEach((item) => {
    const li = document.createElement('li');
    li.className = 'operation-item';
    const readableTime = new Date(item.created_at || Date.now()).toLocaleString();
    const statusClass = `op-status op-status-${item.status || 'queued'}`;

    li.innerHTML = `
      <div class="operation-head">
        <strong>${item.command || 'unknown'}</strong>
        <span class="${statusClass}">${item.status || 'queued'}</span>
      </div>
      <p class="operation-meta">Tool: ${item.tool || '-'} | Risk: ${item.risk || 'low'} | ${readableTime}</p>
      <p class="operation-meta">${item.result_excerpt || item.error || ''}</p>
    `;

    if (item.status === 'pending_approval') {
      const approveButton = document.createElement('button');
      approveButton.className = 'btn btn-small';
      approveButton.textContent = 'Approve & Run';
      approveButton.addEventListener('click', async () => {
        await approveOperation(item.id);
      });
      li.appendChild(approveButton);
    }

    operationsList.appendChild(li);
  });
}

function renderReadiness(readiness = {}) {
  const parts = [];
  if (readiness.bcgpt_api_key_configured) {
    parts.push('BCGPT key ok');
  } else {
    parts.push('BCGPT key missing');
  }
  if (readiness.shell_auth_configured) {
    parts.push('Shell auth on');
  } else {
    parts.push('Shell auth off');
  }

  const healthy = readiness.bcgpt_api_key_configured;
  readinessValue.textContent = healthy ? 'Ready' : 'Partial';
  readinessValue.className = `value ${healthy ? 'status-ok' : 'status-bad'}`;
  readinessHint.textContent = parts.join(' | ');
}

async function fetchDashboard() {
  const { response, payload } = await requestJson('/api/dashboard');
  if (!response.ok) {
    writeOutput(payload);
    throw new Error(payload.error || 'Failed to load dashboard');
  }

  const status = payload.status || {};
  pmosStatusValue.textContent = status.status || 'unknown';
  pmosStatusValue.className = `value ${status.status === 'operational' ? 'status-ok' : 'status-bad'}`;
  pmosToolsValue.textContent = `${status.tools || 0} intelligence tools`;

  setExternalStatus(bcgptStatusValue, bcgptStatusHint, payload.integrations?.bcgpt);
  setExternalStatus(flowStatusValue, flowStatusHint, payload.integrations?.flow);
  renderReadiness(payload.readiness || {});
  renderInsights(payload.insights);
  renderOperations(payload.operations?.items || []);
}

async function fetchOperations() {
  const { response, payload } = await requestJson('/api/operations?limit=30');
  if (!response.ok) {
    writeOutput(payload);
    return;
  }
  renderOperations(payload.operations || []);
}

async function runCommand(command, projectId = null) {
  const body = { command };
  if (projectId) {
    body.project_id = projectId;
  }

  const { response, payload } = await requestJson('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  writeOutput(payload);
  if (!response.ok && response.status !== 202) {
    throw new Error(payload.error || `Command failed: ${command}`);
  }

  if (payload.pending_approval) {
    appendChat('system', `Approval pending for ${payload.command} (operation ${payload.operation_id}).`);
  }
}

async function approveOperation(operationId) {
  const { response, payload } = await requestJson(`/api/operations/${operationId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId })
  });

  writeOutput(payload);
  if (response.ok) {
    appendChat('assistant', `Approved operation ${operationId} and executed.`);
  }
  await fetchOperations();
  await fetchDashboard();
}

async function sendChat() {
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  appendChat('user', message);
  chatInput.value = '';

  const body = {
    message,
    session_id: sessionId
  };

  const projectId = projectIdInput.value.trim();
  if (projectId) {
    body.project_id = projectId;
  }

  const { response, payload } = await requestJson('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  writeOutput(payload);
  if (response.ok || response.status === 202) {
    appendChat('assistant', payload.assistant_message || 'Done.');
  } else {
    appendChat('system', payload.error || 'Chat request failed.');
  }

  await fetchOperations();
  await fetchDashboard();
}

document.querySelectorAll('.quick-command').forEach((button) => {
  button.addEventListener('click', async () => {
    const command = button.getAttribute('data-command');
    await runCommand(command);
    await fetchDashboard();
    await fetchOperations();
  });
});

document.querySelectorAll('.project-command').forEach((button) => {
  button.addEventListener('click', async () => {
    const projectId = projectIdInput.value.trim();
    const command = button.getAttribute('data-command');
    if (!projectId) {
      writeOutput({ error: 'project_id is required for this action' });
      return;
    }
    await runCommand(command, projectId);
    await fetchDashboard();
    await fetchOperations();
  });
});

document.getElementById('refreshDashboardBtn').addEventListener('click', async () => {
  try {
    await fetchDashboard();
    writeOutput({ ok: true, message: 'Dashboard refreshed' });
  } catch (error) {
    writeOutput({ ok: false, error: error.message });
  }
});

document.getElementById('refreshInsightsBtn').addEventListener('click', async () => {
  await runCommand('insights');
  await fetchDashboard();
});

document.getElementById('refreshOperationsBtn').addEventListener('click', async () => {
  await fetchOperations();
  writeOutput({ ok: true, message: 'Operations refreshed' });
});

document.getElementById('clearOutputBtn').addEventListener('click', () => {
  writeOutput({ message: 'Cleared' });
});

document.getElementById('clearChatBtn').addEventListener('click', () => {
  chatLog.innerHTML = '<div class="chat-item chat-assistant">Chat cleared.</div>';
});

document.getElementById('saveTokenBtn').addEventListener('click', () => {
  shellToken = tokenInput.value.trim();
  localStorage.setItem(TOKEN_KEY, shellToken);
  updateTokenUI();
  writeOutput({ ok: true, message: 'Token saved in browser storage' });
});

document.getElementById('clearTokenBtn').addEventListener('click', () => {
  shellToken = '';
  localStorage.removeItem(TOKEN_KEY);
  updateTokenUI();
  writeOutput({ ok: true, message: 'Token cleared' });
});

document.getElementById('chatForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await sendChat();
});

async function init() {
  try {
    updateTokenUI();
    await fetchDashboard();
    await fetchOperations();
    writeOutput({ ok: true, message: 'PMOS shell ready' });
  } catch (error) {
    writeOutput({ ok: false, error: error.message });
  }
}

init();
