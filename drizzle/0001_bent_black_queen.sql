CREATE TABLE `dailyReports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`recipientEmail` varchar(320) NOT NULL,
	`cronExpression` varchar(64) NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`isEnabled` boolean NOT NULL DEFAULT true,
	`lastDeliveryKey` varchar(32),
	`lastSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dailyReports_id` PRIMARY KEY(`id`),
	CONSTRAINT `dailyReports_task_uid_uq` UNIQUE(`scheduleCronTaskUid`)
);
--> statement-breakpoint
CREATE TABLE `twoFactorChallenges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`purpose` enum('workspace_access') NOT NULL DEFAULT 'workspace_access',
	`codeHash` varchar(128) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `twoFactorChallenges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `dailyReports` ADD CONSTRAINT `dailyReports_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `twoFactorChallenges` ADD CONSTRAINT `twoFactorChallenges_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `dailyReports_user_enabled_idx` ON `dailyReports` (`userId`,`isEnabled`);--> statement-breakpoint
CREATE INDEX `twoFactorChallenges_user_created_idx` ON `twoFactorChallenges` (`userId`,`createdAt`);