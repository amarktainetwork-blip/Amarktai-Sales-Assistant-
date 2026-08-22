CREATE TABLE `crmPipelineStageMappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`externalPipelineId` varchar(180) NOT NULL,
	`externalStageId` varchar(180) NOT NULL,
	`pipelineLabel` varchar(220) NOT NULL,
	`stageLabel` varchar(220) NOT NULL,
	`category` enum('open','qualified','proposal','won','lost','other') NOT NULL DEFAULT 'other',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crmPipelineStageMappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_pipeline_stage_mapping_system_stage_unique` UNIQUE(`connectedSystemId`,`externalStageId`)
);
--> statement-breakpoint
ALTER TABLE `crmPipelineStageMappings` ADD CONSTRAINT `crmPipelineStageMappings_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crmPipelineStageMappings` ADD CONSTRAINT `crmPipelineStageMappings_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `crm_pipeline_stage_mapping_org_category_idx` ON `crmPipelineStageMappings` (`organisationId`,`category`,`isActive`);