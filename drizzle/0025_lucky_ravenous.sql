CREATE TABLE `crmCommissioningJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`requestedByUserId` int,
	`connectorClass` enum('native_api','known_browser','unknown_browser') NOT NULL,
	`state` enum('AUTHENTICATE','DISCOVER_NAVIGATION','DISCOVER_CAPABILITIES','TEST_SAFE_READS','AWAIT_SAFE_TEST_RECORD','TEST_CONTROLLED_WRITES','VERIFY_READBACK','PUBLISH_PROVEN_OPERATIONS','READY') NOT NULL,
	`status` enum('queued','running','waiting_for_approval','ready','needs_attention','failed','cancelled') NOT NULL DEFAULT 'queued',
	`progress` json NOT NULL,
	`safeTestRecord` json,
	`discoveredOperationKeys` json NOT NULL,
	`optionalFailures` json NOT NULL,
	`attempt` int NOT NULL DEFAULT 0,
	`cancelRequested` boolean NOT NULL DEFAULT false,
	`leaseExpiresAt` timestamp,
	`lastError` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crmCommissioningJobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_commissioning_system_unique` UNIQUE(`connectedSystemId`)
);
--> statement-breakpoint
ALTER TABLE `crmCommissioningJobs` ADD CONSTRAINT `crmCommissioningJobs_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmCommissioningJobs` ADD CONSTRAINT `crmCommissioningJobs_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmCommissioningJobs` ADD CONSTRAINT `crmCommissioningJobs_requestedByUserId_users_id_fk` FOREIGN KEY (`requestedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `crm_commissioning_org_status_idx` ON `crmCommissioningJobs` (`organisationId`,`status`);--> statement-breakpoint
CREATE INDEX `crm_commissioning_status_lease_idx` ON `crmCommissioningJobs` (`status`,`leaseExpiresAt`);