CREATE TABLE `agentResponseCache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentKey` varchar(80) NOT NULL,
	`requestHash` varchar(64) NOT NULL,
	`policyVersion` varchar(32) NOT NULL,
	`content` text NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentResponseCache_id` PRIMARY KEY(`id`),
	CONSTRAINT `agentResponseCache_lookup_uq` UNIQUE(`userId`,`agentKey`,`requestHash`,`policyVersion`)
);
--> statement-breakpoint
CREATE TABLE `agentUsageEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentKey` varchar(80) NOT NULL,
	`model` varchar(160),
	`cacheHit` boolean NOT NULL DEFAULT false,
	`inputTokens` int,
	`outputTokens` int,
	`inputChars` int NOT NULL,
	`outputChars` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentUsageEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `communicationDrafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`leadLabel` varchar(180),
	`recipientEmail` varchar(320) NOT NULL,
	`subject` varchar(300) NOT NULL,
	`body` text NOT NULL,
	`purpose` varchar(160) NOT NULL,
	`qualityChecks` json NOT NULL,
	`state` enum('draft','review_required','approved','rejected') NOT NULL DEFAULT 'review_required',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`reviewedAt` timestamp,
	CONSTRAINT `communicationDrafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crmContextSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`leadLabel` varchar(180) NOT NULL,
	`source` enum('genie_browser','manual') NOT NULL,
	`context` json NOT NULL,
	`summary` text NOT NULL,
	`refreshedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crmContextSnapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `crmContextSnapshots_user_lead_uq` UNIQUE(`userId`,`leadLabel`)
);
--> statement-breakpoint
CREATE TABLE `managerFindings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`findingKey` varchar(255) NOT NULL,
	`severity` enum('critical','high','normal','info') NOT NULL,
	`state` enum('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
	`title` varchar(220) NOT NULL,
	`detail` text NOT NULL,
	`targetType` varchar(100),
	`targetId` varchar(100),
	`metadata` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `managerFindings_id` PRIMARY KEY(`id`),
	CONSTRAINT `managerFindings_user_key_uq` UNIQUE(`userId`,`findingKey`)
);
--> statement-breakpoint
ALTER TABLE `agentResponseCache` ADD CONSTRAINT `agentResponseCache_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agentUsageEvents` ADD CONSTRAINT `agentUsageEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `communicationDrafts` ADD CONSTRAINT `communicationDrafts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmContextSnapshots` ADD CONSTRAINT `crmContextSnapshots_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `managerFindings` ADD CONSTRAINT `managerFindings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `agentResponseCache_user_expiry_idx` ON `agentResponseCache` (`userId`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `agentUsageEvents_user_created_idx` ON `agentUsageEvents` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `agentUsageEvents_user_agent_idx` ON `agentUsageEvents` (`userId`,`agentKey`);--> statement-breakpoint
CREATE INDEX `communicationDrafts_user_state_idx` ON `communicationDrafts` (`userId`,`state`);--> statement-breakpoint
CREATE INDEX `crmContextSnapshots_user_expiry_idx` ON `crmContextSnapshots` (`userId`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `managerFindings_user_state_idx` ON `managerFindings` (`userId`,`state`);