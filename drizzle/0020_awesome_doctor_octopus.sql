CREATE TABLE `outlookInboundQueue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organisationId` int NOT NULL,
	`messageId` varchar(512) NOT NULL,
	`subscriptionId` varchar(180),
	`status` enum('queued','processing','processed','dead_letter') NOT NULL DEFAULT 'queued',
	`attempts` int NOT NULL DEFAULT 0,
	`nextAttemptAt` timestamp NOT NULL DEFAULT (now()),
	`claimedAt` timestamp,
	`processedAt` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `outlookInboundQueue_id` PRIMARY KEY(`id`),
	CONSTRAINT `outlook_inbound_queue_org_message_unique` UNIQUE(`organisationId`,`messageId`)
);
--> statement-breakpoint
ALTER TABLE `callSessions` ADD `crmContext` json;--> statement-breakpoint
ALTER TABLE `callSessions` ADD `structuredOutcome` json;--> statement-breakpoint
ALTER TABLE `crmContacts` ADD `normalizedEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `crmContacts` ADD `normalizedPhone` varchar(80);--> statement-breakpoint
UPDATE `crmContacts`
SET `normalizedEmail` = NULLIF(LOWER(TRIM(`email`)), '')
WHERE `email` IS NOT NULL;--> statement-breakpoint
UPDATE `crmContacts`
SET `normalizedPhone` = NULLIF(
	CASE
		WHEN TRIM(`phone`) LIKE '00%' THEN CONCAT('+', REGEXP_REPLACE(SUBSTRING(TRIM(`phone`), 3), '[^0-9]', ''))
		WHEN TRIM(`phone`) LIKE '+%' THEN CONCAT('+', REGEXP_REPLACE(TRIM(`phone`), '[^0-9]', ''))
		ELSE REGEXP_REPLACE(TRIM(`phone`), '[^0-9]', '')
	END,
	''
)
WHERE `phone` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `outlookInboundQueue` ADD CONSTRAINT `outlookInboundQueue_organisationId_organisations_id_fk` FOREIGN KEY (`organisationId`) REFERENCES `organisations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `outlook_inbound_queue_status_due_idx` ON `outlookInboundQueue` (`status`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `crm_contacts_org_normalized_email_idx` ON `crmContacts` (`organisationId`,`normalizedEmail`);--> statement-breakpoint
CREATE INDEX `crm_contacts_org_normalized_phone_idx` ON `crmContacts` (`organisationId`,`normalizedPhone`);
