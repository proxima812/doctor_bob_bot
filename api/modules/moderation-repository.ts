import type { SupabaseClient } from "@supabase/supabase-js"

import type { DailyStatEvent, ViolationRecord } from "./types"

export type ModerationRepository = ReturnType<typeof createModerationRepository>

type ModerationRepoConfig = {
	violationsTable: string
	statsTable: string
	violationTtlHours: number
}

export function createModerationRepository(client: SupabaseClient, config: ModerationRepoConfig) {
	async function getViolation(chatId: number, userId: number): Promise<ViolationRecord | null> {
		const { data, error } = await client
			.from(config.violationsTable)
			.select("chat_id, user_id, violation_count, warning_issued, updated_at")
			.eq("chat_id", chatId)
			.eq("user_id", userId)
			.maybeSingle()

		if (error) {
			console.error("supabase_get_violation_error", error.message)
			return null
		}
		if (!data) {
			return null
		}

		return {
			chatId: Number(data.chat_id),
			userId: Number(data.user_id),
			count: Number(data.violation_count ?? 0),
			warningIssued: Boolean(data.warning_issued),
			updatedAt: String(data.updated_at),
		}
	}

	async function upsertViolation(input: {
		chatId: number
		userId: number
		count: number
		warningIssued: boolean
	}): Promise<void> {
		const payload = {
			chat_id: input.chatId,
			user_id: input.userId,
			violation_count: input.count,
			warning_issued: input.warningIssued,
			updated_at: new Date().toISOString(),
		}

		const { error } = await client.from(config.violationsTable).upsert(payload, {
			onConflict: "chat_id,user_id",
			ignoreDuplicates: false,
		})
		if (error) {
			console.error("supabase_upsert_violation_error", error.message)
		}
	}

	async function resetViolation(chatId: number, userId: number): Promise<void> {
		const { error } = await client.from(config.violationsTable).delete().eq("chat_id", chatId).eq("user_id", userId)
		if (error) {
			console.error("supabase_reset_violation_error", error.message)
		}
	}

	async function cleanupExpiredViolations(): Promise<void> {
		const cutoff = new Date(Date.now() - config.violationTtlHours * 60 * 60 * 1000).toISOString()
		const { error } = await client.from(config.violationsTable).delete().lt("updated_at", cutoff)
		if (error) {
			console.error("supabase_cleanup_violations_error", error.message)
		}
	}

	async function incrementDailyStat(chatId: number, event: DailyStatEvent): Promise<void> {
		const day = new Date().toISOString().slice(0, 10)
		const { data, error } = await client
			.from(config.statsTable)
			.select("messages_deleted, warnings_sent, users_banned, messages_bypassed, rate_limited")
			.eq("chat_id", chatId)
			.eq("day", day)
			.maybeSingle()

		if (error) {
			console.error("supabase_load_daily_stat_error", error.message)
			return
		}

		const current = {
			messages_deleted: Number(data?.messages_deleted ?? 0),
			warnings_sent: Number(data?.warnings_sent ?? 0),
			users_banned: Number(data?.users_banned ?? 0),
			messages_bypassed: Number(data?.messages_bypassed ?? 0),
			rate_limited: Number(data?.rate_limited ?? 0),
		}

		if (event === "messages_deleted") current.messages_deleted += 1
		if (event === "warnings_sent") current.warnings_sent += 1
		if (event === "users_banned") current.users_banned += 1
		if (event === "messages_bypassed") current.messages_bypassed += 1
		if (event === "rate_limited") current.rate_limited += 1

		const { error: upsertError } = await client.from(config.statsTable).upsert(
			{
				chat_id: chatId,
				day,
				...current,
				updated_at: new Date().toISOString(),
			},
			{
				onConflict: "chat_id,day",
				ignoreDuplicates: false,
			},
		)

		if (upsertError) {
			console.error("supabase_upsert_daily_stat_error", upsertError.message)
		}
	}

	return {
		getViolation,
		upsertViolation,
		resetViolation,
		cleanupExpiredViolations,
		incrementDailyStat,
	}
}
