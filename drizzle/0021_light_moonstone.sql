CREATE TABLE `assistantMemories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`userId` int NOT NULL,
	`contactExternalId` varchar(160),
	`opportunityExternalId` varchar(160),
	`memoryType` enum('user_preference','customer_fact','commitment','conversation_reference') NOT NULL,
	`subject` varchar(220) NOT NULL,
	`content` text NOT NULL,
	`provenance` enum('user_asserted','crm','call','message','approved_ai_extraction') NOT NULL,
	`trust` enum('confirmed','user_asserted','inferred') NOT NULL,
	`sourceReference` varchar(220),
	`status` enum('active','superseded','removed') NOT NULL DEFAULT 'active',
	`occurredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assistantMemories_id` PRIMARY KEY(`id`),
	CONSTRAINT `assistantMemories_org_provenance_ref_uq` UNIQUE(`organisationId`,`provenance`,`sourceReference`)
);
--> statement-breakpoint
CREATE TABLE `assistantReminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`userId` int NOT NULL,
	`contactExternalId` varchar(160),
	`opportunityExternalId` varchar(160),
	`title` varchar(300) NOT NULL,
	`details` text,
	`dueAt` timestamp NOT NULL,
	`timezone` varchar(80) NOT NULL,
	`status` enum('open','snoozed','completed','cancelled') NOT NULL DEFAULT 'open',
	`source` enum('manual','assistant','call_commitment','crm','inbound','automation','appointment') NOT NULL DEFAULT 'manual',
	`sourceReference` varchar(220),
	`snoozedUntil` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assistantReminders_id` PRIMARY KEY(`id`),
	CONSTRAINT `assistantReminders_org_source_ref_uq` UNIQUE(`organisationId`,`source`,`sourceReference`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `isPlatformOwner` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `assistantMemories` ADD CONSTRAINT `assistantMemories_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistantMemories` ADD CONSTRAINT `assistantMemories_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistantReminders` ADD CONSTRAINT `assistantReminders_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistantReminders` ADD CONSTRAINT `assistantReminders_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `assistantMemories_org_user_type_idx` ON `assistantMemories` (`organisationId`,`userId`,`memoryType`);--> statement-breakpoint
CREATE INDEX `assistantMemories_org_contact_idx` ON `assistantMemories` (`organisationId`,`contactExternalId`);--> statement-breakpoint
CREATE INDEX `assistantReminders_org_user_status_due_idx` ON `assistantReminders` (`organisationId`,`userId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `assistantReminders_org_contact_idx` ON `assistantReminders` (`organisationId`,`contactExternalId`);