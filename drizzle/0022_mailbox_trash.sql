ALTER TABLE `email` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `email_deleted_at_idx` ON `email` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `user` ADD `expired_to_trash` integer;