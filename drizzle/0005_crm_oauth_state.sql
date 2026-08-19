CREATE TABLE `crmOAuthStates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`connectedSystemId` int NOT NULL,
	`userId` int NOT NULL,
	`nonce` varchar(160) NOT NULL,
	`redirectUri` varchar(1024) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crmOAuthStates_id` PRIMARY KEY(`id`),
	CONSTRAINT `crmOAuthStates_nonce_unique` UNIQUE(`nonce`)
);
--> statement-breakpoint
ALTER TABLE `crmOAuthStates` ADD CONSTRAINT `crmOAuthStates_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmOAuthStates` ADD CONSTRAINT `crmOAuthStates_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `crm_oauth_states_system_expiry_idx` ON `crmOAuthStates` (`connectedSystemId`,`expiresAt`);