# Self-hosted runtime cleanup notes

The Webdock release branch no longer registers managed OAuth or storage proxy routes, and protected REST routes now derive identity only from the local signed session plus the existing second-factor verification. The managed SDK, OAuth, storage proxy, Forge image-generation, data, map, notification, generic LLM, and transcription wrappers have been removed after reference tracing.

Legacy heartbeat callers now use a local compatibility contract while durable scheduled report rows are evaluated by `server/reportSchedulerWorker.ts`. This avoids a hosted scheduler dependency during the staged CRM and onboarding consolidation. A fresh `pnpm check` passed immediately after the server cleanup; remaining client work is limited to replacing old managed OAuth redirect and managed marketing image paths.
