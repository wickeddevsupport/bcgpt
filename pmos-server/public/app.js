const outputArea = document.getElementById('outputArea');
const insightsList = document.getElementById('insightsList');

const pmosStatusValue = document.getElementById('pmosStatusValue');
const pmosToolsValue = document.getElementById('pmosToolsValue');
const bcgptStatusValue = document.getElementById('bcgptStatusValue');
const bcgptStatusHint = document.getElementById('bcgptStatusHint');
const flowStatusValue = document.getElementById('flowStatusValue');
const flowStatusHint = document.getElementById('flowStatusHint');

function writeOutput(payload) {
  outputArea.textContent = JSON.stringify(payload, null, 2);
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

async function fetchDashboard() {
  const response = await fetch('/api/dashboard');
  const payload = await response.json();
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
  renderInsights(payload.insights);
}

async function runCommand(command, projectId = null) {
  const body = { command };
  if (projectId) {
    body.project_id = projectId;
  }

  const response = await fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  writeOutput(payload);
}

document.querySelectorAll('.quick-command').forEach((button) => {
  button.addEventListener('click', async () => {
    const command = button.getAttribute('data-command');
    await runCommand(command);
  });
});

document.querySelectorAll('.project-command').forEach((button) => {
  button.addEventListener('click', async () => {
    const projectId = document.getElementById('projectIdInput').value.trim();
    const command = button.getAttribute('data-command');
    if (!projectId) {
      writeOutput({ error: 'project_id is required for this action' });
      return;
    }
    await runCommand(command, projectId);
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

document.getElementById('clearOutputBtn').addEventListener('click', () => {
  writeOutput({ message: 'Cleared' });
});

async function init() {
  try {
    await fetchDashboard();
    writeOutput({ ok: true, message: 'PMOS shell ready' });
  } catch (error) {
    writeOutput({ ok: false, error: error.message });
  }
}

init();
