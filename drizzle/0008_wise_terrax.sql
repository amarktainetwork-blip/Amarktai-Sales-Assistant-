CREATE TABLE `dailyReportExecutions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`deliveryKey` varchar(32) NOT NULL,
	`status` enum('sent','failed') NOT NULL,
	`failureReason` varchar(240),
	`attemptedAt` timestamp NOT NULL DEFAULT (now()),
	`sentAt` timestamp,
	CONSTRAINT `dailyReportExecutions_id` PRIMARY KEY(`id`),
	CONSTRAINT `dailyReportExecutions_report_delivery_uq` UNIQUE(`reportId`,`deliveryKey`)
);
--> statement-breakpoint
ALTER TABLE `dailyReports` ADD `deliveryClaimKey` varchar(32);--> statement-breakpoint
ALTER TABLE `dailyReports` ADD `lastAttemptAt` timestamp;--> statement-breakpoint
ALTER TABLE `dailyReportExecutions` ADD CONSTRAINT `dailyReportExecutions_reportId_dailyReports_id_fk` FOREIGN KEY (`reportId`) REFERENCES `dailyReports`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `dailyReportExecutions_report_idx` ON `dailyReportExecutions` (`reportId`,`attemptedAt`);