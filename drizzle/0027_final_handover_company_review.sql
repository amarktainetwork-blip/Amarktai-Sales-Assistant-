ALTER TABLE `websiteDiscoveries` ADD `discoveryVersion` int NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `websiteDiscoveries` ADD `reviewAgentKey` varchar(120);--> statement-breakpoint
ALTER TABLE `websiteDiscoveries` ADD `reviewState` enum('pending','completed','unavailable') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `websiteDiscoveries` MODIFY COLUMN `status` enum('review_required','confirmed','rejected','failed','superseded') NOT NULL DEFAULT 'review_required';--> statement-breakpoint
ALTER TABLE `websiteDiscoveries` ADD `supersededAt` timestamp NULL;--> statement-breakpoint
CREATE INDEX `websiteDiscoveries_profile_version_idx` ON `websiteDiscoveries` (`companyProfileId`,`discoveryVersion`);--> statement-breakpoint
ALTER TABLE `knowledgeSources` ADD `visibility` enum('private','organisation') NOT NULL DEFAULT 'private';--> statement-breakpoint
CREATE INDEX `knowledgeSources_organisation_visibility_idx` ON `knowledgeSources` (`organisationId`,`visibility`,`status`);
