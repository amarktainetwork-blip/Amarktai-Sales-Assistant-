ALTER TABLE `actionProposals` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `workflowRuns` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `actionProposals` ADD CONSTRAINT `actionProposals_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflowRuns` ADD CONSTRAINT `workflowRuns_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `actionProposals_organisation_state_idx` ON `actionProposals` (`organisationId`,`state`);--> statement-breakpoint
CREATE INDEX `workflowRuns_organisation_created_idx` ON `workflowRuns` (`organisationId`,`createdAt`);