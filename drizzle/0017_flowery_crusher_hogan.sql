CREATE TABLE `connectorSyncJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`resourceType` varchar(80) NOT NULL,
	`scheduleExpression` varchar(120) NOT NULL,
	`status` enum('draft','ready','paused','running','error') NOT NULL DEFAULT 'draft',
	`capabilityKey` varchar(120) NOT NULL,
	`lastStartedAt` timestamp,
	`lastSucceededAt` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `connectorSyncJobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `connector_sync_jobs_system_resource_unique` UNIQUE(`connectedSystemId`,`resourceType`)
);
--> statement-breakpoint
CREATE TABLE `connectorWebhookReceipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`connectedSystemId` int NOT NULL,
	`eventId` varchar(220) NOT NULL,
	`eventType` varchar(160) NOT NULL,
	`signatureStatus` enum('verified','missing','invalid','not_configured') NOT NULL,
	`processingStatus` enum('received','processed','retrying','dead_letter','ignored') NOT NULL DEFAULT 'received',
	`attempts` int NOT NULL DEFAULT 0,
	`payloadHash` varchar(128) NOT NULL,
	`lastError` text,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	CONSTRAINT `connectorWebhookReceipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `connector_webhook_system_event_unique` UNIQUE(`connectedSystemId`,`eventId`)
);
--> statement-breakpoint
CREATE TABLE `operationalAlertDeliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`operationalEventId` int NOT NULL,
	`alertRuleId` int NOT NULL,
	`status` enum('pending','delivered','failed','suppressed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`deliveredAt` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operationalAlertDeliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `operational_alert_delivery_event_rule_unique` UNIQUE(`operationalEventId`,`alertRuleId`)
);
--> statement-breakpoint
CREATE TABLE `operationalAlertRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`severityThreshold` enum('warning','error','critical') NOT NULL DEFAULT 'error',
	`category` varchar(100),
	`deliveryChannel` enum('email','webhook') NOT NULL,
	`destination` varchar(1000) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `operationalAlertRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `operationalWorkerRuns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workerKey` varchar(140) NOT NULL,
	`organisationId` int,
	`status` enum('started','succeeded','failed') NOT NULL,
	`summary` text NOT NULL,
	`detail` json NOT NULL,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`finishedAt` timestamp,
	CONSTRAINT `operationalWorkerRuns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `connectorSyncJobs` ADD CONSTRAINT `connectorSyncJobs_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connectorSyncJobs` ADD CONSTRAINT `connectorSyncJobs_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connectorWebhookReceipts` ADD CONSTRAINT `connectorWebhookReceipts_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connectorWebhookReceipts` ADD CONSTRAINT `connectorWebhookReceipts_connectedSystemId_connectedSystems_id_fk` FOREIGN KEY (`connectedSystemId`) REFERENCES `connectedSystems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operationalAlertDeliveries` ADD CONSTRAINT `operationalAlertDeliveries_operationalEventId_operationalEvents_id_fk` FOREIGN KEY (`operationalEventId`) REFERENCES `operationalEvents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operationalAlertDeliveries` ADD CONSTRAINT `operationalAlertDeliveries_alertRuleId_operationalAlertRules_id_fk` FOREIGN KEY (`alertRuleId`) REFERENCES `operationalAlertRules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operationalAlertRules` ADD CONSTRAINT `operationalAlertRules_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operationalAlertRules` ADD CONSTRAINT `operationalAlertRules_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operationalWorkerRuns` ADD CONSTRAINT `operationalWorkerRuns_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `connector_sync_jobs_org_status_idx` ON `connectorSyncJobs` (`organisationId`,`status`);--> statement-breakpoint
CREATE INDEX `connector_webhook_org_status_received_idx` ON `connectorWebhookReceipts` (`organisationId`,`processingStatus`,`receivedAt`);--> statement-breakpoint
CREATE INDEX `operational_alert_delivery_status_idx` ON `operationalAlertDeliveries` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `operational_alert_rules_org_active_idx` ON `operationalAlertRules` (`organisationId`,`isActive`);--> statement-breakpoint
CREATE INDEX `operational_worker_runs_key_started_idx` ON `operationalWorkerRuns` (`workerKey`,`startedAt`);