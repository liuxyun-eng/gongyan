CREATE TABLE `codex_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codex_connections_token_hash_unique` ON `codex_connections` (`token_hash`);--> statement-breakpoint
CREATE TABLE `codex_cursors` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`position` integer NOT NULL,
	`last_key` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`, `thread_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`post_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_request` ON `deliveries` (`project_id`,`user_id`,`request_id`);--> statement-breakpoint
ALTER TABLE `files` ADD `post_id` text REFERENCES posts(id);