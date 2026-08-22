ALTER TABLE `automationPlaybooks` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `companyProfiles` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `crmConnections` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `integrationProfiles` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `websiteDiscoveries` ADD `organisationId` int;--> statement-breakpoint
ALTER TABLE `automationPlaybooks` ADD CONSTRAINT `automationPlaybooks_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `companyProfiles` ADD CONSTRAINT `companyProfiles_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmConnections` ADD CONSTRAINT `crmConnections_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationProfiles` ADD CONSTRAINT `integrationProfiles_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `websiteDiscoveries` ADD CONSTRAINT `websiteDiscoveries_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `automationPlaybooks_org_status_idx` ON `automationPlaybooks` (`organisationId`,`status`);--> statement-breakpoint
CREATE INDEX `companyProfiles_org_idx` ON `companyProfiles` (`organisationId`);--> statement-breakpoint
CREATE INDEX `crmConnections_org_provider_idx` ON `crmConnections` (`organisationId`,`provider`);--> statement-breakpoint
CREATE INDEX `integrationProfiles_org_provider_idx` ON `integrationProfiles` (`organisationId`,`provider`);--> statement-breakpoint
CREATE INDEX `websiteDiscoveries_org_created_idx` ON `websiteDiscoveries` (`organisationId`,`createdAt`);
