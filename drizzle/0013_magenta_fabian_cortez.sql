CREATE TABLE `workspaceSavedItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`organisationId` int NOT NULL,
	`targetType` enum('action_proposal','lead','pitch') NOT NULL,
	`targetKey` varchar(160) NOT NULL,
	`title` varchar(220) NOT NULL,
	`tags` json NOT NULL,
	`isFavorite` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspaceSavedItems_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspaceSavedItems_user_organisation_target_unique` UNIQUE(`userId`,`organisationId`,`targetType`,`targetKey`)
);
--> statement-breakpoint
ALTER TABLE `workspaceSavedItems` ADD CONSTRAINT `workspaceSavedItems_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspaceSavedItems` ADD CONSTRAINT `workspaceSavedItems_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `workspaceSavedItems_organisation_updated_idx` ON `workspaceSavedItems` (`organisationId`,`updatedAt`);