# Flow App Store - Product Requirements Document

**Version:** 1.0  
**Status:** Planning  
**Last Updated:** 2026-02-11  
**Location:** flow.wickedlab.io/apps

---

## Executive Summary

Create a custom app store at `flow.wickedlab.io/apps` where users can publish Activepieces workflows as standalone applications with simple input/output interfaces. This transforms complex workflows into user-friendly apps that anyone can use without understanding the underlying automation.

### Vision Statement
Enable non-technical users to create, publish, and monetize micro-applications by wrapping Activepieces workflows with intuitive UI layers, creating a marketplace of purpose-built tools.

---

## Problem Statement

### Current Situation
- Activepieces flows are powerful but require users to:
  - Understand workflow concepts
  - Have Activepieces access
  - Know how to trigger and configure flows
  - Parse raw JSON outputs

### Pain Points
1. **Barrier to Use** - End users can't easily benefit from workflows others create
2. **No Discoverability** - Great workflows remain hidden within creator accounts
3. **Complex Interfaces** - Webhooks and JSON are not user-friendly
4. **No Sharing Economy** - Creators can't showcase or monetize their work

### Opportunity
Transform workflows into consumable apps, similar to:
- Zapier's Public Zaps → But with custom UI
- Make.com Scenarios → But in an app store
- GPT Store → But for workflow automation

---

## Solution Overview

### Core Concept
**Workflow-as-a-Service (WaaS)**

1. User creates a workflow in Activepieces
2. User publishes workflow as an "App" with metadata
3. App appears in public store (flow.wickedlab.io/apps)
4. End users access app through simple web UI
5. App executes workflow via webhook and returns results

### Key Components

```
┌─────────────────────────────────────────────────────┐
│          flow.wickedlab.io/apps                     │
│                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │   App 1    │  │   App 2    │  │   App 3    │   │
│  │  (Image)   │  │  (Text)    │  │  (Data)    │   │
│  └────────────┘  └────────────┘  └────────────┘   │
│                                                      │
│         ↓ User clicks "Open App"                    │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │  App Runtime                                  │  │
│  │  • Input form (dynamic)                       │  │
│  │  • Execute button                             │  │
│  │  • Output display (formatted)                 │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
│         ↓ POST to webhook                           │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │  Activepieces Flow (flow.wickedlab.io)       │  │
│  │  Webhook Trigger → Logic → Return Response   │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## User Personas

### 1. **App Creator** (Primary)
- Has Activepieces access
- Builds workflows for specific use cases
- Wants to share/monetize their creations
- Technical enough to use Activepieces

### 2. **App Consumer** (Primary)
- Needs a specific tool/utility
- No technical knowledge required
- Just wants results (image, text, data)
- May or may not have Activepieces account

### 3. **Platform Admin** (Secondary)
- Moderates app submissions
- Manages featured apps
- Monitors usage and performance

---

## User Stories

### App Creator Journey

**As an App Creator, I want to:**

1. **Publish a Flow as an App**
   - "I want to turn my image generation workflow into a public app"
   - **Acceptance Criteria:**
     - Select any published flow
     - Add app metadata (name, description, icon, category)
     - Define input fields with types and labels
     - Define output format/display type
     - Preview app before publishing
     - Publish to store with one click

2. **Manage My Apps**
   - "I want to see analytics and edit my published apps"
   - **Acceptance Criteria:**
     - Dashboard showing all my apps
     - Usage statistics (views, executions, ratings)
     - Edit app metadata and settings
     - Unpublish or update apps
     - See revenue (if monetization enabled)

3. **Test My App**
   - "I want to verify my app works before publishing"
   - **Acceptance Criteria:**
     - Test mode that executes flow with sample data
     - See actual input/output
     - Debug webhook responses
     - Validate error handling

### App Consumer Journey

**As an App Consumer, I want to:**

1. **Discover Apps**
   - "I want to find an app that generates images from text"
   - **Acceptance Criteria:**
     - Browse app gallery with cards
     - Search by name/description
     - Filter by category/tags
     - See ratings and usage counts
     - Featured/trending sections

2. **Use an App**
   - "I want to generate an image quickly without learning APIs"
   - **Acceptance Criteria:**
     - Open app in simple interface
     - Fill out clear input form
     - Click "Run" button
     - See loading indicator
     - Get formatted output
     - Copy/download results

3. **Save Favorites**
   - "I want to bookmark apps I use often"
   - **Acceptance Criteria:**
     - Star/favorite apps
     - Access favorites from dashboard
     - Get notified of updates

---

## Features & Requirements

### Phase 1: MVP (Minimum Viable Product)

#### 1.1 App Registry System
**Priority:** P0 (Critical)

- **Database Schema:**
  ```javascript
  App {
    id: UUID
    flowId: string          // Activepieces flow ID
    name: string
    slug: string           // URL-friendly name
    description: string
    icon: URL
    createdBy: userId
    category: string
    tags: string[]
    status: 'draft' | 'published' | 'archived'
    inputSchema: InputField[]
    outputType: 'text' | 'image' | 'json' | 'html'
    webhookUrl: string     // Auto-generated
    createdAt: timestamp
    updatedAt: timestamp
    usageCount: number
    rating: number
  }

  InputField {
    name: string
    type: 'text' | 'number' | 'select' | 'textarea' | 'file'
    label: string
    placeholder: string
    required: boolean
    options?: string[]     // for select type
    defaultValue?: any
  }
  ```

#### 1.2 App Gallery (Public)
**Priority:** P0

- Grid layout with app cards
- Each card shows:
  - App icon
  - App name
  - Brief description
  - Category badge
  - Rating stars
  - Usage count
- Search bar
- Category filter dropdown
- "Open App" button

#### 1.3 App Runtime Interface
**Priority:** P0

- **Dynamic Form Generator:**
  - Render inputs based on inputSchema
  - Validation (required fields, types)
  - Clear labeling and placeholders
  
- **Execution:**
  - "Run App" button
  - Loading state with spinner
  - Timeout handling (30s for sync)
  
- **Output Display:**
  - Text: Formatted in card/box
  - Image: Display with download button
  - JSON: Pretty-printed with syntax highlight
  - HTML: Rendered safely
  
- **Error Handling:**
  - User-friendly error messages
  - "Try Again" button
  - Report issue link

#### 1.4 App Publishing Flow
**Priority:** P0

- **Creator Dashboard:**
  - "Publish New App" button
  - Form to select flow (dropdown of user's flows)
  - App metadata inputs
  - Input schema builder (add/remove fields)
  - Output type selector
  - Preview mode
  - "Publish" button

- **Input Schema Builder:**
  - Add field button
  - Field configuration:
    - Name (technical)
    - Label (user-facing)
    - Type selector
    - Required checkbox
    - Options (for select)
  - Drag to reorder
  - Delete field

#### 1.5 Webhook Integration
**Priority:** P0

- **Flow Requirements Validation:**
  - Check flow has webhook trigger
  - Check flow has "Return Response" action
  - Check flow is published (not draft)
  
- **Webhook Execution:**
  - POST to `/webhooks/{flowId}/sync`
  - Send input data as JSON body
  - Handle response
  - Parse and format output

### Phase 2: Enhanced Features

#### 2.1 User Accounts & Auth
**Priority:** P1

- User registration/login
- OAuth integration (Google, GitHub)
- Profile management
- Creator profiles (public pages)

#### 2.2 Analytics Dashboard
**Priority:** P1

- **For Creators:**
  - Total executions
  - Daily active users
  - Average execution time
  - Error rate
  - User feedback
  
- **For Admins:**
  - Platform-wide metrics
  - Popular apps
  - User growth
  - System health

#### 2.3 Ratings & Reviews
**Priority:** P1

- 5-star rating system
- Written reviews
- Reply to reviews
- Report inappropriate content

#### 2.4 Advanced Input Types
**Priority:** P2

- File upload
- Date picker
- Color picker
- Multi-select
- Rich text editor

#### 2.5 Output Enhancements
**Priority:** P2

- Multiple output formats
- Downloadable results
- Share results (unique URL)
- History of past runs (if logged in)

### Phase 3: Marketplace Features

#### 3.1 Monetization
**Priority:** P2

- Free tier (X executions/month)
- Premium apps (pay-per-use)
- Subscription plans
- Revenue sharing with creators
- Payment integration (Stripe)

#### 3.2 App Categories & Discovery
**Priority:** P2

- Curated collections
- Featured apps (admin-selected)
- Trending algorithms
- "Related apps" recommendations
- Tags and advanced filtering

#### 3.3 Collaboration
**Priority:** P3

- Share draft apps with team
- Fork/duplicate apps
- Version history
- Comments on apps

---

## Technical Architecture

### Frontend Stack

**Options:**
1. **Next.js App Router** (Recommended)
   - Server components for gallery
   - Client components for app runtime
   - API routes for backend
   - File-based routing
   
2. **React SPA + Express API**
   - Separate frontend/backend
   - More control over API
   
3. **Embedded in Existing BCGPT**
   - Add routes to index.js
   - Use existing database

**Recommended:** Next.js as separate service on `/apps` path

### Backend Components

```
/apps
├── /api                    # Next.js API routes
│   ├── /apps              # CRUD for apps
│   │   ├── GET /          # List all apps
│   │   ├── POST /         # Create app
│   │   ├── GET /[id]      # Get app details
│   │   ├── PUT /[id]      # Update app
│   │   └── DELETE /[id]   # Delete app
│   ├── /execute           # Execute app
│   │   └── POST /[id]     # Run app with input
│   ├── /categories        # Get categories
│   └── /users             # User management
├── /components
│   ├── AppCard.tsx
│   ├── AppGallery.tsx
│   ├── AppRuntime.tsx
│   ├── InputForm.tsx
│   ├── OutputDisplay.tsx
│   └── PublishWizard.tsx
├── /app
│   ├── page.tsx           # Gallery
│   ├── /[appSlug]
│   │   └── page.tsx       # App runtime
│   └── /publish
│       └── page.tsx       # Publish flow
└── /lib
    ├── db.ts              # Database client
    ├── activepieces.ts    # AP API client
    └── validation.ts      # Input validation
```

### Database Schema

**Tables:**

```sql
-- Apps table
CREATE TABLE flow_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  icon_url TEXT,
  created_by UUID REFERENCES users(id),
  category VARCHAR(100),
  tags TEXT[],
  status VARCHAR(50) DEFAULT 'draft',
  input_schema JSONB NOT NULL,
  output_type VARCHAR(50),
  webhook_url TEXT,
  usage_count INTEGER DEFAULT 0,
  rating DECIMAL(3,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Executions log
CREATE TABLE app_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID REFERENCES flow_apps(id),
  user_id UUID REFERENCES users(id),
  input_data JSONB,
  output_data JSONB,
  status VARCHAR(50),
  execution_time_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Ratings & Reviews
CREATE TABLE app_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID REFERENCES flow_apps(id),
  user_id UUID REFERENCES users(id),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- User favorites
CREATE TABLE user_favorites (
  user_id UUID REFERENCES users(id),
  app_id UUID REFERENCES flow_apps(id),
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, app_id)
);

-- Categories
CREATE TABLE app_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  icon TEXT,
  description TEXT
);
```

### API Endpoints

#### Public Endpoints
```
GET    /api/apps                    # List all published apps
GET    /api/apps/[id]               # Get app details
POST   /api/apps/[id]/execute       # Execute app (may require auth)
GET    /api/categories              # List categories
GET    /api/apps/search?q=query     # Search apps
```

#### Authenticated Endpoints
```
POST   /api/apps                    # Create new app
PUT    /api/apps/[id]               # Update app
DELETE /api/apps/[id]               # Delete app
GET    /api/apps/mine               # Get my apps
POST   /api/apps/[id]/publish       # Change status to published
POST   /api/apps/[id]/favorite      # Add to favorites
GET    /api/apps/favorites          # Get my favorites
POST   /api/apps/[id]/review        # Submit review
```

#### Admin Endpoints
```
GET    /api/admin/apps              # All apps (including drafts)
PUT    /api/admin/apps/[id]/feature # Mark as featured
GET    /api/admin/analytics         # Platform analytics
```

### Integration with Activepieces

```javascript
// lib/activepieces.ts

class ActivepiecesClient {
  baseUrl = 'https://flow.wickedlab.io'
  
  async executeFlow(flowId: string, input: any) {
    const response = await fetch(
      `${this.baseUrl}/webhooks/${flowId}/sync`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    )
    
    if (!response.ok) {
      throw new Error('Flow execution failed')
    }
    
    return response.json()
  }
  
  async validateFlow(flowId: string) {
    // Check if flow exists, is published, has webhook trigger
    const flow = await this.getFlow(flowId)
    
    if (!flow) throw new Error('Flow not found')
    if (flow.status !== 'ENABLED') throw new Error('Flow not published')
    // Check for webhook trigger...
    
    return true
  }
}
```

---

## Example Use Cases

### Example 1: AI Image Generator

**Flow in Activepieces:**
```
Trigger: Webhook
  ↓
Action: DALL-E API (Generate image)
  ↓
Action: Return Response (image URL)
```

**App Configuration:**
```json
{
  "name": "AI Image Generator",
  "category": "AI & Creative",
  "inputSchema": [
    {
      "name": "prompt",
      "type": "textarea",
      "label": "Describe your image",
      "required": true,
      "placeholder": "A cat wearing a space suit..."
    },
    {
      "name": "style",
      "type": "select",
      "label": "Art Style",
      "options": ["realistic", "cartoon", "abstract", "watercolor"]
    }
  ],
  "outputType": "image"
}
```

**User Experience:**
1. User visits `flow.wickedlab.io/apps/ai-image-generator`
2. Sees form with prompt textarea and style dropdown
3. Enters: "A dragon flying over mountains"
4. Selects: "watercolor"
5. Clicks "Generate Image"
6. Sees loading spinner for ~10s
7. Image appears with download button

### Example 2: Text Summarizer

**Flow:**
```
Trigger: Webhook
  ↓
Action: Call GPT-4 (summarize text)
  ↓
Action: Return Response (summary)
```

**App Configuration:**
```json
{
  "name": "Smart Text Summarizer",
  "category": "Productivity",
  "inputSchema": [
    {
      "name": "text",
      "type": "textarea",
      "label": "Text to summarize",
      "required": true
    },
    {
      "name": "length",
      "type": "select",
      "label": "Summary length",
      "options": ["brief", "medium", "detailed"]
    }
  ],
  "outputType": "text"
}
```

### Example 3: Data Enrichment

**Flow:**
```
Trigger: Webhook
  ↓
Action: Lookup company data (Clearbit API)
  ↓
Action: Lookup social profiles
  ↓
Action: Format as JSON
  ↓
Action: Return Response
```

**App Configuration:**
```json
{
  "name": "Company Data Finder",
  "category": "Business",
  "inputSchema": [
    {
      "name": "domain",
      "type": "text",
      "label": "Company Website",
      "placeholder": "example.com",
      "required": true
    }
  ],
  "outputType": "json"
}
```

---

## Security & Privacy

### Input Validation
- Sanitize all user inputs
- Validate against schema
- Rate limiting per IP
- File size limits (if file upload)

### Authentication
- API keys for execution
- JWT for user sessions
- OAuth for social login
- Session management

### Data Privacy
- Don't log sensitive inputs
- Encrypt stored execution data
- GDPR compliance
- Clear data retention policy

### Flow Security
- Validate flow ownership before publishing
- Prevent executing disabled flows
- Sandbox execution environment
- Timeout enforcement

---

## Performance Considerations

### Caching
- Cache app metadata (Redis)
- Cache category lists
- Cache user favorites
- CDN for static assets

### Scaling
- Horizontal scaling of app runtime servers
- Queue for async executions
- Database read replicas
- Load balancing

### Monitoring
- Execution time tracking
- Error rate monitoring
- Usage patterns
- Alert on anomalies

---

## Implementation Roadmap

### Milestone 1: Proof of Concept (1-2 weeks)
**Goal:** Single working app end-to-end

- [ ] Create database schema
- [ ] Build simple app registry (hardcoded 1 app)
- [ ] Build app runtime page with static form
- [ ] Integrate with webhook execution
- [ ] Display output
- [ ] Test with image generation flow

### Milestone 2: MVP (3-4 weeks)
**Goal:** Working app store with core features

- [ ] Implement app gallery
- [ ] Build publish wizard
- [ ] Dynamic form generation
- [ ] App CRUD operations
- [ ] Search and filter
- [ ] User authentication
- [ ] Creator dashboard

### Milestone 3: Polish & Launch (2-3 weeks)
**Goal:** Production-ready with enhanced UX

- [ ] Analytics implementation
- [ ] Rating system
- [ ] Error handling polish
- [ ] Mobile responsive
- [ ] Loading states
- [ ] Onboarding tutorial
- [ ] Documentation

### Milestone 4: Growth Features (Ongoing)
**Goal:** Marketplace maturity

- [ ] Monetization system
- [ ] Advanced discovery
- [ ] Collaboration features
- [ ] API for external access
- [ ] White-label options

---

## Success Metrics

### Launch Targets (3 months)
- **Apps Published:** 50+
- **Active Creators:** 10+
- **Total Executions:** 1,000+
- **User Acquisition:** 100+ consumers
- **Average Rating:** 4.0+

### Growth Targets (6 months)
- **Apps Published:** 200+
- **Active Creators:** 50+
- **Total Executions:** 10,000+
- **Monthly Active Users:** 500+
- **Revenue:** $1,000+ (if monetized)

### Quality Metrics
- **Average Execution Time:** < 5s
- **Error Rate:** < 5%
- **User Retention:** > 30% (month 2)
- **Creator Satisfaction:** 4.5+ stars

---

## Open Questions & Decisions Needed

### Technical Decisions
- [ ] **Database:** Use existing BCGPT db or separate?
- [ ] **Hosting:** Same server or separate deploy?
- [ ] **Framework:** Next.js standalone or integrate with Express?
- [ ] **Auth:** Build custom or use Auth0/Clerk?

### Product Decisions
- [ ] **Monetization:** Launch with or add later?
- [ ] **Moderation:** Auto-publish or manual review?
- [ ] **Privacy:** Public apps only or private option?
- [ ] **Limits:** Free tier execution limits?

### Business Decisions
- [ ] **Branding:** "Flow Apps", "Wicked Apps", or other?
- [ ] **Target Audience:** B2B or B2C or both?
- [ ] **Go-to-Market:** Soft launch or public announcement?

---

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Low app quality | High | Medium | Manual review, rating system |
| Webhook timeouts | High | Medium | Async execution option, queue |
| Abuse/spam | Medium | Medium | Rate limiting, auth required |
| Low creator adoption | High | Medium | Incentives, featured creators |
| Security vulnerabilities | High | Low | Penetration testing, audits |
| Activepieces changes API | Medium | Low | Version pinning, monitoring |

---

## Appendix

### Similar Products Analysis

**Zapier Public Zaps:**
- ✅ Sharable workflows
- ❌ No custom UI
- ❌ Not discoverable marketplace

**Make.com Public Scenarios:**
- ✅ Public templates
- ❌ Still requires Make account
- ❌ No simple UI wrapper

**GPT Store:**
- ✅ Great discovery
- ✅ Simple interface
- ❌ Limited to chat only

**Our Differentiator:** Workflow-powered apps with custom UI in a marketplace

### Tech Stack Recommendations

**Frontend:**
- Framework: Next.js 14 (App Router)
- UI Library: shadcn/ui + Tailwind CSS
- State: Zustand or React Context
- Forms: React Hook Form + Zod

**Backend:**
- API: Next.js API Routes
- Database: PostgreSQL (existing)
- Cache: Redis
- Queue: BullMQ (for async jobs)

**Infrastructure:**
- Host: Same VPS as BCGPT
- Reverse Proxy: Traefik (already set up)
- SSL: Let's Encrypt (already configured)
- CI/CD: GitHub Actions

---

## Getting Started

When ready to implement, refer to this PRD and:

1. **Start with Milestone 1** - Build proof of concept
2. **Create a feature branch:** `git checkout -b feature/flow-app-store`
3. **Set up project structure:** Create `/apps` directory
4. **Database migrations:** Run schema creation scripts
5. **Build first app:** Image generator as demo
6. **Iterate:** Get feedback and improve

---

**Document Owner:** AI Assistant  
**Stakeholders:** Product Team, Development Team  
**Next Review:** After Milestone 1 completion
