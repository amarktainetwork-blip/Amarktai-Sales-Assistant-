ALTER TABLE `crmConnections` MODIFY COLUMN `status` enum('draft','needs_credentials','verifying','ready','paused','error','connector_not_implemented') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `crmConnections` ADD `verifiedAt` timestamp;--> statement-breakpoint
ALTER TABLE `crmConnections` ADD `verificationExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `crmConnections` ADD `verificationFailure` varchar(300);--> statement-breakpoint
ALTER TABLE `crmConnections` ADD `verificationEvidence` json;