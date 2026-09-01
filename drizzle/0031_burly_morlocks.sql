CREATE TABLE `userMailboxConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('microsoft') NOT NULL,
	`email` varchar(320) NOT NULL,
	`displayName` varchar(220),
	`tenantId` varchar(180),
	`status` enum('ready','reauthorise','disconnected','error') NOT NULL DEFAULT 'ready',
	`scopes` json NOT NULL,
	`keyVersion` varchar(64) NOT NULL,
	`iv` varchar(128) NOT NULL,
	`authTag` varchar(128) NOT NULL,
	`ciphertext` longtext NOT NULL,
	`expiresAt` timestamp,
	`lastSyncedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userMailboxConnections_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_mailbox_org_user_provider_unique` UNIQUE(`organisationId`,`userId`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `userMailboxOAuthStates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`userId` int NOT NULL,
	`nonce` varchar(128) NOT NULL,
	`redirectUri` varchar(1024) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `userMailboxOAuthStates_id` PRIMARY KEY(`id`),
	CONSTRAINT `userMailboxOAuthStates_nonce_unique` UNIQUE(`nonce`)
);
--> statement-breakpoint
ALTER TABLE `inboundMessages` ADD `mailboxUserId` int;--> statement-breakpoint
ALTER TABLE `userMailboxConnections` ADD CONSTRAINT `userMailboxConnections_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userMailboxConnections` ADD CONSTRAINT `userMailboxConnections_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userMailboxOAuthStates` ADD CONSTRAINT `userMailboxOAuthStates_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userMailboxOAuthStates` ADD CONSTRAINT `userMailboxOAuthStates_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `user_mailbox_org_status_idx` ON `userMailboxConnections` (`organisationId`,`status`);--> statement-breakpoint
CREATE INDEX `user_mailbox_oauth_user_expiry_idx` ON `userMailboxOAuthStates` (`userId`,`expiresAt`);--> statement-breakpoint
ALTER TABLE `inboundMessages` ADD CONSTRAINT `inboundMessages_mailboxUserId_users_id_fk` FOREIGN KEY (`mailboxUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `inbound_messages_mailbox_user_action_idx` ON `inboundMessages` (`organisationId`,`mailboxUserId`,`needsAction`);