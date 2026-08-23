CREATE TABLE `enterpriseIdentityConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`protocol` enum('saml','scim') NOT NULL,
	`displayName` varchar(180) NOT NULL,
	`status` enum('draft','testing','ready','paused','error') NOT NULL DEFAULT 'draft',
	`configuration` json NOT NULL,
	`verifiedAt` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `enterpriseIdentityConnections_id` PRIMARY KEY(`id`),
	CONSTRAINT `enterprise_identity_org_protocol_unique` UNIQUE(`organisationId`,`protocol`)
);
--> statement-breakpoint
CREATE TABLE `organisationEntitlements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`planKey` varchar(80) NOT NULL DEFAULT 'self_hosted',
	`status` enum('active','trial','suspended','cancelled') NOT NULL DEFAULT 'active',
	`featureFlags` json NOT NULL,
	`limits` json NOT NULL,
	`providerReference` varchar(180),
	`currentPeriodEndsAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organisationEntitlements_id` PRIMARY KEY(`id`),
	CONSTRAINT `organisation_entitlements_unique` UNIQUE(`organisationId`)
);
--> statement-breakpoint
ALTER TABLE `enterpriseIdentityConnections` ADD CONSTRAINT `enterpriseIdentityConnections_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organisationEntitlements` ADD CONSTRAINT `organisationEntitlements_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;