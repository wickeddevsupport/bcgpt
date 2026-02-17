# Apps Milestone 2 Backlog

## Done
- [x] Publisher metadata model extended in `flow_gallery_app`
- [x] Postgres migration for publisher fields + uniqueness
- [x] Authenticated publisher APIs added under `/apps/api/publisher/*`
- [x] Flow Gallery README updated with publisher endpoints

## Next
- [ ] React UI: creator page to manage published apps (list/publish/unpublish/update)
- [ ] Add "Publish as App" action in flow/template UX
- [ ] Validate `inputSchema` and `outputSchema` with stricter schemas
- [ ] Integrate `/apps/:id/execute` with real webhook execution path
- [ ] Add execution telemetry persistence (table + dashboard)
- [ ] Add integration tests for publisher endpoints

## Suggested Order
1. Creator page (minimal): list templates + publish form.
2. App runner integration: replace mock output with live execution.
3. UX polish: schema-driven form controls and output renderer.
4. Observability: execution logs + basic stats.

