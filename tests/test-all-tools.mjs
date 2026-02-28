/**
 * Comprehensive test of all 291 Basecamp tools against bcgpt test project.
 * Usage: node tests/test-all-tools.mjs
 */
import fetch from 'node-fetch';

const API_KEY = 'acb7d6a65d6c3d12c383526040e060119fa6e7687c244268';
const BASE_URL = 'https://bcgpt.wickedlab.io/mcp';
const ACCOUNT_ID = '5282924'; // Wicked Web account
const TEST_PROJECT_NAME = 'BCGPT TEST PROJECT';
const TEST_PROJECT_ID = 45925981;

const results = { pass: [], fail: [], skip: [] };

async function callTool(name, args = {}) {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  return res.json();
}

function extractData(response) {
  if (!response?.result) return null;
  const result = response.result;
  if (Array.isArray(result.content)) {
    for (const c of result.content) {
      if (c.type === 'text' && c.text) {
        try { return JSON.parse(c.text); } catch { return c.text; }
      }
    }
  }
  return result;
}

function isOk(response) {
  if (!response) return false;
  if (response.error) return false;
  const result = response.result;
  if (!result) return false;
  if (Array.isArray(result.content)) {
    for (const c of result.content) {
      if (c.type === 'text' && c.text) {
        try {
          const parsed = JSON.parse(c.text);
          if (parsed?.code === 'NOT_AUTHENTICATED') return false;
          if (parsed?.error?.code === 'NOT_AUTHENTICATED') return false;
          if (parsed?.code === 'BASECAMP_API_ERROR' && parsed?.status === 404) return 'skip';
          if (parsed?.error?.code === 'BASECAMP_API_ERROR' && parsed?.error?.status === 404) return 'skip';
          if (parsed?.status === 404) return 'skip';
        } catch {}
      }
    }
    return true;
  }
  return true;
}

function getErrorMsg(response) {
  if (!response) return 'no response';
  if (response.error) return JSON.stringify(response.error);
  const result = response.result;
  if (!result) return 'no result';
  if (Array.isArray(result.content)) {
    for (const c of result.content) {
      if (c.type === 'text' && c.text) {
        try {
          const parsed = JSON.parse(c.text);
          if (parsed?.code) return `${parsed.code}: ${parsed.message || ''}`;
          if (parsed?.error?.code) return `${parsed.error.code}: ${parsed.error.message || ''}`;
        } catch {}
        return c.text.slice(0, 200);
      }
    }
  }
  return JSON.stringify(result).slice(0, 200);
}

async function test(name, args, label) {
  const displayName = label || name;
  try {
    const res = await callTool(name, args);
    const status = isOk(res);
    if (status === 'skip') {
      results.skip.push({ name: displayName, reason: '404 (resource may not exist)' });
      console.log(`  SKIP  ${displayName} (404)`);
      return extractData(res);
    } else if (status) {
      results.pass.push({ name: displayName });
      console.log(`  PASS  ${displayName}`);
      return extractData(res);
    } else {
      const msg = getErrorMsg(res);
      results.fail.push({ name: displayName, error: msg });
      console.log(`  FAIL  ${displayName} — ${msg}`);
    }
  } catch (e) {
    results.fail.push({ name: displayName, error: e.message });
    console.log(`  ERR   ${displayName} — ${e.message}`);
  }
  return null;
}

// Shorthand: project-scoped test (uses project name string)
const P = TEST_PROJECT_NAME;
const AID = ACCOUNT_ID;

// ===========================================================================
console.log('\n=== AUTH / SETUP ===');
await test('startbcgpt', {});
await test('whoami', {});
await test('list_accounts', {});

// ===========================================================================
console.log('\n=== PROJECTS ===');
await test('list_projects', { account_id: AID });
// find_project expects exact name - use project_id for get_project
await test('find_project', { query: 'BCGPT TEST PROJECT' });
await test('get_project', { project_id: TEST_PROJECT_ID, account_id: AID });
await test('search_projects', { query: 'bcgpt', account_id: AID });
await test('list_templates', { account_id: AID }); // Basecamp project templates

// ===========================================================================
console.log('\n=== PEOPLE ===');
await test('search_people', { query: 'rohit', account_id: AID });
await test('list_all_people', { query: '', account_id: AID });
await test('get_my_profile', { account_id: AID });
await test('list_pingable_people', { account_id: AID });

// Get my person ID for person-scoped tests
const meRaw = await callTool('get_my_profile', { account_id: AID });
const meData = extractData(meRaw);
const meId = meData?.id;
const meName = meData?.name || 'rohit';
console.log(`  > My profile: "${meName}" (id=${meId})`);

if (meId) {
  await test('get_person', { account_id: AID, person_id: meId });
  await test('list_person_activity', { account_id: AID, person: meName });
  await test('list_person_projects', { account_id: AID, person: meName });
  await test('get_person_assignments', { account_id: AID, person_id: meId });
  await test('audit_person', { account_id: AID, person: meName });
  await test('summarize_person', { account_id: AID, person: meName });
  await test('report_todos_assigned_person', { account_id: AID, person_id: meId });
  await test('user_timeline', { account_id: AID, person_id: meId });
}

// ===========================================================================
console.log('\n=== REPORTS ===');
await test('daily_report', { account_id: AID });
await test('list_todos_due', { account_id: AID });
await test('assignment_report', { account_id: AID, project: P });
await test('report_todos_assigned', { account_id: AID });
await test('report_todos_overdue', { account_id: AID });
await test('report_schedules_upcoming', { account_id: AID, query: '' });
await test('report_timeline', { account_id: AID });
// Timesheet requires Basecamp admin
await test('list_timesheet_report', { account_id: AID });
await test('report_timesheet', { account_id: AID });

// ===========================================================================
console.log('\n=== PROJECT-SCOPED TOOLS ===');
await test('summarize_project', { project: P, account_id: AID });
await test('list_project_people', { project: P, account_id: AID });
await test('get_project_structure', { project: P, account_id: AID });
await test('project_timeline', { project: P, account_id: AID });
await test('project_timesheet', { project: P, account_id: AID });
await test('list_project_timesheet', { project: P, account_id: AID });
await test('search_project', { project: P, query: 'test', account_id: AID });
await test('update_project_people', { project: P, account_id: AID, grant: [], revoke: [] });
await test('get_project_construction', { project: P, account_id: AID });

// ===========================================================================
console.log('\n=== TODOS ===');
await test('list_todos_for_project', { project: P, account_id: AID });
await test('search_todos', { query: 'test', account_id: AID });
await test('list_assigned_to_me', { account_id: AID });

const todosetData = await test('get_todoset', { project: P, account_id: AID });

const todolistsData = await test('list_todolists', { project: P, account_id: AID });
let todolistId = null;
let todosetId = todosetData?.todoset?.id || todosetData?.id;
if (todolistsData) {
  const tdls = Array.isArray(todolistsData) ? todolistsData : (todolistsData.todolists || todolistsData.items || []);
  if (tdls.length > 0) todolistId = tdls[0].id;
}

if (todolistId) {
  console.log(`  > Using todolist id=${todolistId}`);
  await test('get_todolist', { project: P, todolist_id: todolistId, account_id: AID });
  const todosData = await test('list_todos_for_list', { project: P, todolist_id: todolistId, account_id: AID });

  // Create a todo
  const newTodoRes = await callTool('create_todo', {
    project: P,
    todolist_id: todolistId,
    content: 'bcgpt autotest todo',
    account_id: AID,
  });
  const newTodoId = extractData(newTodoRes)?.todo?.id || extractData(newTodoRes)?.id;
  if (newTodoId) {
    results.pass.push({ name: 'create_todo' });
    console.log('  PASS  create_todo');
    await test('get_todo', { project: P, todo_id: newTodoId, account_id: AID });
    await test('update_todo_details', { project: P, todo_id: newTodoId, content: 'bcgpt autotest updated', account_id: AID });
    await test('complete_todo', { project: P, todo_id: newTodoId, account_id: AID });
    await test('uncomplete_todo', { project: P, todo_id: newTodoId, account_id: AID });
    await test('summarize_todo', { project: P, todo_id: newTodoId, account_id: AID });
    await test('reposition_todo', { project: P, todo_id: newTodoId, position: 1, account_id: AID });
    await test('complete_task_by_name', { project: P, task_name: 'bcgpt autotest updated', account_id: AID });
  } else {
    results.fail.push({ name: 'create_todo', error: getErrorMsg(newTodoRes) });
    console.log('  FAIL  create_todo —', getErrorMsg(newTodoRes));
  }

  await test('list_todolist_groups', { project: P, todolist_id: todolistId, account_id: AID });

  // Create todolist
  if (todosetId) {
    const newTdlRes = await callTool('create_todolist', {
      project: P, todoset_id: todosetId,
      name: 'bcgpt autotest list', account_id: AID,
    });
    const newTdlId = extractData(newTdlRes)?.id;
    if (newTdlId) {
      results.pass.push({ name: 'create_todolist' });
      console.log('  PASS  create_todolist');
      await test('update_todolist', { project: P, todolist_id: newTdlId, name: 'bcgpt autotest updated', account_id: AID });
      await test('get_hill_chart', { project: P, todolist_id: newTdlId, account_id: AID });
    } else {
      results.fail.push({ name: 'create_todolist', error: getErrorMsg(newTdlRes) });
      console.log('  FAIL  create_todolist —', getErrorMsg(newTdlRes));
    }
  }
}

// Todolist group
if (todolistId) {
  const newGroupRes = await callTool('create_todolist_group', {
    project: P, todolist_id: todolistId,
    body: { name: 'bcgpt autotest group' }, account_id: AID,
  });
  const newGroupId = extractData(newGroupRes)?.group?.id || extractData(newGroupRes)?.id;
  if (newGroupId) {
    results.pass.push({ name: 'create_todolist_group' });
    console.log('  PASS  create_todolist_group');
    await test('get_todolist_group', { project: P, group_id: newGroupId, account_id: AID });
    await test('reposition_todolist_group', { project: P, group_id: newGroupId, position: 1, account_id: AID });
  } else {
    results.fail.push({ name: 'create_todolist_group', error: getErrorMsg(newGroupRes) });
    console.log('  FAIL  create_todolist_group —', getErrorMsg(newGroupRes));
  }
}

// ===========================================================================
console.log('\n=== MESSAGE BOARD ===');
const mbData = await test('get_message_board', { project: P, account_id: AID });
const messageBoardId = mbData?.message_board?.id || mbData?.id;

await test('list_message_types', { account_id: AID });

const msgsData = await test('list_messages', { project: P, account_id: AID });
let messageId = null;
if (msgsData) {
  const msgs = Array.isArray(msgsData) ? msgsData : (msgsData.messages || msgsData.items || []);
  if (msgs.length > 0) messageId = msgs[0].id;
}

if (messageBoardId) {
  const newMsgRes = await callTool('create_message', {
    project: P, message_board_id: messageBoardId,
    subject: 'bcgpt autotest message',
    content: '<p>Auto-generated test message.</p>',
    account_id: AID,
  });
  const newMsgId = extractData(newMsgRes)?.id;
  if (newMsgId) {
    results.pass.push({ name: 'create_message' });
    console.log('  PASS  create_message');
    messageId = messageId || newMsgId;
    await test('get_message', { project: P, message_id: newMsgId, account_id: AID });
    await test('update_message', { project: P, message_id: newMsgId, subject: 'bcgpt autotest updated', content: '<p>Updated.</p>', account_id: AID });
    await test('summarize_message', { project: P, message_id: newMsgId, account_id: AID });
    await test('pin_recording', { project: P, recording_id: newMsgId, account_id: AID });
    await test('unpin_recording', { project: P, recording_id: newMsgId, account_id: AID });
    await test('get_subscription', { project: P, recording_id: newMsgId, account_id: AID });
    await test('subscribe_recording', { project: P, recording_id: newMsgId, account_id: AID });
    await test('unsubscribe_recording', { project: P, recording_id: newMsgId, account_id: AID });
    await test('list_recording_events', { project: P, recording_id: newMsgId, account_id: AID });
  } else {
    results.fail.push({ name: 'create_message', error: getErrorMsg(newMsgRes) });
    console.log('  FAIL  create_message —', getErrorMsg(newMsgRes));
  }
}

// Message type CRUD (needs project + body)
const newMtRes = await callTool('create_message_type', {
  project: P, account_id: AID,
  body: { name: 'autotest-type', icon: '💬' },
});
const newMtId = extractData(newMtRes)?.message_type?.id || extractData(newMtRes)?.id;
if (newMtId) {
  results.pass.push({ name: 'create_message_type' });
  console.log('  PASS  create_message_type');
  await test('get_message_type', { account_id: AID, message_type_id: newMtId });
  await test('update_message_type', { account_id: AID, message_type_id: newMtId, name: 'autotest-updated', icon: '📝' });
  await test('delete_message_type', { account_id: AID, message_type_id: newMtId });
} else {
  results.fail.push({ name: 'create_message_type', error: getErrorMsg(newMtRes) });
  console.log('  FAIL  create_message_type —', getErrorMsg(newMtRes));
}

// ===========================================================================
console.log('\n=== COMMENTS ===');
if (messageId) {
  await test('list_comments', { project: P, recording_id: messageId, account_id: AID });
  const newCmtRes = await callTool('create_comment', {
    project: P, recording_id: messageId,
    content: '<p>Auto-test comment.</p>', account_id: AID,
  });
  const newCmtId = extractData(newCmtRes)?.id;
  if (newCmtId) {
    results.pass.push({ name: 'create_comment' });
    console.log('  PASS  create_comment');
    await test('get_comment', { project: P, comment_id: newCmtId, account_id: AID });
    await test('update_comment', { project: P, comment_id: newCmtId, content: '<p>Updated.</p>', account_id: AID });
  } else {
    results.fail.push({ name: 'create_comment', error: getErrorMsg(newCmtRes) });
    console.log('  FAIL  create_comment —', getErrorMsg(newCmtRes));
  }
}

// ===========================================================================
console.log('\n=== DOCUMENTS / VAULTS ===');
const vaultRaw = await test('get_vault', { project: P, account_id: AID });
const vaultId = vaultRaw?.vault?.id || vaultRaw?.id;

await test('list_vaults', { project: P, account_id: AID });
await test('list_documents', { project: P, account_id: AID });

if (vaultId) {
  await test('list_child_vaults', { project: P, vault_id: vaultId, account_id: AID });

  const newDocRes = await callTool('create_document', {
    project: P, vault_id: vaultId,
    title: 'bcgpt autotest doc',
    content: '<p>Auto-generated doc.</p>', account_id: AID,
  });
  const newDocId = extractData(newDocRes)?.id;
  if (newDocId) {
    results.pass.push({ name: 'create_document' });
    console.log('  PASS  create_document');
    await test('get_document', { project: P, document_id: newDocId, account_id: AID });
    await test('update_document', { project: P, document_id: newDocId, title: 'autotest updated', content: '<p>Updated.</p>', account_id: AID });
    await test('summarize_document', { project: P, document_id: newDocId, account_id: AID });
    await test('update_client_visibility', { project: P, recording_id: newDocId, visible_to_clients: false, account_id: AID });
    await test('archive_recording', { project: P, recording_id: newDocId, account_id: AID });
    await test('unarchive_recording', { project: P, recording_id: newDocId, account_id: AID });
    await test('trash_recording', { project: P, recording_id: newDocId, account_id: AID });
  } else {
    results.fail.push({ name: 'create_document', error: getErrorMsg(newDocRes) });
    console.log('  FAIL  create_document —', getErrorMsg(newDocRes));
  }

  const newVaultRes = await callTool('create_child_vault', {
    project: P, vault_id: vaultId, title: 'bcgpt autotest vault', account_id: AID,
  });
  const newVaultId = extractData(newVaultRes)?.id;
  if (newVaultId) {
    results.pass.push({ name: 'create_child_vault' });
    console.log('  PASS  create_child_vault');
    await test('update_vault', { project: P, vault_id: newVaultId, title: 'autotest vault updated', account_id: AID });
  } else {
    results.fail.push({ name: 'create_child_vault', error: getErrorMsg(newVaultRes) });
    console.log('  FAIL  create_child_vault —', getErrorMsg(newVaultRes));
  }
}

// ===========================================================================
console.log('\n=== UPLOADS ===');
await test('list_uploads', { project: P, account_id: AID });

// ===========================================================================
console.log('\n=== SCHEDULE ===');
const schedRaw = await test('get_schedule', { project: P, account_id: AID });
const schedId = schedRaw?.schedule?.id || schedRaw?.id;

await test('list_schedule_entries', { project: P, account_id: AID });

if (schedId) {
  await test('update_schedule', { project: P, schedule_id: schedId, account_id: AID });

  const newEntryRes = await callTool('create_schedule_entry', {
    project: P, schedule_id: schedId,
    body: {
      summary: 'bcgpt autotest event',
      starts_at: new Date(Date.now() + 86400000).toISOString(),
      ends_at: new Date(Date.now() + 90000000).toISOString(),
    },
    account_id: AID,
  });
  const newEntryId = extractData(newEntryRes)?.entry?.id || extractData(newEntryRes)?.id;
  if (newEntryId) {
    results.pass.push({ name: 'create_schedule_entry' });
    console.log('  PASS  create_schedule_entry');
    await test('get_schedule_entry', { project: P, entry_id: newEntryId, account_id: AID });
    await test('update_schedule_entry', {
      project: P, entry_id: newEntryId,
      body: {
        summary: 'updated event',
        starts_at: new Date(Date.now() + 86400000).toISOString(),
        ends_at: new Date(Date.now() + 90000000).toISOString(),
      },
      account_id: AID,
    });
  } else {
    results.fail.push({ name: 'create_schedule_entry', error: getErrorMsg(newEntryRes) });
    console.log('  FAIL  create_schedule_entry —', getErrorMsg(newEntryRes));
  }
}

// Lineup markers
await test('list_lineup_markers', { account_id: AID });
const newLmRes = await callTool('create_lineup_marker', {
  account_id: AID,
  body: {
    title: 'bcgpt autotest marker',
    starts_on: new Date(Date.now()).toISOString().slice(0, 10),
    ends_on: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    color: 'red',
  },
});
const newLmId = extractData(newLmRes)?.marker?.id || extractData(newLmRes)?.id;
if (newLmId) {
  results.pass.push({ name: 'create_lineup_marker' });
  console.log('  PASS  create_lineup_marker');
  await test('update_lineup_marker', { account_id: AID, marker_id: newLmId, title: 'updated marker' });
  await test('delete_lineup_marker', { account_id: AID, marker_id: newLmId });
} else {
  results.fail.push({ name: 'create_lineup_marker', error: getErrorMsg(newLmRes) });
  console.log('  FAIL  create_lineup_marker —', getErrorMsg(newLmRes));
}

// ===========================================================================
console.log('\n=== CARD TABLES ===');
const ctListData = await test('list_card_tables', { project: P, account_id: AID });
let cardTableId = null, cardColumnId = null;
if (ctListData) {
  const cts = Array.isArray(ctListData) ? ctListData : (ctListData.card_tables || ctListData.items || []);
  if (cts.length > 0) cardTableId = cts[0].id;
}

if (cardTableId) {
  await test('get_card_table', { project: P, card_table_id: cardTableId, account_id: AID });
  await test('list_card_table_columns', { project: P, card_table_id: cardTableId, account_id: AID });
  await test('list_card_table_cards', { project: P, card_table_id: cardTableId, account_id: AID });
  await test('list_card_table_summaries', { project: P, card_table_id: cardTableId, account_id: AID });
  await test('list_project_card_table_contents', { project: P, account_id: AID });

  const colsRaw = await callTool('list_card_table_columns', { project: P, card_table_id: cardTableId, account_id: AID });
  const colsData = extractData(colsRaw);
  const colsArr = Array.isArray(colsData) ? colsData : (colsData?.columns || colsData?.items || []);
  if (colsArr.length > 0) cardColumnId = colsArr[0].id;

  if (cardColumnId) {
    await test('get_card_table_column', { project: P, column_id: cardColumnId, account_id: AID });
    await test('subscribe_card_table_column', { project: P, column_id: cardColumnId, account_id: AID });
    await test('unsubscribe_card_table_column', { project: P, column_id: cardColumnId, account_id: AID });

    // Create column (body param required)
    const newColRes = await callTool('create_card_table_column', {
      project: P, card_table_id: cardTableId,
      body: { title: 'autotest col' }, account_id: AID,
    });
    const newColId = extractData(newColRes)?.column?.id || extractData(newColRes)?.id;
    if (newColId) {
      results.pass.push({ name: 'create_card_table_column' });
      console.log('  PASS  create_card_table_column');
      await test('update_card_table_column', { project: P, column_id: newColId, body: { title: 'updated col' }, account_id: AID });
      await test('update_card_table_column_color', { project: P, column_id: newColId, body: { color: 'blue' }, account_id: AID });
      await test('move_card_table_column', { project: P, column_id: newColId, position: 1, account_id: AID });
    } else {
      results.fail.push({ name: 'create_card_table_column', error: getErrorMsg(newColRes) });
      console.log('  FAIL  create_card_table_column —', getErrorMsg(newColRes));
    }

    // Create card
    const newCardRes = await callTool('create_card', {
      project: P, column_id: cardColumnId, title: 'bcgpt autotest card', account_id: AID,
    });
    const newCardId = extractData(newCardRes)?.card?.id || extractData(newCardRes)?.id;
    if (newCardId) {
      results.pass.push({ name: 'create_card' });
      console.log('  PASS  create_card');
      await test('get_card', { project: P, card_id: newCardId, account_id: AID });
      await test('update_card', { project: P, card_id: newCardId, body: { title: 'bcgpt autotest updated' }, account_id: AID });
      await test('summarize_card', { project: P, card_id: newCardId, account_id: AID });

      await test('list_card_steps', { project: P, card_id: newCardId, account_id: AID });
      const newStepRes = await callTool('create_card_step', {
        project: P, card_id: newCardId, body: { title: 'autotest step' }, account_id: AID,
      });
      const stepId = extractData(newStepRes)?.id;
      if (stepId) {
        results.pass.push({ name: 'create_card_step' });
        console.log('  PASS  create_card_step');
        await test('update_card_step', { project: P, card_id: newCardId, step_id: stepId, body: { title: 'updated step' }, account_id: AID });
        await test('complete_card_step', { project: P, card_id: newCardId, step_id: stepId, account_id: AID });
        await test('uncomplete_card_step', { project: P, card_id: newCardId, step_id: stepId, account_id: AID });
        await test('reposition_card_step', { project: P, card_id: newCardId, step_id: stepId, position: 1, account_id: AID });
      } else {
        results.fail.push({ name: 'create_card_step', error: getErrorMsg(newStepRes) });
        console.log('  FAIL  create_card_step —', getErrorMsg(newStepRes));
      }

      if (colsArr.length > 1) {
        await test('move_card', { project: P, card_id: newCardId, column_id: colsArr[1].id, account_id: AID });
      }
      await test('archive_card', { project: P, card_id: newCardId, account_id: AID });
      await test('unarchive_card', { project: P, card_id: newCardId, account_id: AID });
      await test('trash_card', { project: P, card_id: newCardId, account_id: AID });
    } else {
      results.fail.push({ name: 'create_card', error: getErrorMsg(newCardRes) });
      console.log('  FAIL  create_card —', getErrorMsg(newCardRes));
    }
  }

  // Card table on-hold
  await test('create_card_table_on_hold', { project: P, card_table_id: cardTableId, account_id: AID });
  await test('delete_card_table_on_hold', { project: P, card_table_id: cardTableId, account_id: AID });
}

// Dock tools
console.log('\n=== DOCK TOOLS ===');
await test('get_dock_tool', { project: P, dock_name: 'todoset', account_id: AID });
await test('list_card_table_summaries_iter', { project: P, account_id: AID });

// ===========================================================================
console.log('\n=== CAMPFIRES ===');
await test('list_campfires', { account_id: AID });

const campsRaw = await callTool('list_campfires', { account_id: AID });
const campsData = extractData(campsRaw);
const campsArr = Array.isArray(campsData) ? campsData : (campsData?.campfires || campsData?.items || []);
if (campsArr.length > 0) {
  const camp = campsArr[0];
  const campBucketId = camp.bucket?.id || TEST_PROJECT_ID;
  const campfireId = camp.id;
  await test('get_campfire', { project: P, campfire_id: campfireId, account_id: AID });

  const newLineRes = await callTool('create_campfire_line', {
    project: P, campfire_id: campfireId,
    content: 'bcgpt autotest campfire line', account_id: AID,
  });
  const lineId = extractData(newLineRes)?.id;
  if (lineId) {
    results.pass.push({ name: 'create_campfire_line' });
    console.log('  PASS  create_campfire_line');
    await test('list_campfire_lines', { project: P, campfire_id: campfireId, account_id: AID });
    await test('get_campfire_line', { project: P, campfire_id: campfireId, line_id: lineId, account_id: AID });
    await test('delete_campfire_line', { project: P, campfire_id: campfireId, line_id: lineId, account_id: AID });
  } else {
    results.fail.push({ name: 'create_campfire_line', error: getErrorMsg(newLineRes) });
    console.log('  FAIL  create_campfire_line —', getErrorMsg(newLineRes));
  }
}

// Chatbots
await test('list_chatbots', { project: P, account_id: AID });

// ===========================================================================
console.log('\n=== WEBHOOKS ===');
await test('list_webhooks', { project: P, account_id: AID });

const newWebhookRes = await callTool('create_webhook', {
  project: P, account_id: AID,
  body: { payload_url: 'https://example.com/webhook', types: ['Todo'] },
});
const newWebhookId = extractData(newWebhookRes)?.webhook?.id || extractData(newWebhookRes)?.id;
if (newWebhookId) {
  results.pass.push({ name: 'create_webhook' });
  console.log('  PASS  create_webhook');
  await test('get_webhook', { project: P, webhook_id: newWebhookId, account_id: AID });
  await test('update_webhook', { project: P, webhook_id: newWebhookId, body: { payload_url: 'https://example.com/webhook2', types: ['Todo'] }, account_id: AID });
  await test('delete_webhook', { project: P, webhook_id: newWebhookId, account_id: AID });
} else {
  results.fail.push({ name: 'create_webhook', error: getErrorMsg(newWebhookRes) });
  console.log('  FAIL  create_webhook —', getErrorMsg(newWebhookRes));
}

// ===========================================================================
console.log('\n=== QUESTIONNAIRES / CHECK-INS ===');
const qRaw = await test('get_questionnaire', { project: P, account_id: AID });
const qId = qRaw?.questionnaire?.id || qRaw?.id;

await test('list_questions', { project: P, account_id: AID });
await test('list_question_reminders', { project: P, account_id: AID });

if (qId) {
  const newQRes = await callTool('create_question', {
    project: P, questionnaire_id: qId,
    title: 'bcgpt autotest check-in', schedule: 'daily', account_id: AID,
  });
  const newQId = extractData(newQRes)?.id;
  if (newQId) {
    results.pass.push({ name: 'create_question' });
    console.log('  PASS  create_question');
    await test('get_question', { project: P, question_id: newQId, account_id: AID });
    await test('update_question', { project: P, question_id: newQId, title: 'updated check-in', schedule: 'weekly', account_id: AID });
    await test('list_question_answers', { project: P, question_id: newQId, account_id: AID });
    await test('pause_question', { project: P, question_id: newQId, account_id: AID });
    await test('resume_question', { project: P, question_id: newQId, account_id: AID });
    await test('list_question_answers_by', { project: P, question_id: newQId, account_id: AID });
    await test('list_question_answers_by_person', { project: P, question_id: newQId, account_id: AID });
  } else {
    results.fail.push({ name: 'create_question', error: getErrorMsg(newQRes) });
    console.log('  FAIL  create_question —', getErrorMsg(newQRes));
  }
}

// ===========================================================================
console.log('\n=== INBOX ===');
await test('list_inboxes', { project: P, account_id: AID });
await test('get_inbox', { project: P, account_id: AID });
await test('list_inbox_forwards', { project: P, account_id: AID });

// ===========================================================================
console.log('\n=== CLIENT ===');
await test('list_client_correspondences', { project: P, account_id: AID });
await test('list_client_approvals', { project: P, account_id: AID });

// ===========================================================================
console.log('\n=== RECORDINGS ===');
await test('get_recordings', { project: P, type: 'Todo', account_id: AID });

// ===========================================================================
console.log('\n=== SEARCH ===');
await test('search_todos', { query: 'test', account_id: AID });
await test('search_cards', { query: 'test', account_id: AID });
await test('search_recordings', { query: 'test', account_id: AID });
await test('search_entities', { query: 'test', account_id: AID });
await test('search_metadata', { query: 'test', account_id: AID });
await test('search_people', { query: 'rohit', account_id: AID });

// ===========================================================================
console.log('\n=== SMART / AI TOOLS ===');
await test('smart_action', { query: 'list todos in BCGPT TEST PROJECT', account_id: AID });
await test('summarize_project', { project: P, account_id: AID });
await test('daily_report', { account_id: AID });

// ===========================================================================
console.log('\n=== ENTITY RESOLUTION ===');
await test('resolve_entity_from_url', { url: `https://3.basecamp.com/${AID}/projects/${TEST_PROJECT_ID}` });
await test('search_entities', { query: 'bcgpt', account_id: AID });

// ===========================================================================
console.log('\n=== RAW API TOOLS ===');
await test('basecamp_request', { path: '/projects.json', account_id: AID });
await test('basecamp_raw', { path: `/projects.json`, account_id: AID });
await test('mcp_call', { tool: 'list_projects', args: { account_id: AID } });

// ===========================================================================
console.log('\n=== API ENDPOINT TOOLS ===');
await test('api_get_projects', { account_id: AID });
await test('api_get_people', { account_id: AID });
await test('api_get_projects_by_project_id', { project_id: String(TEST_PROJECT_ID), account_id: AID });
await test('api_get_reports_todos_assigned', { account_id: AID });
await test('api_get_reports_todos_overdue', { account_id: AID });
await test('api_get_reports_timesheet', { account_id: AID });
await test('api_get_reports_schedules_upcoming', { account_id: AID });
await test('api_get_reports_progress', { account_id: AID });
await test('api_get_chats', { account_id: AID });
await test('api_get_templates', { account_id: AID });
await test('api_get_my_question_reminders', { account_id: AID });

// Bucket-scoped endpoint tools (need bucket_id = project numeric ID for endpoint tools)
const bid = String(TEST_PROJECT_ID);
await test('api_get_buckets_by_bucket_id_categories', { bucket_id: bid, account_id: AID });
await test('api_get_buckets_by_bucket_id_message_boards_by_message_board_id', {
  bucket_id: bid, message_board_id: String(messageBoardId || ''), account_id: AID
});
await test('api_get_buckets_by_bucket_id_chats_by_id', { bucket_id: bid, id: bid, account_id: AID });
await test('api_get_buckets_by_bucket_id_client_approvals', { bucket_id: bid, account_id: AID });
await test('api_get_buckets_by_bucket_id_client_correspondences', { bucket_id: bid, account_id: AID });
await test('api_get_buckets_by_bucket_id_inboxes_by_inbox_id', { bucket_id: bid, inbox_id: bid, account_id: AID });
await test('api_get_buckets_by_bucket_id_questionnaires_by_questionnaire_id', { bucket_id: bid, questionnaire_id: String(qId || ''), account_id: AID });
await test('api_get_buckets_by_bucket_id_schedules_by_schedule_id', { bucket_id: bid, schedule_id: String(schedId || ''), account_id: AID });
await test('api_get_buckets_by_bucket_id_todosets_by_todoset_id', { bucket_id: bid, todoset_id: String(todosetId || ''), account_id: AID });
await test('api_get_buckets_by_bucket_id_vaults_by_vault_id', { bucket_id: bid, vault_id: String(vaultId || ''), account_id: AID });
await test('api_get_buckets_by_bucket_id_webhooks_by_webhook_id', { bucket_id: bid, webhook_id: '1', account_id: AID }); // likely 404

// A few more endpoint tools
await test('api_get_projects_by_project_id_timeline', { project_id: bid, account_id: AID });
await test('api_get_projects_by_project_id_timesheet', { project_id: bid, account_id: AID });

// ===========================================================================
// Final Report
// ===========================================================================
console.log('\n\n====== FINAL RESULTS ======');
console.log(`PASS: ${results.pass.length}`);
console.log(`FAIL: ${results.fail.length}`);
console.log(`SKIP: ${results.skip.length}`);
console.log(`TOTAL tested: ${results.pass.length + results.fail.length + results.skip.length}`);

if (results.fail.length > 0) {
  console.log('\n--- FAILURES ---');
  for (const f of results.fail) {
    console.log(`  FAIL  ${f.name}: ${f.error}`);
  }
}
if (results.skip.length > 0) {
  console.log('\n--- SKIPPED (404) ---');
  for (const s of results.skip) {
    console.log(`  SKIP  ${s.name}: ${s.reason}`);
  }
}
console.log('\n--- PASSED ---');
for (const p of results.pass) {
  console.log(`  PASS  ${p.name}`);
}
