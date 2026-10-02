CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`verifier` text NOT NULL,
	`label` text NOT NULL,
	`permission` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `token_owner_idx` ON `api_tokens` (`owner_id`);--> statement-breakpoint
CREATE TABLE `microsoft_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`subject` text NOT NULL,
	`label` text NOT NULL,
	`scopes` text NOT NULL,
	`encrypted_cache` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`cache_version` integer DEFAULT 0 NOT NULL,
	`lease_id` text,
	`lease_until` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `microsoft_connections_id_unique` ON `microsoft_connections` (`id`);--> statement-breakpoint
CREATE TABLE `oauth_transactions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`generation` integer NOT NULL,
	`purpose` text NOT NULL,
	`encrypted_verifier` text NOT NULL,
	`nonce` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_expiry_idx` ON `oauth_transactions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `pending_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`generation` integer NOT NULL,
	`encrypted_candidate` text NOT NULL,
	`label` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`mutation_id` text
);
