import type { SupabaseClient } from "@supabase/supabase-js"

import type { DbMessageRecord, PendingMessage } from "./types"

export type MessageRepository = ReturnType<typeof createMessageRepository>

export function createMessageRepository(client: SupabaseClient, table: string) {
	async function saveMessageRecord(record: DbMessageRecord): Promise<void> {
		const payload = {
			chat_id: record.chatId,
			user_id: record.userId,
			message_id: record.messageId,
			raw_text: record.rawText,
			formatted_text: record.formattedText,
			status: record.status,
			created_at: record.createdAt,
			approved_at: record.approvedAt,
			admin_user_id: record.adminUserId,
			review_message_id: record.reviewMessageId,
		}
		const { error } = await client.from(table).upsert(payload, {
			onConflict: "chat_id,message_id",
			ignoreDuplicates: false,
		})
		if (error) {
			console.error("supabase_insert_error", error.message)
		}
	}

	async function updateReviewMessageId(chatId: number, messageId: number, reviewMessageId: number): Promise<void> {
		const { error } = await client
			.from(table)
			.update({ review_message_id: reviewMessageId })
			.eq("chat_id", chatId)
			.eq("message_id", messageId)
		if (error) {
			console.error("supabase_review_update_error", error.message)
		}
	}

	async function loadPendingMessage(chatId: number, messageId: number): Promise<PendingMessage | null> {
		const { data, error } = await client
			.from(table)
			.select("chat_id, user_id, message_id, raw_text")
			.eq("chat_id", chatId)
			.eq("message_id", messageId)
			.eq("status", "pending")
			.maybeSingle()

		if (error) {
			console.error("supabase_load_pending_error", error.message)
			return null
		}
		if (!data) {
			return null
		}

		return {
			chatId: Number(data.chat_id),
			userId: Number(data.user_id),
			messageId: Number(data.message_id),
			rawText: String(data.raw_text ?? ""),
		}
	}

	async function updateApproval(input: {
		chatId: number
		messageId: number
		formattedText: string
		adminUserId: number
		approvedAt: string
	}): Promise<void> {
		const { error } = await client
			.from(table)
			.update({
				formatted_text: input.formattedText,
				status: "approved",
				admin_user_id: input.adminUserId,
				approved_at: input.approvedAt,
			})
			.eq("chat_id", input.chatId)
			.eq("message_id", input.messageId)
		if (error) {
			console.error("supabase_approve_update_error", error.message)
		}
	}

	async function deleteMessageRecord(chatId: number, messageId: number): Promise<void> {
		const { error } = await client.from(table).delete().eq("chat_id", chatId).eq("message_id", messageId)
		if (error) {
			console.error("supabase_delete_message_error", error.message)
		}
	}

	return {
		saveMessageRecord,
		updateReviewMessageId,
		loadPendingMessage,
		updateApproval,
		deleteMessageRecord,
	}
}
