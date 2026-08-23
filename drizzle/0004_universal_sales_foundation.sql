CREATE TABLE `authorisedDomains` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`hostname` varchar(253) NOT NULL,
	`allowedPaths` json NOT NULL,
	`status` enum('pending','verified','paused','revoked') NOT NULL DEFAULT 'pending',
	`verifiedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `authorisedDomains_id` PRIMARY KEY(`id`),
	CONSTRAINT `authorised_domains_system_host_unique` UNIQUE(`connectedSystemId`,`hostname`)
);
--> statement-breakpoint
CREATE TABLE `connectedSystems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`provider` enum('genie','hubspot','salesforce','pipedrive','zoho','custom_browser','custom_api','csv_import') NOT NULL,
	`displayName` varchar(180) NOT NULL,
	`baseUrl` varchar(1024),
	`connectionMethod` enum('oauth','browser','sidecar','custom_adapter','import') NOT NULL,
	`status` enum('connecting','testing','ready','needs_attention','authentication_expired','limited_permissions','paused','disconnected','error') NOT NULL DEFAULT 'disconnected',
	`allowedReadCapabilities` json NOT NULL,
	`allowedWriteCapabilities` json NOT NULL,
	`verifiedCapabilities` json NOT NULL,
	`accountExternalId` varchar(180),
	`scopes` json NOT NULL,
	`configuration` json NOT NULL,
	`lastHealthCheckAt` timestamp,
	`lastHealthSummary` text,
	`readyAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `connectedSystems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `connectionSecrets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`connectedSystemId` int NOT NULL,
	`secretKind` varchar(80) NOT NULL,
	`keyVersion` varchar(64) NOT NULL,
	`iv` varchar(128) NOT NULL,
	`authTag` varchar(128) NOT NULL,
	`ciphertext` text NOT NULL,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `connectionSecrets_id` PRIMARY KEY(`id`),
	CONSTRAINT `connection_secrets_system_kind_unique` UNIQUE(`connectedSystemId`,`secretKind`)
);
--> statement-breakpoint
CREATE TABLE `connectorVerificationRuns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`connectedSystemId` int NOT NULL,
	`correlationId` varchar(80) NOT NULL,
	`status` enum('testing','ready','limited','failed') NOT NULL,
	`capabilities` json NOT NULL,
	`summary` text NOT NULL,
	`evidence` json NOT NULL,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `connectorVerificationRuns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crmActivities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`externalId` varchar(180) NOT NULL,
	`contactExternalId` varchar(180),
	`opportunityExternalId` varchar(180),
	`ownerExternalId` varchar(180),
	`activityType` varchar(120) NOT NULL,
	`occurredAt` timestamp NOT NULL,
	`body` text,
	`sourceRevision` varchar(180),
	`raw` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crmActivities_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_activities_system_external_unique` UNIQUE(`connectedSystemId`,`externalId`)
);
--> statement-breakpoint
CREATE TABLE `crmCompanies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`externalId` varchar(180) NOT NULL,
	`name` varchar(320) NOT NULL,
	`website` varchar(1024),
	`ownerExternalId` varchar(180),
	`sourceUpdatedAt` timestamp,
	`sourceRevision` varchar(180),
	`raw` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crmCompanies_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_companies_system_external_unique` UNIQUE(`connectedSystemId`,`externalId`)
);
--> statement-breakpoint
CREATE TABLE `crmContacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`externalId` varchar(180) NOT NULL,
	`companyExternalId` varchar(180),
	`ownerExternalId` varchar(180),
	`firstName` varchar(160),
	`lastName` varchar(160),
	`email` varchar(320),
	`phone` varchar(80),
	`lifecycleStage` varchar(120),
	`sourceUpdatedAt` timestamp,
	`sourceRevision` varchar(180),
	`raw` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crmContacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_contacts_system_external_unique` UNIQUE(`connectedSystemId`,`externalId`)
);
--> statement-breakpoint
CREATE TABLE `crmOpportunities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`externalId` varchar(180) NOT NULL,
	`companyExternalId` varchar(180),
	`contactExternalId` varchar(180),
	`ownerExternalId` varchar(180),
	`name` varchar(320) NOT NULL,
	`pipeline` varchar(180),
	`stage` varchar(180),
	`valueMinor` int,
	`currency` varchar(8),
	`closeAt` timestamp,
	`lastActivityAt` timestamp,
	`nextStepAt` timestamp,
	`sourceUpdatedAt` timestamp,
	`sourceRevision` varchar(180),
	`raw` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crmOpportunities_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_opportunities_system_external_unique` UNIQUE(`connectedSystemId`,`externalId`)
);
--> statement-breakpoint
CREATE TABLE `crmSyncCursors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`connectedSystemId` int NOT NULL,
	`resourceType` varchar(80) NOT NULL,
	`cursor` text,
	`sourceCheckpoint` varchar(255),
	`lastSuccessfulAt` timestamp,
	`lastError` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crmSyncCursors_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_sync_cursors_system_resource_unique` UNIQUE(`connectedSystemId`,`resourceType`)
);
--> statement-breakpoint
CREATE TABLE `crmTasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`externalId` varchar(180) NOT NULL,
	`contactExternalId` varchar(180),
	`opportunityExternalId` varchar(180),
	`ownerExternalId` varchar(180),
	`title` varchar(320) NOT NULL,
	`status` varchar(120) NOT NULL,
	`dueAt` timestamp,
	`completedAt` timestamp,
	`sourceUpdatedAt` timestamp,
	`sourceRevision` varchar(180),
	`raw` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crmTasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_tasks_system_external_unique` UNIQUE(`connectedSystemId`,`externalId`)
);
--> statement-breakpoint
CREATE TABLE `externalUserMappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`userId` int,
	`externalUserId` varchar(180) NOT NULL,
	`displayName` varchar(220) NOT NULL,
	`email` varchar(320),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `externalUserMappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `external_user_mapping_system_external_unique` UNIQUE(`connectedSystemId`,`externalUserId`)
);
--> statement-breakpoint
CREATE TABLE `organisationMembers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','manager','salesperson','auditor') NOT NULL DEFAULT 'salesperson',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organisationMembers_id` PRIMARY KEY(`id`),
	CONSTRAINT `organisation_members_unique` UNIQUE(`organisationId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `organisations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`name` varchar(220) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`timezone` varchar(80) NOT NULL DEFAULT 'UTC',
	`locale` varchar(24) NOT NULL DEFAULT 'en',
	`currency` varchar(8) NOT NULL DEFAULT 'USD',
	`settings` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organisations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organisations_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `salesActivityEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int,
	`salespersonUserId` int,
	`externalOwnerId` varchar(180),
	`contactExternalId` varchar(180),
	`opportunityExternalId` varchar(180),
	`eventType` varchar(120) NOT NULL,
	`source` varchar(80) NOT NULL,
	`occurredAt` timestamp NOT NULL,
	`externalId` varchar(180),
	`metadata` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `salesActivityEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_activity_events_source_external_unique` UNIQUE(`connectedSystemId`,`externalId`)
);
--> statement-breakpoint
ALTER TABLE `authorisedDomains` ADD CONSTRAINT `authorisedDomains_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `authorisedDomains` ADD CONSTRAINT `authorisedDomains_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connectedSystems` ADD CONSTRAINT `connectedSystems_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connectionSecrets` ADD CONSTRAINT `connectionSecrets_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connectorVerificationRuns` ADD CONSTRAINT `connector_verification_runs_connected_system_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmActivities` ADD CONSTRAINT `crmActivities_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmActivities` ADD CONSTRAINT `crmActivities_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmCompanies` ADD CONSTRAINT `crmCompanies_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmCompanies` ADD CONSTRAINT `crmCompanies_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmContacts` ADD CONSTRAINT `crmContacts_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmContacts` ADD CONSTRAINT `crmContacts_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmOpportunities` ADD CONSTRAINT `crmOpportunities_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmOpportunities` ADD CONSTRAINT `crmOpportunities_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmSyncCursors` ADD CONSTRAINT `crmSyncCursors_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmTasks` ADD CONSTRAINT `crmTasks_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmTasks` ADD CONSTRAINT `crmTasks_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `externalUserMappings` ADD CONSTRAINT `externalUserMappings_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `externalUserMappings` ADD CONSTRAINT `externalUserMappings_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `externalUserMappings` ADD CONSTRAINT `externalUserMappings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organisationMembers` ADD CONSTRAINT `organisationMembers_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organisationMembers` ADD CONSTRAINT `organisationMembers_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organisations` ADD CONSTRAINT `organisations_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salesActivityEvents` ADD CONSTRAINT `salesActivityEvents_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salesActivityEvents` ADD CONSTRAINT `salesActivityEvents_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salesActivityEvents` ADD CONSTRAINT `salesActivityEvents_salespersonUserId_users_id_fk` FOREIGN KEY (`salespersonUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `authorised_domains_org_status_idx` ON `authorisedDomains` (`organisationId`,`status`);--> statement-breakpoint
CREATE INDEX `connected_systems_org_status_idx` ON `connectedSystems` (`organisationId`,`status`);--> statement-breakpoint
CREATE INDEX `connected_systems_org_provider_idx` ON `connectedSystems` (`organisationId`,`provider`);--> statement-breakpoint
CREATE INDEX `connector_verification_system_created_idx` ON `connectorVerificationRuns` (`connectedSystemId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `crm_activities_org_owner_occurred_idx` ON `crmActivities` (`organisationId`,`ownerExternalId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `crm_companies_org_owner_idx` ON `crmCompanies` (`organisationId`,`ownerExternalId`);--> statement-breakpoint
CREATE INDEX `crm_contacts_org_owner_idx` ON `crmContacts` (`organisationId`,`ownerExternalId`);--> statement-breakpoint
CREATE INDEX `crm_contacts_org_email_idx` ON `crmContacts` (`organisationId`,`email`);--> statement-breakpoint
CREATE INDEX `crm_opportunities_org_owner_stage_idx` ON `crmOpportunities` (`organisationId`,`ownerExternalId`,`stage`);--> statement-breakpoint
CREATE INDEX `crm_opportunities_org_activity_idx` ON `crmOpportunities` (`organisationId`,`lastActivityAt`);--> statement-breakpoint
CREATE INDEX `crm_tasks_org_owner_due_idx` ON `crmTasks` (`organisationId`,`ownerExternalId`,`dueAt`);--> statement-breakpoint
CREATE INDEX `external_user_mapping_org_user_idx` ON `externalUserMappings` (`organisationId`,`userId`);--> statement-breakpoint
CREATE INDEX `organisation_members_user_idx` ON `organisationMembers` (`userId`,`isActive`);--> statement-breakpoint
CREATE INDEX `organisations_owner_idx` ON `organisations` (`ownerUserId`);--> statement-breakpoint
CREATE INDEX `sales_activity_events_org_user_occurred_idx` ON `salesActivityEvents` (`organisationId`,`salespersonUserId`,`occurredAt`);