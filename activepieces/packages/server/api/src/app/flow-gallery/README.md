# Flow Gallery Module

## Overview

The **Flow Gallery** module is a public-facing app store for Activepieces, enabling users to discover and execute workflow templates without authentication.

**Location**: `flow.wickedlab.io/apps`  
**Architecture**: Standalone Fastify/Express module integrated into Activepieces server  
**Status**: MVP (Milestone 1 Complete)

---

## Purpose

Transform Activepieces templates into publicly accessible workflow applications with:
- Gallery UI for browsing published templates
- Simple form-based execution interface  
- Real-time workflow execution with user feedback
- Public API for app discovery

---

## Module Structure

```
flow-gallery/
├── flow-gallery.controller.ts      # HTTP routes & HTML pages
├── flow-gallery.service.ts         # Business logic & template queries
├── flow-gallery.entity.ts          # Database schema (gallery metadata)
├── flow-gallery.module.ts          # Module registration
└── README.md                        # This file
```

---

## Key Files

### `flow-gallery.controller.ts`
Handles all HTTP routes and serves public pages:

- **GET `/apps`** - Gallery home page (HTML UI with search)
- **GET `/apps/api/apps`** - JSON API for app discovery
- **GET `/apps/:id`** - App runtime page (form-based execution UI)
- **POST `/apps/:id/execute`** - Execute workflow with user inputs

**Features**:
- Responsive gradient UI matching Activepieces branding
- Client-side search filtering
- Form generation from template schemas
- Result display with JSON formatting
- Error handling and user feedback

### `flow-gallery.service.ts`
Core business logic:

```typescript
listPublicApps()          // Filter & paginate published templates
getPublicApp()            // Fetch single app with gallery metadata
getAppFlowSchema()        // Extract input schema for forms
logExecution()            // Track usage analytics
```

**Database Queries**:
- Filters by `status: PUBLISHED`
- Filters by `type: [OFFICIAL, SHARED]`
- Supports search, category, featured flags
- Pagination support

### `flow-gallery.entity.ts`
**Gallery App Schema** (extends Template system):

```typescript
flow_gallery_app {
  id: string                // Unique identifier
  templateId: string        // Reference to template
  platformId: string | null // Multi-tenancy support
  featured: boolean         // Feature flag
  displayOrder: number      // Sort order
  description: string       // Gallery-specific description
  icon: string | null       // Custom icon URL
  category: string          // Category grouping
  tags: string[]            // Search/filtering tags
}
```

### `flow-gallery.module.ts`
Registers the controller with the Activepieces app under `/apps` prefix.

---

## Integration Points

### 1. **Template System** (Dependency)
- Queries existing `template` table
- Uses template `flows`, `status`, `type` fields
- Respects `TemplateStatus.PUBLISHED` and `TemplateType` enums

### 2. **Fastify Server** (Parent Container)
- Registered in `app.ts` setupApp function
- Uses Fastify's type providers (TypeBox)
- Integrated with auth middleware (public endpoints bypass)

### 3. **Database** (TypeORM)
- Uses existing connection pool
- Migration system for schema changes
- Supports PostgreSQL and other TypeORM databases

---

## API Endpoints

### Public Routes (No Auth Required)

#### `GET /apps` - Gallery Home Page
Returns HTML page with app cards, search bar, and navigation.

**Response**: HTML page (StatusCode: 200)

#### `GET /apps/api/apps` - List Apps (JSON)
```
GET /apps/api/apps?search=text&category=PRODUCTIVITY&limit=20&cursor=...

Query Parameters:
- search: string (optional) - Search templates by name/description
- category: string (optional) - Filter by category
- featured: boolean (optional) - Show only featured apps
- limit: number (default: 20) - Results per page
- cursor: string (optional) - Pagination cursor

Response:
{
  "data": [Template[], ...],
  "cursor": "next_cursor_token",
  "hasMore": boolean
}
```

#### `GET /apps/:id` - App Runtime Page
Returns HTML form for executing specific app.

**Response**: HTML page (StatusCode: 200)

#### `POST /apps/:id/execute` - Execute Workflow
```
POST /apps/:id/execute
Content-Type: application/json

Body:
{
  "inputs": {
    "input_field_1": "value1",
    "input_field_2": "value2"
  }
}

Response:
{
  "output": {              // Workflow output
    "type": "text",
    "data": "..."
  },
  "executionTime": 1234   // Milliseconds
}
```

---

## Database Schema

### `flow_gallery_app` Table
```sql
CREATE TABLE "flow_gallery_app" (
    "id" character varying(21) PRIMARY KEY,
    "created" TIMESTAMP DEFAULT now(),
    "updated" TIMESTAMP DEFAULT now(),
    "templateId" character varying NOT NULL,
    "platformId" character varying,
    "featured" boolean DEFAULT false,
    "displayOrder" integer DEFAULT 0,
    "description" character varying,
    "icon" character varying,
    "category" character varying,
    "tags" character varying[] array
);

-- Indices for performance
CREATE INDEX "idx_flow_gallery_app_platform_id_featured" 
  ON "flow_gallery_app" ("platformId", "featured");
CREATE INDEX "idx_flow_gallery_app_display_order" 
  ON "flow_gallery_app" ("displayOrder");
CREATE INDEX "idx_flow_gallery_app_category" 
  ON "flow_gallery_app" ("category");

-- Foreign key
ALTER TABLE "flow_gallery_app"
ADD CONSTRAINT "fk_flow_gallery_app_platform_id"
FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE;
```

---

## Feature Roadmap

### Milestone 1 (Complete ✓)
- [x] Gallery UI with app cards
- [x] Search and filtering
- [x] App runtime pages
- [x] Form-based execution
- [x] Public API endpoints
- [x] Database schema & migrations

### Milestone 2 (Next)
- [x] Creator authentication (publisher APIs are authenticated)
- [ ] Creator dashboard UI
- [x] App publishing API
- [ ] Rating/review system
- [ ] Webhook execution integration
- [ ] Result formatting per output type
- [ ] Execution history tracking

### Milestone 2 - Publisher API (Implemented)

Authenticated routes under `/apps/api/publisher`:

- `GET /apps/api/publisher/apps` - list current platform's published apps
- `GET /apps/api/publisher/templates` - list eligible templates to publish
- `POST /apps/api/publisher/publish` - publish/update template as app metadata
- `PUT /apps/api/publisher/apps/:templateId` - update app metadata
- `DELETE /apps/api/publisher/apps/:templateId` - unpublish app

Publisher metadata now supports:
- `flowId`
- `inputSchema`
- `outputType`
- `outputSchema`
- `publishedBy`

### Milestone 3 (Future)
- [ ] Analytics dashboard
- [ ] Advanced filtering (tags, ratings)
- [ ] App versioning
- [ ] Monetization features
- [ ] Share & embed workflows
- [ ] API key authentication

### Phase 4 (Long-term)
- [ ] Mobile app support
- [ ] Scheduled execution
- [ ] Integration with third-party services
- [ ] Community features (comments, forks)

---

## Configuration

### Environment Variables
```env
# Activepieces standard configuration applies
# No additional environment variables required for MVP
```

### Route Configuration
```typescript
// In app.ts:
await app.register(flowGalleryModule)  // Mounts at /apps
```

---

## Usage Examples

### Publish a Template as Public App
1. Create a template in Activepieces UI
2. Set status to `PUBLISHED`
3. Set type to `SHARED` or `OFFICIAL`
4. Optionally create gallery metadata in `flow_gallery_app` table
5. App automatically appears in public gallery

### Discover Apps
```bash
# Visit gallery home
https://flow.wickedlab.io/apps

# Search for productivity apps
https://flow.wickedlab.io/apps/api/apps?search=productivity

# Get specific app
https://flow.wickedlab.io/apps/my-app-id
```

### Execute App
```javascript
const response = await fetch('https://flow.wickedlab.io/apps/my-app-id/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    inputs: { name: 'John', email: 'john@example.com' }
  })
});

const result = await response.json();
console.log(result.output);  // Workflow result
```

---

## Testing

### Manual Testing Checklist

- [ ] Gallery loads without authentication
- [ ] Search filters work correctly
- [ ] App cards display properly on mobile
- [ ] App runtime page loads form inputs
- [ ] Workflow execution completes
- [ ] Results display correctly
- [ ] Error handling shows friendly messages
- [ ] JSON API returns correct paginated data

### API Testing

```bash
# List apps
curl https://flow.wickedlab.io/apps/api/apps

# Search apps
curl "https://flow.wickedlab.io/apps/api/apps?search=test"

# Execute app
curl -X POST https://flow.wickedlab.io/apps/test-app-id/execute \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"field": "value"}}'
```

---

## Performance Considerations

- **Pagination**: Results limited to 20-100 per page
- **Caching**: Consider adding template metadata cache
- **Indices**: Indexed on `platformId`, `featured`, `displayOrder`, `category`
- **Query Optimization**: Uses TypeORM query builder for efficient filtering

---

## Security

### Public Access
- No authentication required
- All public routes bypass auth middleware
- Endpoints explicitly registered as public

### Data Protection
- Templates marked as `PUBLISHED` only
- User data in templates not exposed
- Execution logs sanitized before display

---

## Migration Guide

### Running the Database Migration

```bash
# Activepieces handles TypeORM migrations automatically
# Migration file: 1769700000001-CreateFlowGalleryAppTable.ts

# Manual migration (if needed):
npx typeorm migration:run --connection activepieces
```

---

## Troubleshooting

### Gallery Returns 404
- Verify module is registered in `app.ts`
- Check if templates table has published templates
- Verify database migrations ran successfully

### Execute Fails with "App not found"
- Confirm template ID is correct
- Verify template has `status: PUBLISHED`
- Check template type is `SHARED` or `OFFICIAL`

### Forms Not Generating
- Ensure template has valid `flows` schema
- Check trigger inputs are properly defined
- Verify template JSON structure is valid

---

## Contributing

### Adding New Features
1. Update controller for new endpoints
2. Add service methods for business logic
3. Create/update migrations for schema changes
4. Update this README
5. Test thoroughly (manual + API)

### Code Style
- Follow Activepieces TypeScript conventions
- Use TypeBox for type definitions
- Document public methods with JSDoc
- Keep HTML inline for simplicity (MVP approach)

---

## Migration from Concept to Implementation

**Original Concept**: Flow App Store MVP at `/apps` route  
**Initial Implementation**: Built for BCGPT (reverted)  
**Current Implementation**: Refined for Activepieces native integration  

**Key Adaptations**:
- Leverages existing Template system
- Uses Activepieces database schema
- Integrates with native middleware
- Follows Activepieces module patterns
- Compatible with Activepieces webhook execution

---

## References

- **PRD**: Flow App Store MVP - Phase 1
- **Related Modules**: Template, Flow, Webhook
- **Database**: TypeORM, PostgreSQL
- **Framework**: Fastify + TypeBox
