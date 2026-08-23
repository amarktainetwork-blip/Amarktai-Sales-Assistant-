CREATE TABLE `browserLearnedOperations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`operationKey` varchar(120) NOT NULL,
	`version` int NOT NULL,
	`status` enum('NOT_LEARNED','LEARNED','TEST_READY','LIVE_PROVEN','DEGRADED','BLOCKED') NOT NULL DEFAULT 'LEARNED',
	`definition` json NOT NULL,
	`prerequisites` json NOT NULL,
	`targetAssertions` json NOT NULL,
	`postconditionAssertions` json NOT NULL,
	`checksum` varchar(64) NOT NULL,
	`lastTestAt` timestamp,
	`lastSuccessAt` timestamp,
	`lastFailureAt` timestamp,
	`lastError` text,
	`evidence` json NOT NULL,
	`createdByUserId` int,
	`publishedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `browserLearnedOperations_id` PRIMARY KEY(`id`),
	CONSTRAINT `browser_learned_operation_system_key_version_unique` UNIQUE(`connectedSystemId`,`operationKey`,`version`)
);
--> statement-breakpoint
CREATE TABLE `browserTrainingSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`userId` int NOT NULL,
	`operationKey` varchar(120) NOT NULL,
	`status` enum('capturing','submitted','cancelled','expired') NOT NULL DEFAULT 'capturing',
	`capture` json NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `browserTrainingSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contactCommunicationSuppressions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int,
	`channel` enum('email','sms','chat','other') NOT NULL,
	`senderReference` varchar(320) NOT NULL,
	`contactExternalId` varchar(180),
	`reason` varchar(220) NOT NULL,
	`sourceMessageId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contactCommunicationSuppressions_id` PRIMARY KEY(`id`),
	CONSTRAINT `contact_communication_suppression_org_channel_sender_unique` UNIQUE(`organisationId`,`channel`,`senderReference`)
);
--> statement-breakpoint
ALTER TABLE `inboundMessages` ADD `idempotencyKey` varchar(64);--> statement-breakpoint
ALTER TABLE `inboundMessages` ADD `contactExternalId` varchar(180);--> statement-breakpoint
ALTER TABLE `inboundMessages` ADD `needsAction` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `inboundMessages` ADD CONSTRAINT `inbound_messages_idempotency_unique` UNIQUE(`idempotencyKey`);--> statement-breakpoint
ALTER TABLE `browserLearnedOperations` ADD CONSTRAINT `browserLearnedOperations_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `browserLearnedOperations` ADD CONSTRAINT `browser_learned_ops_connected_system_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `browserLearnedOperations` ADD CONSTRAINT `browserLearnedOperations_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `browserLearnedOperations` ADD CONSTRAINT `browserLearnedOperations_publishedByUserId_users_id_fk` FOREIGN KEY (`publishedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `browserTrainingSessions` ADD CONSTRAINT `browserTrainingSessions_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `browserTrainingSessions` ADD CONSTRAINT `browserTrainingSessions_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `browserTrainingSessions` ADD CONSTRAINT `browserTrainingSessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contactCommunicationSuppressions` ADD CONSTRAINT `contact_comm_suppressions_organisation_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contactCommunicationSuppressions` ADD CONSTRAINT `contact_comm_suppressions_connected_system_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contactCommunicationSuppressions` ADD CONSTRAINT `contact_comm_suppressions_source_message_fk` FOREIGN KEY (`sourceMessageId`) REFERENCES `inboundMessages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `browser_learned_operation_org_system_status_idx` ON `browserLearnedOperations` (`organisationId`,`connectedSystemId`,`status`);--> statement-breakpoint
CREATE INDEX `browser_training_session_scope_idx` ON `browserTrainingSessions` (`organisationId`,`connectedSystemId`,`userId`,`status`);--> statement-breakpoint
CREATE INDEX `contact_communication_suppression_contact_idx` ON `contactCommunicationSuppressions` (`organisationId`,`contactExternalId`);--> statement-breakpoint
CREATE INDEX `inbound_messages_org_action_received_idx` ON `inboundMessages` (`organisationId`,`needsAction`,`receivedAt`);