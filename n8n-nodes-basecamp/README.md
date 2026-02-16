# n8n-nodes-basecamp

n8n community node for Basecamp 3/4 integration via BCGPT Gateway.

## Features

- ✅ **Complete Basecamp API Coverage** via BCGPT Gateway
- ✅ **Project Management** - Create, update, list, and manage projects
- ✅ **Todo Management** - Full todo CRUD + complete/uncomplete
- ✅ **Messages** - Post and manage message board messages
- ✅ **Cards** - Manage Kanban cards
- ✅ **Comments** - Add comments to any resource
- ✅ **Documents & Files** - Upload and manage files
- ✅ **People** - Manage project access
- ✅ **And more!** - Schedule, reports, admin actions

## Prerequisites

- **n8n** instance (self-hosted or cloud)
- **BCGPT Gateway** - Running at bcgpt.wickedlab.io or your own instance
- **BCGPT API Key** - Get yours at https://bcgpt.wickedlab.io/connect

## Installation

### Community Nodes (n8n Cloud / Self-Hosted)

1. In n8n, go to **Settings** → **Community Nodes**
2. Search for `n8n-nodes-basecamp`
3. Click **Install**

### Manual Installation (Self-Hosted)

```bash
# Navigate to your n8n installation
cd ~/.n8n

# Install the package
npm install n8n-nodes-basecamp

# Restart n8n
n8n restart
```

### Docker Installation

Add to your `docker-compose.yml`:

```yaml
environment:
  - N8N_COMMUNITY_PACKAGES=n8n-nodes-basecamp
```

Or install after container is running:

```bash
docker exec -it n8n npm install n8n-nodes-basecamp
docker restart n8n
```

## Configuration

### 1. Get BCGPT API Key

1. Visit https://bcgpt.wickedlab.io/connect
2. Sign in with your Basecamp account
3. Copy your API key

### 2. Add Credentials in n8n

1. Create new **Basecamp API** credential
2. Enter:
   - **BCGPT Base URL:** `https://bcgpt.wickedlab.io` (or your instance)
   - **API Key:** Your key from step 1
3. Test the connection

## Usage

### Example 1: Create a Todo

```
1. Add "Basecamp" node
2. Select Resource: Todo
3. Select Operation: Create
4. Select Project (dropdown auto-loads)
5. Select Todo List (dropdown auto-loads)
6. Enter Content: "Ship new feature"
7. (Optional) Set due date, assignees
8. Execute!
```

### Example 2: List Projects

```
1. Add "Basecamp" node
2. Select Resource: Project
3. Select Operation: Get Many
4. (Optional) Enable "Include Archived"
5. Execute → Returns all projects
```

### Example 3: Post Message

```
1. Add "Basecamp" node
2. Select Resource: Message
3. Select Operation: Create
4. Select Project
5. Enter Subject: "Weekly Update"
6. Enter Content: "Here's what we shipped..."
7. Execute!
```

## Available Resources

- **Project** - List, get, create, update, trash, find by name
- **Todo** - Create, get, update, complete, uncomplete, delete
- **Todo List** - List, create, update, delete
- **Message** - Create, get, update, delete
- **Card** - Create, update, move, delete
- **Comment** - Create, update, delete
- **Document** - Create, update, delete
- **File** - Upload, delete, search
- **Person** - List, manage access

## Architecture

```
n8n → n8n-nodes-basecamp → BCGPT Gateway → Basecamp API
```

This node communicates with BCGPT Gateway, which:
- Handles Basecamp OAuth authentication
- Manages API rate limits
- Provides intelligent caching
- Offers advanced features (search, summarization, etc.)

## Development

```bash
# Clone repo
git clone https://github.com/wickeddevsupport/bcgpt.git
cd bcgpt/n8n-nodes-basecamp

# Install dependencies
npm install

# Build
npm run build

# Link for local testing
npm link
cd ~/.n8n
npm link n8n-nodes-basecamp
```

## Troubleshooting

### "Connection Failed"
- Verify BCGPT base URL is correct
- Check API key is valid (test at bcgpt.wickedlab.io)
- Ensure BCGPT gateway is reachable

### "Project dropdown is empty"
- Test connection in credential settings
- Verify you have Basecamp projects
- Check BCGPT logs for errors

### "Unknown tool" error
- Update BCGPT to latest version
- Verify BCGPT has the requested tool installed

## License

MIT

## Credits

Built by [Wicked Dev Support](https://wickedlab.io)
Powered by [BCGPT Gateway](https://bcgpt.wickedlab.io)

## Links

- [BCGPT GitHub](https://github.com/wickeddevsupport/bcgpt)
- [n8n Documentation](https://docs.n8n.io)
- [Basecamp API Docs](https://github.com/basecamp/bc3-api)
