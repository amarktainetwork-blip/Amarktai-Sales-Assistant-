CREATE TABLE `salesWorkItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`salespersonUserId` int,
	`connectedSystemId` int,
	`sourceKey` varchar(255) NOT NULL,
	`sourceType` varchar(80) NOT NULL,
	`sourceExternalId` varchar(180) NOT NULL,
	`contactExternalId` varchar(180),
	`companyExternalId` varchar(180),
	`opportunityExternalId` varchar(180),
	`taskExternalId` varchar(180),
	`type` varchar(80) NOT NULL,
	`priority` int NOT NULL DEFAULT 0,
	`dueAt` timestamp,
	`reason` text NOT NULL,
	`status` enum('open','in_progress','snoozed','completed','blocked') NOT NULL DEFAULT 'open',
	`recommendedNextAction` text NOT NULL,
	`automationEligibility` enum('disabled','propose','automatic') NOT NULL DEFAULT 'propose',
	`approvalRequirement` enum('none','salesperson','manager') NOT NULL DEFAULT 'salesperson',
	`freshness` enum('current','stale','disconnected','unknown') NOT NULL DEFAULT 'unknown',
	`sourceUpdatedAt` timestamp,
	`syncedAt` timestamp NOT NULL DEFAULT (now()),
	`metadata` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `salesWorkItems_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_work_items_org_source_key_unique` UNIQUE(`organisationId`,`sourceKey`)
);
--> statement-breakpoint
ALTER TABLE `salesWorkItems` ADD CONSTRAINT `salesWorkItems_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salesWorkItems` ADD CONSTRAINT `salesWorkItems_salespersonUserId_users_id_fk` FOREIGN KEY (`salespersonUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salesWorkItems` ADD CONSTRAINT `salesWorkItems_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `sales_work_items_org_user_status_due_idx` ON `salesWorkItems` (`organisationId`,`salespersonUserId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `sales_work_items_org_priority_idx` ON `salesWorkItems` (`organisationId`,`priority`,`updatedAt`);