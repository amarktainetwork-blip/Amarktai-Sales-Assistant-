ALTER TABLE `workflowRuns` ADD `idempotencyKey` varchar(255);--> statement-breakpoint
ALTER TABLE `workflowRuns` ADD `claimToken` varchar(64);--> statement-breakpoint
ALTER TABLE `workflowRuns` ADD `claimExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `workflowRuns` ADD `result` json;--> statement-breakpoint
ALTER TABLE `workflowRuns` ADD CONSTRAINT `workflowRuns_user_idempotency_uq` UNIQUE(`userId`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `workflowRuns_claim_expiry_idx` ON `workflowRuns` (`status`,`claimExpiresAt`);