import { z } from "zod";

/**
 * Zod schema for the `/internal/v1/users/next` response.
 *
 * **Duplicated in `apps/www/src/lib/internal-users-next.server.ts`.** Keep
 * both copies in sync — they form the contract between the web app and the
 * resend-sync worker. At this scale, the duplication is honest; a shared
 * `packages/contracts` workspace adds more friction than the one consumer
 * justifies. If a second worker ever consumes this schema, extract it then.
 */
export const internalUsersNextResponseSchema = z.object({
	user: z
		.object({
			id: z.string(),
			email: z.string(),
			name: z.string(),
		})
		.nullable(),
	nextCursor: z.string(),
});

export type InternalUsersNextResponse = z.infer<
	typeof internalUsersNextResponseSchema
>;
