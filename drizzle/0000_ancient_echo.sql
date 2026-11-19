CREATE TABLE `analysis_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feedback_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`raw_response` text,
	`result_json` text,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_attempts_feedback_attempt_unique` ON `analysis_attempts` (`feedback_id`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`status` text NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "feedback_status_check" CHECK("feedback"."status" IN ('RECEIVED', 'ANALYZING', 'DONE', 'FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_content_hash_unique` ON `feedback` (`content_hash`);--> statement-breakpoint
CREATE INDEX `feedback_status_idx` ON `feedback` (`status`);