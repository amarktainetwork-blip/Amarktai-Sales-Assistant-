CREATE TABLE `approvalTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`templateKey` varchar(140) NOT NULL,
	`version` int NOT NULL,
	`title` varchar(220) NOT NULL,
	`body` text NOT NULL,
	`status` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
	`createdByUserId` int,
	`publishedByUserId` int,
	`publishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `approvalTemplates_id` PRIMARY KEY(`id`),
	CONSTRAINT `approval_templates_org_key_version_unique` UNIQUE(`organisationId`,`templateKey`,`version`)
);
--> statement-breakpoint
CREATE TABLE `playbookExecutionHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`playbookVersionId` int NOT NULL,
	`approvalTemplateId` int,
	`workflowRunId` int,
	`actionProposalId` int,
	`status` enum('prepared','reviewed','approved','executed','failed','cancelled') NOT NULL DEFAULT 'prepared',
	`inputSnapshot` json NOT NULL,
	`outputSummary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `playbookExecutionHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `playbookVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`playbookKey` varchar(140) NOT NULL,
	`version` int NOT NULL,
	`title` varchar(220) NOT NULL,
	`instructions` text NOT NULL,
	`inputSchema` json NOT NULL,
	`status` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
	`createdByUserId` int,
	`publishedByUserId` int,
	`publishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `playbookVersions_id` PRIMARY KEY(`id`),
	CONSTRAINT `playbook_versions_org_key_version_unique` UNIQUE(`organisationId`,`playbookKey`,`version`)
);
--> statement-breakpoint
ALTER TABLE `approvalTemplates` ADD CONSTRAINT `approvalTemplates_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `approvalTemplates` ADD CONSTRAINT `approvalTemplates_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `approvalTemplates` ADD CONSTRAINT `approvalTemplates_publishedByUserId_users_id_fk` FOREIGN KEY (`publishedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `playbookExecutionHistory` ADD CONSTRAINT `playbookExecutionHistory_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `playbookExecutionHistory` ADD CONSTRAINT `playbook_exec_history_version_fk` FOREIGN KEY (`playbookVersionId`) REFERENCES `playbookVersions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `playbookExecutionHistory` ADD CONSTRAINT `playbook_exec_history_approval_template_fk` FOREIGN KEY (`approvalTemplateId`) REFERENCES `approvalTemplates`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `playbookExecutionHistory` ADD CONSTRAINT `playbookExecutionHistory_workflowRunId_workflowRuns_id_fk` FOREIGN KEY (`workflowRunId`) REFERENCES `workflowRuns`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `playbookExecutionHistory` ADD CONSTRAINT `playbookExecutionHistory_actionProposalId_actionProposals_id_fk` FOREIGN KEY (`actionProposalId`) REFERENCES `actionProposals`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `playbookVersions` ADD CONSTRAINT `playbookVersions_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `playbookVersions` ADD CONSTRAINT `playbookVersions_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `playbookVersions` ADD CONSTRAINT `playbookVersions_publishedByUserId_users_id_fk` FOREIGN KEY (`publishedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `approval_templates_org_key_status_idx` ON `approvalTemplates` (`organisationId`,`templateKey`,`status`);--> statement-breakpoint
CREATE INDEX `playbook_execution_org_created_idx` ON `playbookExecutionHistory` (`organisationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `playbook_execution_workflow_idx` ON `playbookExecutionHistory` (`workflowRunId`);--> statement-breakpoint
CREATE INDEX `playbook_versions_org_key_status_idx` ON `playbookVersions` (`organisationId`,`playbookKey`,`status`);