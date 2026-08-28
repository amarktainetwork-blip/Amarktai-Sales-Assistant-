CREATE TABLE `companyKnowledgeJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`organisationId` int NOT NULL,
	`companyProfileId` int NOT NULL,
	`websiteUrl` varchar(1024) NOT NULL,
	`phase` enum('SCANNING_WEBSITE','CLASSIFYING_PAGES','UNDERSTANDING_OFFERINGS','REVIEWING_PRICING_POLICIES','RECONCILING_KNOWLEDGE','CHECKING_COMPLETENESS','READY_FOR_REVIEW') NOT NULL DEFAULT 'SCANNING_WEBSITE',
	`status` enum('queued','running','ready','needs_attention','failed','cancelled') NOT NULL DEFAULT 'queued',
	`progress` json NOT NULL,
	`discoverySnapshot` longtext,
	`pageInventory` json,
	`mapResults` json,
	`resultDiscoveryId` int,
	`attempt` int NOT NULL DEFAULT 0,
	`leaseExpiresAt` timestamp,
	`lastError` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `companyKnowledgeJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD CONSTRAINT `companyKnowledgeJobs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD CONSTRAINT `companyKnowledgeJobs_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD CONSTRAINT `companyKnowledgeJobs_companyProfileId_companyProfiles_id_fk` FOREIGN KEY (`companyProfileId`) REFERENCES `companyProfiles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD CONSTRAINT `companyKnowledgeJobs_resultDiscoveryId_websiteDiscoveries_id_fk` FOREIGN KEY (`resultDiscoveryId`) REFERENCES `websiteDiscoveries`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `company_knowledge_profile_created_idx` ON `companyKnowledgeJobs` (`companyProfileId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `company_knowledge_org_status_idx` ON `companyKnowledgeJobs` (`organisationId`,`status`);--> statement-breakpoint
CREATE INDEX `company_knowledge_status_lease_idx` ON `companyKnowledgeJobs` (`status`,`leaseExpiresAt`);