# E2E Test Suite for Apps Platform

Automated tests covering critical user flows for the Apps Platform.

## Test Environment

- Base URL: `https://flow.wickedlab.io` (or local `http://localhost:3000`)
- Browser: Chromium (via Playwright)
- Execution: GitHub Actions on merge to main
- Timeout: 30s per test, 5min total

## Test Suites

### Suite 1: Member Template Lifecycle

```gherkin
Scenario: Create → Publish → Execute Template Flow
  Given user is authenticated as "alice@example.com"
  When user navigates to "/my-templates"
  Then "Create from Flow" button is visible
  
  When user clicks "Create from Flow"
  And selects flow "Basecamp Task Sync"
  And enters template name "My Task Sync"
  And clicks "Save Template"
  Then dialog closes with success message
  And "My Task Sync" appears in templates list
  
  When user clicks "Settings" on "My Task Sync"
  And fills out publisher form:
    | audience | external |
    | auth | user_secret |
    | runtime | public_page |
  And clicks "Publish"
  Then template is published (status = "published")
  
  When user navigates to "/apps"
  And searches for "My Task Sync"
  Then app card displays with correct metadata
```

```gherkin
Scenario: Template Unpublish and Cleanup
  Given user has published app "My Task Sync"
  When user navigates to "/my-templates"
  And clicks "Unpublish" on "My Task Sync"
  Then confirmation dialog appears
  
  When user confirms
  Then publish status changes to "draft"
  And app disappears from gallery
```

### Suite 2: Publisher Validation

```gherkin
Scenario: Publisher Blocks Invalid Configuration
  Given user is on template publisher dialog
  When user attempts to:
    | audience | external | runnerMode | workspace_only |
  Then error appears: "Runner mode must be public_page for external apps"
  And "Publish" button remains disabled
  
  When user corrects to:
    | audience | external | runnerMode | public_page |
  Then error clears and "Publish" button enables
```

```gherkin
Scenario: Input Fields Validation
  Given user is configuring inputs in publisher
  When user creates duplicate field names "task_id" and "task_id"
  Then error appears: "Field names must be unique"
  And publish is blocked
  
  When user renames second field to "task_title"
  Then validation passes
```

### Suite 3: Runtime Wizard

```gherkin
Scenario: Five-Step Wizard Execution
  Given user is on app gallery
  When user clicks "Run" on "Basecamp Task Sync"
  Then modal opens at step 1: "Requirements"
  
  When user reads requirements checklist
  And clicks "Next"
  Then moves to step 2: "Connect"
  
  When user enters workspace connection name in text input
  And clicks "Next"
  Then validation passes and moves to step 3: "Configure"
  
  When user fills inputs:
    | Project | "Marketing"     |
    | Status  | "Not Started"   |
  And clicks "Next"
  Then moves to step 4: "Test"
  
  When user clicks "Run Test"
  Then test executes and shows result
  
  When user clicks "Next"
  Then moves to step 5: "Run"
  And clicks "Execute"
  Then app executes with actual workspace connection
```

```gherkin
Scenario: Backward Navigation
  Given user is on step 3 "Configure"
  When user clicks back arrow
  Then returns to step 2 "Connect"
  
  When user modifies connection and clicks "Next"
  Then returns to step 3 with form cleared (requires fresh input)
```

```gherkin
Scenario: Step Validation Guards
  Given user is on step 2 "Connect"
  When auth_mode is "user_secret" and no credential entered
  Then "Next" button is disabled
  
  When user enters a credential value
  Then "Next" button enables
```

### Suite 4: Workspace Connection Mode

```gherkin
Scenario: Workspace Connection Credential Mode
  Given app has auth_mode: "workspace_connection"
  When user reaches step 2 "Connect"
  Then blue info panel appears: "Workspace Connection Required"
  And "Manage Connections" button links to /settings/connections
  
  When user clicks "Manage Connections"
  Then opens in new tab to connection settings
```

### Suite 5: Public App Execution (No Auth)

```gherkin
Scenario: External App Runs Without Authentication
  Given app has audience: "external" and runnerMode: "public_page"
  When unauthenticated user visits "/apps"
  Then app appears in gallery without login
  
  When user clicks "Run"
  And completes wizard steps
  And clicks "Execute"
  Then execution succeeds without requiring login
```

### Suite 6: Access Control

```gherkin
Scenario: Internal App Blocked for Unauthenticated
  Given app has audience: "internal"
  When unauthenticated user visits "/apps"
  Then app does not appear in gallery
  
  When user tries direct URL "/apps/:internal_app_id"
  Then redirects to login or shows 401 error
```

```gherkin
Scenario: Template Ownership Enforcement
  Given "alice@example.com" created template "Personal Sync"
  When "bob@example.com" tries to edit the template
  Then access is denied with message "You don't have permission"
```

### Suite 7: Error Handling

```gherkin
Scenario: Graceful Error on Failed Execution
  Given app has external API that fails randomly
  When user executes app and API returns HTTP 500
  Then modal shows error: "Service connection failed"
  And modal has "Back" and "Retry" buttons
  And user can go back to previous step
```

```gherkin
Scenario: Input Validation Errors
  Given app requires "Project ID" as number
  When user enters "abc" (not a number)
  And clicks "Test"
  Then validation error: "Project ID must be a number"
  And test is not executed
```

## Test Data Setup

```javascript
// fixtures/template.fixture.ts
export const TASK_SYNC_TEMPLATE = {
  name: 'Task Sync Template',
  flow_id: 'flow_abc123',
  description: 'Sync tasks from Basecamp',
  gallery_metadata: {
    audience: 'external',
    auth_mode: 'user_secret',
    runner_mode: 'public_page',
    requirements: ['Basecamp Account', 'API Token'],
    inputs: [
      { name: 'project_id', label: 'Project ID', type: 'text', required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Done'] },
    ],
  },
};
```

## Execution

```bash
# Run full suite
npx playwright test

# Run specific suite
npx playwright test --grep "Five-Step Wizard"

# Run with UI mode (helpful for debugging)
npx playwright test --ui

# Run only on Chrome
npx playwright test --project=chromium
```

## Success Criteria

- All suites pass
- No flaky tests (0% intermittent failures)
- Execution time < 5 minutes
- 95%+ code coverage for UI components
- Gallery load: < 1s
- Wizard steps: < 500ms between steps

## Known Limitations

- Tests use real Basecamp API (requires valid test account)
- Database is NOT reset between tests (use unique template names)
- Tests assume clean state on first run

## CI Integration

GitHub Actions runs on every push to `main`:

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install
      - run: npx playwright test
      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

---

**Status**: Ready for Implementation
