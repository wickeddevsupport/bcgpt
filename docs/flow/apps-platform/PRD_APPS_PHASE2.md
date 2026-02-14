# PRD: Apps Milestone 2 (Publisher + Runner Contracts)

## Context
Milestone 1 delivered:
- Public gallery at `/apps`
- Public app API at `/apps/api/apps`
- App runtime route `/apps/:id`
- Basic execution endpoint `/apps/:id/execute`

Milestone 2 adds authenticated publishing and metadata contracts so users can turn templates into runnable apps.

## Goals
1. Let authenticated users publish templates as apps.
2. Capture app metadata needed for dynamic runner UX.
3. Keep public gallery behavior unchanged.

## Non-Goals (for this phase)
1. Full creator dashboard UI inside React app.
2. Ratings/reviews.
3. Monetization.
4. Async job queue for long-running app executions.

## API Contracts (Milestone 2)

Base path: `/apps/api/publisher`  
Auth: platform-authenticated user/service principal

### 1) List Published Apps
`GET /apps/api/publisher/apps?search=...`

Response:
```json
{
  "data": [
    {
      "id": "template_id",
      "name": "App Name",
      "galleryMetadata": {
        "templateId": "template_id",
        "flowId": "optional_flow_id",
        "inputSchema": {},
        "outputType": "json",
        "outputSchema": {}
      }
    }
  ]
}
```

### 2) List Publisher Templates
`GET /apps/api/publisher/templates?search=...`

Returns platform templates eligible for publishing.

### 3) Publish App
`POST /apps/api/publisher/publish`

Body:
```json
{
  "templateId": "tmpl_xxx",
  "flowId": "flow_xxx",
  "description": "Optional app description",
  "icon": "https://...",
  "category": "PRODUCTIVITY",
  "tags": ["text", "ai"],
  "featured": false,
  "displayOrder": 0,
  "inputSchema": {},
  "outputType": "json",
  "outputSchema": {}
}
```

Behavior:
- Validates template ownership by platform.
- Promotes template to `PUBLISHED`.
- Converts `CUSTOM` template type to `SHARED` for public listing.
- Upserts `flow_gallery_app` metadata.

### 4) Update App Metadata
`PUT /apps/api/publisher/apps/:templateId`

Body accepts mutable metadata fields (`description`, `icon`, `category`, `tags`, `inputSchema`, `outputType`, `outputSchema`, etc.).

### 5) Unpublish App
`DELETE /apps/api/publisher/apps/:templateId`

Removes app from public gallery by deleting gallery metadata record.

## Data Model Changes

`flow_gallery_app` additional fields:
- `flowId` (nullable string)
- `inputSchema` (nullable jsonb)
- `outputType` (nullable string)
- `outputSchema` (nullable jsonb)
- `publishedBy` (nullable string)

Index:
- unique `(templateId, platformId)`

## Acceptance Criteria
1. Authenticated publisher can list templates and publish one in a single API call.
2. Published template appears in public `/apps` list.
3. Metadata update reflects in API responses.
4. Unpublish removes app from public listing.
5. Existing public `/apps` endpoints remain backward compatible.

