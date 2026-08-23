ALTER TABLE `auditEntries` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `callSessions` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `callbackTasks` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `dailyReports` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `knowledgeSources` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `auditEntries` ADD CONSTRAINT `auditEntries_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `callSessions` ADD CONSTRAINT `callSessions_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `callbackTasks` ADD CONSTRAINT `callbackTasks_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyReports` ADD CONSTRAINT `dailyReports_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `knowledgeSources` ADD CONSTRAINT `knowledgeSources_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `auditEntries_organisation_created_idx` ON `auditEntries` (`organisationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `callSessions_organisation_created_idx` ON `callSessions` (`organisationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `callbackTasks_organisation_state_due_idx` ON `callbackTasks` (`organisationId`,`state`,`dueAt`);--> statement-breakpoint
CREATE INDEX `dailyReports_organisation_enabled_idx` ON `dailyReports` (`organisationId`,`isEnabled`);--> statement-breakpoint
CREATE INDEX `knowledgeSources_organisation_status_idx` ON `knowledgeSources` (`organisationId`,`status`);