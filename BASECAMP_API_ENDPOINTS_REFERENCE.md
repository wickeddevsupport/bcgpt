# Official Basecamp 4 API - Complete Endpoints Reference

**Source**: basecamp/bc3-api repository (master branch)  
**Documentation Date**: 2022-2024  
**API Version**: Basecamp 3 (Basecamp 4)

---

## Table of Contents
1. [Projects](#projects)
2. [To-Do Lists](#to-do-lists)
3. [To-Dos](#to-dos)
4. [People](#people)
5. [Messages](#messages)
6. [Comments](#comments)
7. [Card Table Cards](#card-table-cards)
8. [Card Tables](#card-tables)
9. [Uploads](#uploads)
10. [Documents](#documents)
11. [Schedule Entries](#schedule-entries)
12. [Search](#search)
13. [Recordings](#recordings)

---

## PROJECTS

### Get all projects
- **Method**: `GET`
- **Path**: `/projects.json`
- **Parameters**:
  - `status` (optional) - `archived` or `trashed` (default: active projects)
- **Response**: Paginated list of projects

### Get a project
- **Method**: `GET`
- **Path**: `/projects/{id}.json`
- **Parameters**: None
- **Response**: Single project object with dock items

### Create a project
- **Method**: `POST`
- **Path**: `/projects.json`
- **Required Parameters**:
  - `name` (string) - Project name
- **Optional Parameters**:
  - `description` (string) - Project description
  - `schedule_attributes[start_date]` (ISO 8601) - Project start date (requires end_date)
  - `schedule_attributes[end_date]` (ISO 8601) - Project end date (requires start_date)
  - `admissions` (string) - Access policy: `invite`, `employee`, or `team`
- **Response**: `201 Created` with project object

### Update a project
- **Method**: `PUT`
- **Path**: `/projects/{id}.json`
- **Required Parameters**:
  - `name` (string) - Project name
- **Optional Parameters**:
  - `description` (string)
  - `schedule_attributes[start_date]` (ISO 8601)
  - `schedule_attributes[end_date]` (ISO 8601)
  - `admissions` (string) - `invite`, `employee`, or `team`
- **Response**: `200 OK` with updated project object

### Trash a project
- **Method**: `DELETE`
- **Path**: `/projects/{id}.json`
- **Parameters**: None
- **Response**: `204 No Content`

---

## TO-DO LISTS

### Get to-do lists
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/todosets/{todoset_id}/todolists.json`
- **Parameters**:
  - `status` (optional) - `archived` or `trashed`
- **Response**: Paginated list of to-do lists

### Get a to-do list
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/todolists/{id}.json`
- **Parameters**: None
- **Response**: Single to-do list object

### Create a to-do list
- **Method**: `POST`
- **Path**: `/buckets/{bucket_id}/todosets/{todoset_id}/todolists.json`
- **Required Parameters**:
  - `name` (string) - To-do list name
- **Optional Parameters**:
  - `description` (HTML string) - To-do list description
- **Response**: `201 Created` with to-do list object

### Update a to-do list
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/todolists/{id}.json`
- **Required Parameters**:
  - `name` (string) - Must include all existing parameters
- **Optional Parameters**:
  - `description` (HTML string)
- **Response**: `200 OK` with updated to-do list object

### Trash a to-do list
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/status/trashed.json`
- **Parameters**: None
- **Response**: `204 No Content`

---

## TO-DOS

### Get to-dos
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/todolists/{todolist_id}/todos.json`
- **Parameters**:
  - `status` (optional) - `archived` or `trashed`
  - `completed` (optional) - `true` to filter completed to-dos
- **Response**: Paginated list of to-dos (active/pending by default)

### Get a to-do
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/todos/{id}.json`
- **Parameters**: None
- **Response**: Single to-do object

### Create a to-do
- **Method**: `POST`
- **Path**: `/buckets/{bucket_id}/todolists/{todolist_id}/todos.json`
- **Required Parameters**:
  - `content` (string) - What the to-do is for
- **Optional Parameters**:
  - `description` (HTML string) - Additional information
  - `assignee_ids` (array of integers) - People to assign
  - `completion_subscriber_ids` (array of integers) - People to notify on completion
  - `notify` (boolean) - Notify assignees
  - `due_on` (ISO 8601 date) - Due date
  - `starts_on` (ISO 8601 date) - Start date
- **Response**: `201 Created` with to-do object

### Update a to-do
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/todos/{id}.json`
- **Required Parameters**:
  - `content` (string) - Always required, can't be omitted
- **Optional Parameters**:
  - `description` (HTML string)
  - `assignee_ids` (array of integers)
  - `completion_subscriber_ids` (array of integers)
  - `notify` (boolean)
  - `due_on` (ISO 8601 date)
  - `starts_on` (ISO 8601 date)
- **Request Body Structure**: Include all existing parameters to preserve them; omitting clears values
- **Response**: `200 OK` with updated to-do object

### Complete a to-do
- **Method**: `POST`
- **Path**: `/buckets/{bucket_id}/todos/{id}/completion.json`
- **Parameters**: None (no request body)
- **Response**: `204 No Content`

### Uncomplete a to-do
- **Method**: `DELETE`
- **Path**: `/buckets/{bucket_id}/todos/{id}/completion.json`
- **Parameters**: None (no request body)
- **Response**: `204 No Content`

### Reposition a to-do
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/todos/{id}/position.json`
- **Required Parameters**:
  - `position` (integer) - New position (>= 1)
- **Response**: `204 No Content`

### Trash a to-do
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/status/trashed.json`
- **Parameters**: None
- **Response**: `204 No Content`

---

## PEOPLE

### Get all people
- **Method**: `GET`
- **Path**: `/people.json`
- **Parameters**: None
- **Response**: List of all people visible to current user (paginated)

### Get people on a project
- **Method**: `GET`
- **Path**: `/projects/{project_id}/people.json`
- **Parameters**: None
- **Response**: List of active people on project

### Get pingable people
- **Method**: `GET`
- **Path**: `/circles/people.json`
- **Parameters**: None
- **Response**: All people who can be pinged (NOT paginated)

### Get person
- **Method**: `GET`
- **Path**: `/people/{id}.json`
- **Parameters**: None
- **Response**: Single person object

### Get my personal info
- **Method**: `GET`
- **Path**: `/my/profile.json`
- **Parameters**: None
- **Response**: Current user's profile object

### Update who can access a project
- **Method**: `PUT`
- **Path**: `/projects/{project_id}/people/users.json`
- **Optional Parameters** (at least one required):
  - `grant` (array of integers) - People IDs to grant access
  - `revoke` (array of integers) - People IDs to revoke access
  - `create` (array of objects) - New people to create:
    - `name` (string, required)
    - `email_address` (string, required)
    - `title` (string, optional)
    - `company_name` (string, optional)
- **Response**: `200 OK` with granted/revoked/created arrays

---

## MESSAGES

### Get messages
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/message_boards/{message_board_id}/messages.json`
- **Parameters**: None
- **Response**: Paginated list of active messages

### Get a message
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/messages/{id}.json`
- **Parameters**: None
- **Response**: Single message object

### Create a message
- **Method**: `POST`
- **Path**: `/buckets/{bucket_id}/message_boards/{message_board_id}/messages.json`
- **Required Parameters**:
  - `subject` (string) - Message title
  - `status` (string) - Set to `active` to publish immediately
- **Optional Parameters**:
  - `content` (HTML string) - Message body
  - `category_id` (integer) - Message type
  - `subscriptions` (array of integers) - People IDs to notify and subscribe
- **Response**: `201 Created` with message object

### Update a message
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/messages/{id}.json`
- **Optional Parameters**:
  - `subject` (string)
  - `content` (HTML string)
  - `category_id` (integer)
- **Response**: `200 OK` with updated message object

### Pin a message
- **Method**: `POST`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/pin.json`
- **Parameters**: None
- **Response**: `204 No Content`

### Unpin a message
- **Method**: `DELETE`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/pin.json`
- **Parameters**: None
- **Response**: `204 No Content`

### Trash a message
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/status/trashed.json`
- **Parameters**: None
- **Response**: `204 No Content`

---

## COMMENTS

### Get comments
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/recordings/{recording_id}/comments.json`
- **Parameters**: None
- **Response**: Paginated list of active comments

### Get a comment
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/comments/{id}.json`
- **Parameters**: None
- **Response**: Single comment object

### Create a comment
- **Method**: `POST`
- **Path**: `/buckets/{bucket_id}/recordings/{recording_id}/comments.json`
- **Required Parameters**:
  - `content` (HTML string) - Comment text
- **Response**: `201 Created` with comment object
- **Note**: All subscribers to the recording are notified

### Update a comment
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/comments/{id}.json`
- **Optional Parameters**:
  - `content` (HTML string)
- **Response**: `200 OK` with updated comment object

### Trash a comment
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/status/trashed.json`
- **Parameters**: None
- **Response**: `204 No Content`

---

## CARD TABLE CARDS

### Get cards in a column
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/card_tables/lists/{column_id}/cards.json`
- **Parameters**: None
- **Response**: Paginated list of cards in the column

### Get a card
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/card_tables/cards/{id}.json`
- **Parameters**: None
- **Response**: Single card object with steps array

### Create a card
- **Method**: `POST`
- **Path**: `/buckets/{bucket_id}/card_tables/lists/{column_id}/cards.json`
- **Required Parameters**:
  - `title` (string) - Card title
- **Optional Parameters**:
  - `content` (HTML string) - Card description
  - `due_on` (ISO 8601 date) - Due date
  - `notify` (boolean) - Notify assignees
- **Response**: `201 Created` with card object

### Update a card
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/card_tables/cards/{id}.json`
- **Optional Parameters**:
  - `title` (string)
  - `content` (HTML string)
  - `due_on` (ISO 8601 date)
  - `assignee_ids` (array of integers)
- **Response**: `200 OK` with updated card object

### Move a card
- **Method**: `POST`
- **Path**: `/buckets/{bucket_id}/card_tables/cards/{id}/moves.json`
- **Required Parameters**:
  - `column_id` (integer) - Destination column ID
- **Response**: `204 No Content`

### Trash a card
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/status/trashed.json`
- **Parameters**: None
- **Response**: `204 No Content`

---

## CARD TABLES

### Get a card table
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/card_tables/{id}.json`
- **Parameters**: None
- **Response**: Single card table object with columns array

---

## UPLOADS

### Get uploads
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/vaults/{vault_id}/uploads.json`
- **Parameters**: None
- **Response**: Paginated list of active uploads

### Get an upload
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/uploads/{id}.json`
- **Parameters**: None
- **Response**: Single upload object

### Create an upload
- **Method**: `POST`
- **Path**: `/buckets/{bucket_id}/vaults/{vault_id}/uploads.json`
- **Required Parameters**:
  - `attachable_sgid` (string) - Signed global ID from attachment upload
- **Optional Parameters**:
  - `description` (HTML string) - Upload description
  - `base_name` (string) - New filename without extension
- **Response**: `201 Created` with upload object

### Update an upload
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/uploads/{id}.json`
- **Optional Parameters**:
  - `description` (HTML string)
  - `base_name` (string) - Filename without extension
- **Response**: `200 OK` with updated upload object

### Trash an upload
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/status/trashed.json`
- **Parameters**: None
- **Response**: `204 No Content`

---

## DOCUMENTS

### Get documents
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/vaults/{vault_id}/documents.json`
- **Parameters**: None
- **Response**: Paginated list of active documents

### Get a document
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/documents/{id}.json`
- **Parameters**: None
- **Response**: Single document object

### Create a document
- **Method**: `POST`
- **Path**: `/buckets/{bucket_id}/vaults/{vault_id}/documents.json`
- **Required Parameters**:
  - `title` (string) - Document title
  - `content` (HTML string) - Document body
- **Optional Parameters**:
  - `status` (string) - Set to `active` to publish immediately
- **Response**: `201 Created` with document object

### Update a document
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/documents/{id}.json`
- **Optional Parameters**:
  - `title` (string)
  - `content` (HTML string)
- **Response**: `200 OK` with updated document object

### Trash a document
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/status/trashed.json`
- **Parameters**: None
- **Response**: `204 No Content`

---

## SCHEDULE ENTRIES

### Get schedule entries
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/schedules/{schedule_id}/entries.json`
- **Parameters**:
  - `status` (optional) - `archived` or `trashed`
- **Response**: Paginated list of active schedule entries

### Get a schedule entry
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/schedule_entries/{id}.json`
- **Parameters**: None
- **Response**: Single schedule entry object
- **Note**: Redirects to first occurrence for recurring entries. Individual occurrences accessible via `/buckets/{bucket_id}/schedule_entries/{id}/occurrences/{date}.json`

### Get schedule entry occurrence (recurring)
- **Method**: `GET`
- **Path**: `/buckets/{bucket_id}/schedule_entries/{id}/occurrences/{date}.json`
- **Parameters**: `date` in YYYYMMDD format
- **Response**: Single schedule entry occurrence object

### Create a schedule entry
- **Method**: `POST`
- **Path**: `/buckets/{bucket_id}/schedules/{schedule_id}/entries.json`
- **Required Parameters**:
  - `summary` (string) - What the entry is about
  - `starts_at` (ISO 8601 datetime) - Start date-time
  - `ends_at` (ISO 8601 datetime) - End date-time
- **Optional Parameters**:
  - `description` (HTML string) - Additional information
  - `participant_ids` (array of integers) - People IDs
  - `all_day` (boolean) - Mark as all-day event
  - `notify` (boolean) - Notify participants
- **Response**: `201 Created` with schedule entry object

### Update a schedule entry
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/schedule_entries/{id}.json`
- **Optional Parameters**: Same as create endpoint (summary, starts_at, ends_at, description, participant_ids, all_day, notify)
- **Response**: `200 OK` with updated schedule entry object

### Trash a schedule entry
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/status/trashed.json`
- **Parameters**: None
- **Response**: `204 No Content`

---

## SEARCH

### Search recordings
- **Method**: `GET`
- **Path**: `/search.json`
- **Required Parameters**:
  - `q` (string) - Search query
- **Optional Parameters**:
  - `type` (string) - Filter by recording type (Todo, Message, Document, Upload, etc.)
  - `bucket_id` (integer) - Filter to a specific project/bucket
  - `creator_id` (integer) - Filter by creator
  - `file_type` (string) - Filter by file type
  - `exclude_chat` (boolean) - Exclude chat from results
  - `page` (integer) - Page number
  - `per_page` (integer) - Items per page
- **Response**: Paginated list of matching recordings

---

## RECORDINGS

Recordings are generic data structures representing most Basecamp objects.

### Get recordings
- **Method**: `GET`
- **Path**: `/projects/recordings.json`
- **Required Parameters**:
  - `type` (string) - One of: `Comment`, `Document`, `Kanban::Card`, `Kanban::Step`, `Message`, `Question::Answer`, `Schedule::Entry`, `Todo`, `Todolist`, `Upload`, `Vault`
- **Optional Parameters**:
  - `bucket` (string) - Single or comma-separated project IDs (default: all active projects)
  - `status` (string) - `active`, `archived`, or `trashed` (default: active)
  - `sort` (string) - `created_at` or `updated_at` (default: created_at)
  - `direction` (string) - `desc` or `asc` (default: desc)
- **Response**: Paginated list of recordings

### Trash a recording
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/status/trashed.json`
- **Parameters**: None
- **Response**: `204 No Content`

### Archive a recording
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/status/archived.json`
- **Parameters**: None
- **Response**: `204 No Content`

### Unarchive a recording
- **Method**: `PUT`
- **Path**: `/buckets/{bucket_id}/recordings/{id}/status/active.json`
- **Parameters**: None
- **Response**: `204 No Content`

---

## ENDPOINT SUMMARY BY HTTP METHOD

### GET Endpoints (Read Operations)
- `GET /projects.json` - Get all projects
- `GET /projects/{id}.json` - Get single project
- `GET /projects/{id}/people.json` - Get project people
- `GET /people.json` - Get all people
- `GET /people/{id}.json` - Get single person
- `GET /my/profile.json` - Get current user profile
- `GET /circles/people.json` - Get pingable people
- `GET /buckets/{bucket_id}/todosets/{todoset_id}/todolists.json` - Get to-do lists
- `GET /buckets/{bucket_id}/todolists/{id}.json` - Get single to-do list
- `GET /buckets/{bucket_id}/todolists/{todolist_id}/todos.json` - Get to-dos
- `GET /buckets/{bucket_id}/todos/{id}.json` - Get single to-do
- `GET /buckets/{bucket_id}/message_boards/{message_board_id}/messages.json` - Get messages
- `GET /buckets/{bucket_id}/messages/{id}.json` - Get single message
- `GET /buckets/{bucket_id}/recordings/{recording_id}/comments.json` - Get comments
- `GET /buckets/{bucket_id}/comments/{id}.json` - Get single comment
- `GET /buckets/{bucket_id}/card_tables/{id}.json` - Get card table
- `GET /buckets/{bucket_id}/card_tables/lists/{column_id}/cards.json` - Get cards in column
- `GET /buckets/{bucket_id}/card_tables/cards/{id}.json` - Get single card
- `GET /buckets/{bucket_id}/vaults/{vault_id}/uploads.json` - Get uploads
- `GET /buckets/{bucket_id}/uploads/{id}.json` - Get single upload
- `GET /buckets/{bucket_id}/vaults/{vault_id}/documents.json` - Get documents
- `GET /buckets/{bucket_id}/documents/{id}.json` - Get single document
- `GET /buckets/{bucket_id}/schedules/{schedule_id}/entries.json` - Get schedule entries
- `GET /buckets/{bucket_id}/schedule_entries/{id}.json` - Get single schedule entry
- `GET /buckets/{bucket_id}/schedule_entries/{id}/occurrences/{date}.json` - Get recurring entry occurrence
- `GET /projects/recordings.json` - Get recordings

### POST Endpoints (Create Operations)
- `POST /projects.json` - Create project
- `POST /buckets/{bucket_id}/todosets/{todoset_id}/todolists.json` - Create to-do list
- `POST /buckets/{bucket_id}/todolists/{todolist_id}/todos.json` - Create to-do
- `POST /buckets/{bucket_id}/todos/{id}/completion.json` - Complete to-do
- `POST /buckets/{bucket_id}/message_boards/{message_board_id}/messages.json` - Create message
- `POST /buckets/{bucket_id}/recordings/{recording_id}/comments.json` - Create comment
- `POST /buckets/{bucket_id}/recordings/{id}/pin.json` - Pin message
- `POST /buckets/{bucket_id}/card_tables/lists/{column_id}/cards.json` - Create card
- `POST /buckets/{bucket_id}/card_tables/cards/{id}/moves.json` - Move card
- `POST /buckets/{bucket_id}/vaults/{vault_id}/uploads.json` - Create upload
- `POST /buckets/{bucket_id}/vaults/{vault_id}/documents.json` - Create document
- `POST /buckets/{bucket_id}/schedules/{schedule_id}/entries.json` - Create schedule entry

### PUT Endpoints (Update Operations)
- `PUT /projects/{id}.json` - Update project
- `PUT /projects/{id}/people/users.json` - Update project access
- `PUT /buckets/{bucket_id}/todolists/{id}.json` - Update to-do list
- `PUT /buckets/{bucket_id}/todos/{id}.json` - Update to-do
- `PUT /buckets/{bucket_id}/todos/{id}/position.json` - Reposition to-do
- `PUT /buckets/{bucket_id}/messages/{id}.json` - Update message
- `PUT /buckets/{bucket_id}/comments/{id}.json` - Update comment
- `PUT /buckets/{bucket_id}/card_tables/cards/{id}.json` - Update card
- `PUT /buckets/{bucket_id}/uploads/{id}.json` - Update upload
- `PUT /buckets/{bucket_id}/documents/{id}.json` - Update document
- `PUT /buckets/{bucket_id}/schedule_entries/{id}.json` - Update schedule entry
- `PUT /buckets/{bucket_id}/recordings/{id}/status/trashed.json` - Trash recording
- `PUT /buckets/{bucket_id}/recordings/{id}/status/archived.json` - Archive recording
- `PUT /buckets/{bucket_id}/recordings/{id}/status/active.json` - Unarchive recording

### DELETE Endpoints (Delete Operations)
- `DELETE /projects/{id}.json` - Trash project
- `DELETE /buckets/{bucket_id}/todos/{id}/completion.json` - Uncomplete to-do
- `DELETE /buckets/{bucket_id}/recordings/{id}/pin.json` - Unpin message

---

## RESOURCE TYPE ORGANIZATION

### Project Management
- Projects
- People

### Content/Communication
- Messages
- Comments
- Documents
- Uploads

### Tasks/Organization
- To-do Lists
- To-dos
- Schedule Entries

### Kanban/Cards
- Card Tables
- Card Table Cards

### Generic
- Recordings (covers all resource types)

---

## KEY PATTERNS

### Path Structure
```
/buckets/{bucket_id}/          - Project container
/projects/{project_id}/        - Project operations
/people/{person_id}/           - Person operations
/{resource_type}/{id}/         - Generic resource
/my/                          - Current user operations
```

### Response Codes
- `200 OK` - Successful read or update
- `201 Created` - Successful creation
- `204 No Content` - Successful action with no response body
- `404 Not Found` - Resource not found
- `507 Insufficient Storage` - Account plan limit reached

### Pagination
- List endpoints return paginated results by default
- Use standard pagination parameters (page, per_page, offset, etc.)
- See README for pagination details

### Status Operations
- Active/Trashed/Archived: `PUT /buckets/{bucket_id}/recordings/{id}/status/{status}.json`
- Statuses: `active`, `trashed`, `archived`

### Common Optional Query Parameters
- `status` - Filter by status
- `sort` - Sort by field
- `direction` - Sort direction (asc/desc)

### Rich Text
- Many fields support HTML content
- See Rich text guide for allowed tags
- Fields: `content`, `description`, `subject` (messages)

---

## AUTHENTICATION

All endpoints require:
- **Header**: `Authorization: Bearer $ACCESS_TOKEN`
- **Header**: `Content-Type: application/json` (for requests with body)

Base URL: `https://3.basecampapi.com/{ACCOUNT_ID}`

---

## NOTES

1. **Recurring Schedule Entries**: Include `recurrence_schedule` object with frequency, days, hour, minute, week_instance, start_date, end_date
2. **Comments**: Available on any resource with `comments_count` and `comments_url` attributes
3. **Rich Text**: Supports HTML with restricted tag set
4. **Attachments**: Use signed global ID (sgid) for uploads
5. **Timestamps**: All dates use ISO 8601 format
6. **Bucket ID**: Project ID is referred to as `bucket_id` in API paths

---

Generated from official basecamp/bc3-api repository documentation
