# kokoto

kokoto is Pick My Fruit's SQLite-backed durable workflow runtime.

## v1 contract

- Workflows are persisted in `_dc_workflow`; steps are persisted in `_dc_step`.
- A successful step row is the replay boundary. When `_dc_step` contains a
  `success` row for `(workflow_id, step_id)`, kokoto returns the stored output
  and does not call the step function again.
- External providers remain at-least-once. A crash after Resend, Tigris, or a
  database accepts work but before the step row commits can run the step again.
  Mutable provider calls must use stable idempotency keys such as
  `ctx.stepKey("sendOwnerEmail")` or a business key.
- Workflow code should avoid `Date.now()`, `Math.random()`, and I/O outside
  `ctx.step()`. Use `ctx.now()` for the deterministic workflow start timestamp.
- Steps should target <=16 ms of synchronous CPU. Put heavy work such as Sharp
  processing inside async steps protected by queue concurrency limits, and set
  `budgetWarnMs` for known slow I/O steps.

## Public API

- `defineWorkflow(name, handler)`
- `defineQueue(name, { concurrency })`
- `createRuntime({ client })`
- `runtime.start({ workflows, queues })`
- `runtime.start(workflow, { input, queue, idempotencyKey })`
- `handle.result()` / `handle.cancel()` / `runtime.cancel(id)`
