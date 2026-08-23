CREATE TABLE `coachingRecords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`scorecardId` int,
	`userId` int,
	`coachUserId` int,
	`summary` text NOT NULL,
	`commitments` json NOT NULL,
	`followUpAt` timestamp,
	`status` enum('open','completed','cancelled') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coachingRecords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `forecastSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`quotaPlanId` int,
	`forecastValueMinor` int NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'USD',
	`confidence` int NOT NULL,
	`methodology` varchar(180) NOT NULL,
	`evidence` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `forecastSnapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inboundMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int,
	`externalMessageId` varchar(220) NOT NULL,
	`channel` enum('email','sms','chat','other') NOT NULL,
	`senderReference` varchar(320) NOT NULL,
	`subject` varchar(500),
	`body` text NOT NULL,
	`classification` json,
	`status` enum('received','classified','draft_ready','archived') NOT NULL DEFAULT 'received',
	`receivedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inboundMessages_id` PRIMARY KEY(`id`),
	CONSTRAINT `inbound_messages_system_external_unique` UNIQUE(`connectedSystemId`,`externalMessageId`)
);
--> statement-breakpoint
CREATE TABLE `inboundReplyDrafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`inboundMessageId` int NOT NULL,
	`draftBody` text NOT NULL,
	`rationale` text NOT NULL,
	`qualityChecks` json NOT NULL,
	`status` enum('draft','approved','rejected','sent','cancelled') NOT NULL DEFAULT 'draft',
	`approvedByUserId` int,
	`approvedAt` timestamp,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inboundReplyDrafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `qaRubrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`criteria` json NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `qaRubrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `qaScorecards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`rubricId` int NOT NULL,
	`reviewedUserId` int,
	`reviewerUserId` int,
	`sourceType` enum('call','message','proposal','workflow') NOT NULL,
	`sourceReference` varchar(220) NOT NULL,
	`scores` json NOT NULL,
	`totalScore` int NOT NULL,
	`feedback` text,
	`status` enum('draft','calibrated','shared') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `qaScorecards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quotaPlans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`territoryId` int,
	`userId` int,
	`periodStart` timestamp NOT NULL,
	`periodEnd` timestamp NOT NULL,
	`targetValueMinor` int NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'USD',
	`capacityAssumption` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quotaPlans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `salesTerritories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`definition` json NOT NULL,
	`ownerUserId` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `salesTerritories_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_territories_org_name_unique` UNIQUE(`organisationId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `ttsGenerationRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`voiceProfileId` int NOT NULL,
	`text` text NOT NULL,
	`status` enum('draft','approved','generated','failed','cancelled') NOT NULL DEFAULT 'draft',
	`approvedByUserId` int,
	`audioStorageKey` varchar(1024),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`generatedAt` timestamp,
	CONSTRAINT `ttsGenerationRequests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ttsVoiceProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`displayName` varchar(180) NOT NULL,
	`providerKey` varchar(100) NOT NULL,
	`voiceReference` varchar(180) NOT NULL,
	`consentStatus` enum('not_recorded','recorded','revoked') NOT NULL DEFAULT 'not_recorded',
	`isActive` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ttsVoiceProfiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `tts_voice_profiles_org_voice_unique` UNIQUE(`organisationId`,`providerKey`,`voiceReference`)
);
--> statement-breakpoint
ALTER TABLE `coachingRecords` ADD CONSTRAINT `coachingRecords_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `coachingRecords` ADD CONSTRAINT `coachingRecords_scorecardId_qaScorecards_id_fk` FOREIGN KEY (`scorecardId`) REFERENCES `qaScorecards`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `coachingRecords` ADD CONSTRAINT `coachingRecords_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `coachingRecords` ADD CONSTRAINT `coachingRecords_coachUserId_users_id_fk` FOREIGN KEY (`coachUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `forecastSnapshots` ADD CONSTRAINT `forecastSnapshots_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `forecastSnapshots` ADD CONSTRAINT `forecastSnapshots_quotaPlanId_quotaPlans_id_fk` FOREIGN KEY (`quotaPlanId`) REFERENCES `quotaPlans`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inboundMessages` ADD CONSTRAINT `inboundMessages_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inboundMessages` ADD CONSTRAINT `inboundMessages_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inboundReplyDrafts` ADD CONSTRAINT `inboundReplyDrafts_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inboundReplyDrafts` ADD CONSTRAINT `inboundReplyDrafts_inboundMessageId_inboundMessages_id_fk` FOREIGN KEY (`inboundMessageId`) REFERENCES `inboundMessages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inboundReplyDrafts` ADD CONSTRAINT `inboundReplyDrafts_approvedByUserId_users_id_fk` FOREIGN KEY (`approvedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qaRubrics` ADD CONSTRAINT `qaRubrics_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qaRubrics` ADD CONSTRAINT `qaRubrics_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qaScorecards` ADD CONSTRAINT `qaScorecards_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qaScorecards` ADD CONSTRAINT `qaScorecards_rubricId_qaRubrics_id_fk` FOREIGN KEY (`rubricId`) REFERENCES `qaRubrics`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qaScorecards` ADD CONSTRAINT `qaScorecards_reviewedUserId_users_id_fk` FOREIGN KEY (`reviewedUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qaScorecards` ADD CONSTRAINT `qaScorecards_reviewerUserId_users_id_fk` FOREIGN KEY (`reviewerUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotaPlans` ADD CONSTRAINT `quotaPlans_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotaPlans` ADD CONSTRAINT `quotaPlans_territoryId_salesTerritories_id_fk` FOREIGN KEY (`territoryId`) REFERENCES `salesTerritories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotaPlans` ADD CONSTRAINT `quotaPlans_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salesTerritories` ADD CONSTRAINT `salesTerritories_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salesTerritories` ADD CONSTRAINT `salesTerritories_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ttsGenerationRequests` ADD CONSTRAINT `ttsGenerationRequests_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ttsGenerationRequests` ADD CONSTRAINT `ttsGenerationRequests_voiceProfileId_ttsVoiceProfiles_id_fk` FOREIGN KEY (`voiceProfileId`) REFERENCES `ttsVoiceProfiles`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ttsGenerationRequests` ADD CONSTRAINT `ttsGenerationRequests_approvedByUserId_users_id_fk` FOREIGN KEY (`approvedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ttsVoiceProfiles` ADD CONSTRAINT `ttsVoiceProfiles_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `coaching_records_org_user_status_idx` ON `coachingRecords` (`organisationId`,`userId`,`status`);--> statement-breakpoint
CREATE INDEX `forecast_snapshots_org_created_idx` ON `forecastSnapshots` (`organisationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `inbound_messages_org_status_received_idx` ON `inboundMessages` (`organisationId`,`status`,`receivedAt`);--> statement-breakpoint
CREATE INDEX `inbound_reply_drafts_org_status_idx` ON `inboundReplyDrafts` (`organisationId`,`status`);--> statement-breakpoint
CREATE INDEX `qa_rubrics_org_active_idx` ON `qaRubrics` (`organisationId`,`isActive`);--> statement-breakpoint
CREATE INDEX `qa_scorecards_org_user_created_idx` ON `qaScorecards` (`organisationId`,`reviewedUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `quota_plans_org_period_idx` ON `quotaPlans` (`organisationId`,`periodStart`,`periodEnd`);--> statement-breakpoint
CREATE INDEX `tts_generation_org_status_idx` ON `ttsGenerationRequests` (`organisationId`,`status`);