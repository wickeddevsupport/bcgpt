# Intelligent Routing Prompts (Phase 4)

These prompts are designed to validate smart_action routing and the new iteration/caching guarantees. Use them as regression checks or demo flows.

## Summaries & full-dump workflows
1. "Summarize the Sales project with all card tables, all cards, and open todos."
2. "Dump every card (with descriptions) across all boards in Internal Wicked Websites."
3. "Give me a project status summary that includes messages, uploads, and schedule entries."

## Events & audit trail
4. "Show all changes on todo 12345 in Sales."
5. "List every event for the card 98765 and include the timeline."

## Timesheets
6. "Generate a weekly timesheet summary for project X."
7. "Show all time entries for recording 5555 in project Y."

## Questionnaires
8. "List all questions and answers for the onboarding questionnaire."
9. "Show answers by person for question 999."

## Inboxes / forwards
10. "List all inbox forwards and replies for Client Support."

## Routing checks
11. "Find anything related to 'SEO migration' across projects."
12. "Summarize my assigned work across all projects."

## Notes
- Each summary prompt should verify pagination metadata (`_meta.pages`, `truncated`, `next_url`) and cached payload keys.
- When payloads are too large, smart_action should return the first chunk plus a cache key for continuation.
