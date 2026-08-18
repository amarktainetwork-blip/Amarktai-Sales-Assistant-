CREATE TABLE `actionProposals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`workflowRunId` int NOT NULL,
	`actionType` varchar(80) NOT NULL,
	`title` varchar(220) NOT NULL,
	`targetLabel` varchar(180) NOT NULL,
	`state` enum('review_required','approved','skipped','executed','blocked') NOT NULL DEFAULT 'review_required',
	`idempotencyKey` varchar(255) NOT NULL,
	`payload` json NOT NULL,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `actionProposals_id` PRIMARY KEY(`id`),
	CONSTRAINT `actionProposals_idempotency_uq` UNIQUE(`userId`,`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `auditEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`eventType` varchar(100) NOT NULL,
	`entityType` varchar(100) NOT NULL,
	`entityId` varchar(100),
	`summary` text NOT NULL,
	`metadata` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditEntries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `callSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`leadLabel` varchar(160) NOT NULL,
	`status` enum('in_progress','ready_for_review','completed') NOT NULL DEFAULT 'ready_for_review',
	`audioKey` varchar(512),
	`transcript` text,
	`coachNotes` text,
	`summary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `callSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `callbackTasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`leadLabel` varchar(160) NOT NULL,
	`title` varchar(160) NOT NULL,
	`priority` enum('low','normal','high') NOT NULL DEFAULT 'normal',
	`state` enum('open','completed','blocked') NOT NULL DEFAULT 'open',
	`dueAt` timestamp,
	`externalTaskId` varchar(160),
	`idempotencyKey` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `callbackTasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `callbackTasks_idempotency_uq` UNIQUE(`userId`,`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `integrationProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('genie','outlook','genx') NOT NULL,
	`displayName` varchar(140) NOT NULL,
	`status` enum('needs_credentials','ready','paused','error') NOT NULL DEFAULT 'needs_credentials',
	`scopeSummary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrationProfiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledgeSources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(220) NOT NULL,
	`sourceType` enum('note','url','document') NOT NULL DEFAULT 'note',
	`sourceUrl` varchar(1024),
	`content` text,
	`status` enum('draft','ready','needs_review') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledgeSources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `workflowRuns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`workflowKey` varchar(80) NOT NULL,
	`leadLabel` varchar(160) NOT NULL,
	`status` enum('prepared','blocked','approved','completed','failed') NOT NULL DEFAULT 'prepared',
	`input` json NOT NULL,
	`verificationSummary` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workflowRuns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `actionProposals` ADD CONSTRAINT `actionProposals_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `actionProposals` ADD CONSTRAINT `actionProposals_workflowRunId_workflowRuns_id_fk` FOREIGN KEY (`workflowRunId`) REFERENCES `workflowRuns`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auditEntries` ADD CONSTRAINT `auditEntries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `callSessions` ADD CONSTRAINT `callSessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `callbackTasks` ADD CONSTRAINT `callbackTasks_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationProfiles` ADD CONSTRAINT `integrationProfiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `knowledgeSources` ADD CONSTRAINT `knowledgeSources_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflowRuns` ADD CONSTRAINT `workflowRuns_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `actionProposals_user_state_idx` ON `actionProposals` (`userId`,`state`);--> statement-breakpoint
CREATE INDEX `actionProposals_run_idx` ON `actionProposals` (`workflowRunId`);--> statement-breakpoint
CREATE INDEX `auditEntries_user_created_idx` ON `auditEntries` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `callSessions_user_created_idx` ON `callSessions` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `callbackTasks_user_state_due_idx` ON `callbackTasks` (`userId`,`state`,`dueAt`);--> statement-breakpoint
CREATE INDEX `integrationProfiles_user_provider_idx` ON `integrationProfiles` (`userId`,`provider`);--> statement-breakpoint
CREATE INDEX `knowledgeSources_user_status_idx` ON `knowledgeSources` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `workflowRuns_user_created_idx` ON `workflowRuns` (`userId`,`createdAt`);