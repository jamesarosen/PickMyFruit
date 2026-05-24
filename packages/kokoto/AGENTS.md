# kokoto package notes

- Keep all files server-only; this package touches SQLite and must not enter a
  browser graph.
- Workflow bodies must be deterministic. Put I/O, wall-clock reads, and random
  values inside `ctx.step()`.
- Mutable external provider calls need stable idempotency keys because providers
  can accept work before kokoto commits the step row.
- Steps should target <=16 ms of synchronous CPU. Use named queues for expensive
  async work.
