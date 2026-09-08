ALTER TABLE `salesWorkItems` ADD `startedAt` timestamp;--> statement-breakpoint
ALTER TABLE `salesWorkItems` ADD `completedAt` timestamp;--> statement-breakpoint
ALTER TABLE `salesWorkItems` ADD `snoozedUntil` timestamp;--> statement-breakpoint
ALTER TABLE `salesWorkItems` ADD `blockedReason` text;--> statement-breakpoint
ALTER TABLE `salesWorkItems` ADD `stateVersion` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `salesWorkItems` ADD `lastTransitionKey` varchar(120);