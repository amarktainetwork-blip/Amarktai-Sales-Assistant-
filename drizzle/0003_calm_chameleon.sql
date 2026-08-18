CREATE TABLE `automationPlaybooks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(220) NOT NULL,
	`trigger` varchar(160) NOT NULL,
	`description` text NOT NULL,
	`agentKey` varchar(80) NOT NULL,
	`requiredCapabilities` json NOT NULL,
	`reviewRequired` boolean NOT NULL DEFAULT true,
	`status` enum('draft','active','paused') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `automationPlaybooks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `companyProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`companyName` varchar(220) NOT NULL,
	`websiteUrl` varchar(1024),
	`industry` varchar(180),
	`companySize` varchar(80),
	`primaryMarket` varchar(220),
	`salesMotion` varchar(180),
	`brandVoice` text,
	`discoveryStatus` enum('not_started','review_required','confirmed','failed') NOT NULL DEFAULT 'not_started',
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `companyProfiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `companyProfiles_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `crmConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('genie','hubspot','salesforce','pipedrive','custom_browser') NOT NULL,
	`displayName` varchar(180) NOT NULL,
	`status` enum('draft','needs_credentials','ready','paused','error') NOT NULL DEFAULT 'draft',
	`capabilities` json NOT NULL,
	`connectionMode` enum('api','browser_automation','custom') NOT NULL,
	`configurationHint` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crmConnections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `websiteDiscoveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`companyProfileId` int NOT NULL,
	`sourceUrl` varchar(1024) NOT NULL,
	`pageTitle` varchar(500),
	`extractedText` text,
	`proposedFacts` json NOT NULL,
	`proposedKnowledge` json NOT NULL,
	`status` enum('review_required','confirmed','rejected','failed') NOT NULL DEFAULT 'review_required',
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `websiteDiscoveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `automationPlaybooks` ADD CONSTRAINT `automationPlaybooks_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `companyProfiles` ADD CONSTRAINT `companyProfiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmConnections` ADD CONSTRAINT `crmConnections_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `websiteDiscoveries` ADD CONSTRAINT `websiteDiscoveries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `websiteDiscoveries` ADD CONSTRAINT `websiteDiscoveries_companyProfileId_companyProfiles_id_fk` FOREIGN KEY (`companyProfileId`) REFERENCES `companyProfiles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `automationPlaybooks_user_status_idx` ON `automationPlaybooks` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `companyProfiles_user_idx` ON `companyProfiles` (`userId`);--> statement-breakpoint
CREATE INDEX `crmConnections_user_provider_idx` ON `crmConnections` (`userId`,`provider`);--> statement-breakpoint
CREATE INDEX `websiteDiscoveries_user_created_idx` ON `websiteDiscoveries` (`userId`,`createdAt`);