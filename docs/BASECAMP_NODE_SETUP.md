# Basecamp n8n Node Setup Guide

**Last Updated:** 2026-02-17
**Related:** [`N8N_INTEGRATION_GUIDE.md`](N8N_INTEGRATION_GUIDE.md)

---

## Overview

The Basecamp n8n node is a custom node that allows n8n workflows to interact with Basecamp 3/4 through the BCGPT gateway. This enables seamless integration between OpenClaw and Basecamp.

---

## Node Location

```
n8n-nodes-basecamp/
  credentials/
    BasecampApi.credentials.ts    # OAuth/API key credentials
  nodes/
    Basecamp/
      Basecamp.node.ts            # Main node implementation
      GenericFunctions.ts         # API helper functions
  package.json
  README.md
  tsconfig.json
  gulpfile.js
```

---

## Supported Resources

### Projects
| Operation | Description |
|-----------|-------------|
| Get Many | List all projects |
| Get | Get single project by ID |
| Create | Create new project |
| Update | Update project properties |

### Todos
| Operation | Description |
|-----------|-------------|
| Get Many | List todos in a project/todolist |
| Get | Get single todo by ID |
| Create | Create new todo |
| Update | Update todo properties |
| Delete | Delete a todo |
| Complete | Mark todo as complete |

### Todo Lists
| Operation | Description |
|-----------|-------------|
| Get Many | List todo lists in a project |
| Get | Get single todo list by ID |
| Create | Create new todo list |
| Update | Update todo list properties |
| Delete | Delete a todo list |

### Messages
| Operation | Description |
|-----------|-------------|
| Get Many | List messages in a project |
| Get | Get single message by ID |
| Create | Create new message |
| Update | Update message content |
| Delete | Delete a message |

### Cards (Kanban)
| Operation | Description |
|-----------|-------------|
| Get Many | List cards in a card table |
| Get | Get single card by ID |
| Create | Create new card |
| Update | Update card properties |
| Move | Move card between columns |

### Comments
| Operation | Description |
|-----------|-------------|
| Get Many | List comments on a resource |
| Create | Add comment to resource |
| Delete | Delete a comment |

### Documents
| Operation | Description |
|-----------|-------------|
| Get Many | List documents in a project |
| Get | Get single document by ID |
| Create | Create new document |
| Update | Update document content |

### Files
| Operation | Description |
|-----------|-------------|
| Get Many | List files in a project |
| Get | Download file |
| Upload | Upload new file |

### People
| Operation | Description |
|-----------|-------------|
| Get Many | List people in account/project |
| Get | Get single person by ID |

---

## Installation

### Local Development

```bash
# Navigate to node directory
cd n8n-nodes-basecamp

# Install dependencies
npm install

# Build the node
npm run build

# Link for local testing
npm link
```

### Link to n8n

```bash
# In n8n installation directory
cd /path/to/n8n
npm link @wickedlab/n8n-nodes-basecamp

# Restart n8n
n8n start
```

### Production Deployment

```bash
# Publish to npm
cd n8n-nodes-basecamp
npm publish --access public

# Install in n8n
npm install @wickedlab/n8n-nodes-basecamp
```

---

## Credentials Setup

### Credential Type

The node uses `BasecampApi` credentials defined in [`credentials/BasecampApi.credentials.ts`](../n8n-nodes-basecamp/credentials/BasecampApi.credentials.ts).

### Required Fields

| Field | Description |
|-------|-------------|
| Account ID | Basecamp account ID |
| Access Token | OAuth access token or API key |
| Client ID | OAuth client ID (if using OAuth) |
| Client Secret | OAuth client secret (if using OAuth) |

### Authentication Flow

1. Create Basecamp OAuth application at https://launchpad.37signals.com/integrations
2. Configure callback URL
3. Enter credentials in n8n
4. Node handles OAuth flow automatically

---

## Usage Examples

### Example 1: Create Todo on New GitHub Issue

```yaml
# Workflow: GitHub Issue -> Basecamp Todo
Trigger:
  type: GitHub Trigger
  event: new_issue

Action:
  type: Basecamp
  resource: todo
  operation: create
  parameters:
    projectId: "12345"
    todolistId: "67890"
    content: "{{$json.issue.title}}"
    description: "{{$json.issue.body}}"
    assigneeIds: ["123"]
    dueOn: "{{$json.issue.due_date}}"
```

### Example 2: Daily Project Summary

```yaml
# Workflow: Daily Summary to Basecamp Message
Trigger:
  type: Schedule
  cron: "0 9 * * *"

Action 1:
  type: Basecamp
  resource: todo
  operation: getMany
  parameters:
    projectId: "12345"
    completed: false

Action 2:
  type: Basecamp
  resource: message
  operation: create
  parameters:
    projectId: "12345"
    subject: "Daily Summary - {{new Date().toDateString()}}"
    content: |
      ## Open Todos
      {{#each $json.todos}}
      - {{title}} ({{assignee_names}})
      {{/each}}
```

### Example 3: Sync Todo Completion to Slack

```yaml
# Workflow: Todo Completed -> Slack Notification
Trigger:
  type: Basecamp Webhook
  event: todo_completed

Action:
  type: Slack
  operation: sendMessage
  parameters:
    channel: "#project-updates"
    text: "Todo completed: {{$json.todo.title}}"
```

---

## Node Configuration

### Node Properties

Defined in [`Basecamp.node.ts`](../n8n-nodes-basecamp/nodes/Basecamp/Basecamp.node.ts):

```typescript
{
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
    // Resource selector
    // Operation selector
    // Resource-specific fields
  ]
}
```

### Generic Functions

Located in [`GenericFunctions.ts`](../n8n-nodes-basecamp/nodes/Basecamp/GenericFunctions.ts):

```typescript
// API call wrapper
export async function callBcgptTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown>

// Load options for dropdowns
export async function getProjects(
  this: ILoadOptionsFunctions
): Promise<INodePropertyOptions[]>

export async function getTodolists(
  this: ILoadOptionsFunctions
): Promise<INodePropertyOptions[]>
```

---

## Testing

### Unit Tests

```bash
# Run node tests
cd n8n-nodes-basecamp
npm test
```

### Integration Testing

1. Create test workflow in n8n
2. Configure Basecamp credentials
3. Execute each operation
4. Verify results in Basecamp

### Test Checklist

- [ ] List projects returns all accessible projects
- [ ] Create todo creates todo in correct todolist
- [ ] Update todo modifies properties correctly
- [ ] Complete todo marks as done
- [ ] Create message posts to correct message board
- [ ] List comments returns all comments
- [ ] Error handling for invalid IDs
- [ ] Error handling for unauthorized access

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Node not appearing | Rebuild node, restart n8n |
| Authentication failed | Check credentials, verify OAuth setup |
| API errors | Check Basecamp API status, verify account ID |
| Missing resources | Verify user has access to project/resource |

### Debug Mode

```bash
# Enable n8n debug logging
N8N_LOG_LEVEL=debug n8n start

# Check node execution logs
# In n8n UI: Executions -> Select execution -> View logs
```

---

## Publishing to n8n Community

### Requirements

1. Node must follow n8n community node guidelines
2. Package name must start with `n8n-nodes-`
3. Include comprehensive README
4. Include icon (SVG preferred)
5. All tests passing

### Submission Process

1. Publish to npm
   ```bash
   npm publish --access public
   ```

2. Submit to n8n community
   - Create PR to [n8n-io/n8n](https://github.com/n8n-io/n8n)
   - Add node to `packages/nodes-base/package.json`
   - Include documentation

3. After approval, node appears in n8n community nodes

---

## Future Enhancements

1. **Webhook Triggers** - Native Basecamp webhook support
2. **Batch Operations** - Create multiple todos in one call
3. **Advanced Filtering** - Filter by assignee, due date, status
4. **Template Support** - Pre-configured workflow templates
5. **Card Table Support** - Full Kanban card operations