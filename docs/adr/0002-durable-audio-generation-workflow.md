---
status: accepted
---

# Run Audio Overview generation as a durable Workflow

Audio Overview generation will run in a standalone Cloudflare Worker containing a Cloudflare Workflow, invoked from the existing Pages application through a service binding. This adds a separately deployed component but gives every paid and stateful step durable retry, cancellation, and idempotency boundaries; a long-lived Pages request or best-effort background continuation cannot provide those guarantees.
