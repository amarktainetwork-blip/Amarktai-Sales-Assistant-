CREATE TABLE `dataSubjectRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`requestedByUserId` int NOT NULL,
	`requestType` enum('export','deletion') NOT NULL,
	`subjectType` enum('contact','company','user','operational_record') NOT NULL,
	`subjectReference` varchar(220) NOT NULL,
	`reason` text,
	`status` enum('review_required','approved','rejected','completed','failed') NOT NULL DEFAULT 'review_required',
	`reviewedByUserId` int,
	`reviewedAt` timestamp,
	`executionSummary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dataSubjectRequests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `operationalEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int,
	`connectedSystemId` int,
	`severity` enum('info','warning','error','critical') NOT NULL DEFAULT 'info',
	`category` varchar(100) NOT NULL,
	`eventKey` varchar(180) NOT NULL,
	`summary` text NOT NULL,
	`detail` json NOT NULL,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operationalEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `organisationCompliancePolicies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`transcriptRetentionDays` int NOT NULL DEFAULT 90,
	`auditRetentionDays` int NOT NULL DEFAULT 365,
	`operationalRetentionDays` int NOT NULL DEFAULT 365,
	`outboundConsentRequired` boolean NOT NULL DEFAULT true,
	`deletionApprovalRequired` boolean NOT NULL DEFAULT true,
	`policyText` text,
	`createdByUserId` int,
	`updatedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organisationCompliancePolicies_id` PRIMARY KEY(`id`),
	CONSTRAINT `organisation_compliance_policy_unique` UNIQUE(`organisationId`)
);
--> statement-breakpoint
ALTER TABLE `dataSubjectRequests` ADD CONSTRAINT `dataSubjectRequests_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataSubjectRequests` ADD CONSTRAINT `dataSubjectRequests_requestedByUserId_users_id_fk` FOREIGN KEY (`requestedByUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataSubjectRequests` ADD CONSTRAINT `dataSubjectRequests_reviewedByUserId_users_id_fk` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operationalEvents` ADD CONSTRAINT `operationalEvents_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operationalEvents` ADD CONSTRAINT `operationalEvents_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organisationCompliancePolicies` ADD CONSTRAINT `org_compliance_policies_organisation_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organisationCompliancePolicies` ADD CONSTRAINT `organisationCompliancePolicies_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organisationCompliancePolicies` ADD CONSTRAINT `organisationCompliancePolicies_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `data_subject_requests_org_status_idx` ON `dataSubjectRequests` (`organisationId`,`status`);--> statement-breakpoint
CREATE INDEX `operational_events_org_severity_created_idx` ON `operationalEvents` (`organisationId`,`severity`,`createdAt`);--> statement-breakpoint
CREATE INDEX `operational_events_connector_created_idx` ON `operationalEvents` (`connectedSystemId`,`createdAt`);