ALTER TABLE `actionProposals` ADD `executedAt` timestamp;--> statement-breakpoint
ALTER TABLE `actionProposals` ADD `executionResult` json;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);