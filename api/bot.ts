import { webhookCallback } from "grammy"
import { config } from "dotenv"
import { existsSync } from "fs"
import { resolve } from "path"
import { Bot, InlineKeyboard } from "grammy"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const envPaths = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]
for (const envPath of envPaths) {
	if (existsSync(envPath)) {
		config({ path: envPath })
		break
	}
}

type PendingMessage = {
	chatId: number
	userId: number
	messageId: number
	rawText: string
}

type DbMessageRecord = {
	chatId: number
	userId: number
	messageId: number
	rawText: string
	formattedText: string | null
	status: "pending" | "approved"
	createdAt: string
	approvedAt: string | null
	adminUserId: number | null
	reviewMessageId: number | null
}

const BOT_TOKEN = process.env.TOKEN
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID ?? "5522146122")
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.URL
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? process.env.API
const SUPABASE_TABLE = process.env.SUPABASE_TABLE ?? "messages"

if (!BOT_TOKEN) {
	throw new Error("TOKEN не найден. Добавьте TOKEN в .env и перезапустите бота.")
}

if (!Number.isInteger(ADMIN_USER_ID) || ADMIN_USER_ID <= 0) {
	throw new Error("ADMIN_USER_ID не найден или некорректен. Добавьте его в .env.")
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
	throw new Error("SUPABASE_URL/SUPABASE_KEY (или URL/API) не найдены в .env.")
}

const bot = new Bot(BOT_TOKEN)
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const pendingMessages = new Map<string, PendingMessage>()

const SERVICE_MESSAGE_KEYS = [
	"new_chat_members",
	"left_chat_member",
	"new_chat_title",
	"new_chat_photo",
	"delete_chat_photo",
	"group_chat_created",
	"supergroup_chat_created",
	"channel_chat_created",
	"message_auto_delete_timer_changed",
	"migrate_to_chat_id",
	"migrate_from_chat_id",
	"pinned_message",
	"video_chat_started",
	"video_chat_ended",
	"video_chat_participants_invited",
	"forum_topic_created",
	"forum_topic_edited",
	"forum_topic_closed",
	"forum_topic_reopened",
	"general_forum_topic_hidden",
	"general_forum_topic_unhidden",
] as const

bot.on("message", async ctx => {
	if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
		return
	}

	const message = ctx.message
	if (isServiceMessage(message)) {
		return
	}

	const userId = ctx.from?.id
	if (userId === undefined || userId === ADMIN_USER_ID) {
		return
	}

	const chatId = ctx.chat.id
	const messageId = message.message_id
	const rawText = `${message.text ?? ""}${message.caption ? `\n${message.caption}` : ""}`.trim()
	const safeRawText = rawText || "[пустое сообщение]"

	const pending: PendingMessage = { chatId, userId, messageId, rawText: safeRawText }
	const key = makePendingKey(chatId, messageId)
	pendingMessages.set(key, pending)

	await saveMessageRecord(supabase, {
		chatId,
		userId,
		messageId,
		rawText: safeRawText,
		formattedText: null,
		status: "pending",
		createdAt: new Date().toISOString(),
		approvedAt: null,
		adminUserId: null,
		reviewMessageId: null,
	})

	const keyboard = new InlineKeyboard()
		.text("OK", `approve:${chatId}:${messageId}`)
		.text("Отклонить", `reject:${chatId}:${messageId}`)
	const preview = [
		"Новый текст на согласование",
		`chat_id: ${chatId}`,
		`user_id: ${userId}`,
		`message_id: ${messageId}`,
		"",
		safeRawText,
	].join("\n")

	try {
		const sent = await ctx.api.sendMessage(ADMIN_USER_ID, preview, {
			reply_markup: keyboard,
			disable_web_page_preview: true,
		})
		await updateReviewMessageId(supabase, chatId, messageId, sent.message_id)
	} catch (error) {
		console.error("admin_notify_error", error)
	}

	logEvent("message_pending_approval", { chatId, userId, messageId })
})

bot.on("callback_query:data", async ctx => {
	const userId = ctx.from?.id
	const data = ctx.callbackQuery.data ?? ""
	if (!data.startsWith("approve:") && !data.startsWith("reject:")) {
		return
	}

	if (userId !== ADMIN_USER_ID) {
		await ctx.answerCallbackQuery({ text: "Только админ может подтверждать.", show_alert: true })
		return
	}

	const parsed = parseActionData(data)
	if (!parsed) {
		await ctx.answerCallbackQuery({ text: "Некорректные данные.", show_alert: true })
		return
	}

	const { action, chatId, messageId } = parsed
	const key = makePendingKey(chatId, messageId)
	const pending = pendingMessages.get(key) ?? (await loadPendingMessage(supabase, chatId, messageId))
	if (!pending) {
		await ctx.answerCallbackQuery({ text: "Запись не найдена в pending.", show_alert: true })
		return
	}
	const reviewMessageId = ctx.callbackQuery.message?.message_id

	if (action === "reject") {
		pendingMessages.delete(key)
		try {
			if (reviewMessageId !== undefined) {
				await ctx.api.deleteMessage(ADMIN_USER_ID, reviewMessageId)
			}
		} catch (error) {
			console.error("delete_review_message_error", error)
		}

		try {
			await ctx.api.sendMessage(
				ADMIN_USER_ID,
				[`Отклонено`, `chat_id: ${chatId}`, `source_message_id: ${messageId}`, "source_unchanged: yes"].join(
					"\n",
				),
			)
		} catch (error) {
			console.error("admin_reject_notify_error", error)
		}

		await ctx.answerCallbackQuery({ text: "Отклонено." })
		logEvent("message_rejected_by_admin", { chatId, sourceMessageId: messageId })
		return
	}

	let sourceDeleted = false
	let sentMessageId: number | null = null

	try {
		const sent = await ctx.api.sendMessage(chatId, pending.rawText, { disable_web_page_preview: true })
		sentMessageId = sent.message_id
	} catch (error) {
		console.error("send_approved_text_error", error)
		await ctx.answerCallbackQuery({ text: "Не удалось отправить сообщение.", show_alert: true })
		return
	}

	try {
		await ctx.api.deleteMessage(chatId, messageId)
		sourceDeleted = true
	} catch (error) {
		console.error("delete_source_error", error)
	}

	pendingMessages.delete(key)
	await updateApproval(supabase, {
		chatId,
		messageId,
		formattedText: pending.rawText,
		adminUserId: ADMIN_USER_ID,
		approvedAt: new Date().toISOString(),
	})

	try {
		if (reviewMessageId !== undefined) {
			await ctx.api.deleteMessage(ADMIN_USER_ID, reviewMessageId)
		}
	} catch (error) {
		console.error("delete_review_message_error", error)
	}

	await ctx.answerCallbackQuery({ text: "Готово." })
	logEvent("message_approved", { chatId, sourceMessageId: messageId, sentMessageId })
})

function isServiceMessage(message: Record<string, unknown>): boolean {
	for (const key of SERVICE_MESSAGE_KEYS) {
		if (key in message) {
			return true
		}
	}
	return false
}

function makePendingKey(chatId: number, messageId: number): string {
	return `${chatId}:${messageId}`
}

function parseActionData(
	data: string,
): { action: "approve" | "reject"; chatId: number; messageId: number } | null {
	const parts = data.split(":")
	if (parts.length !== 3) {
		return null
	}

	const action = parts[0]
	if (action !== "approve" && action !== "reject") {
		return null
	}

	const chatId = Number(parts[1])
	const messageId = Number(parts[2])
	if (!Number.isInteger(chatId) || !Number.isInteger(messageId)) {
		return null
	}

	return { action, chatId, messageId }
}

async function saveMessageRecord(client: SupabaseClient, record: DbMessageRecord): Promise<void> {
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
	const { error } = await client.from(SUPABASE_TABLE).upsert(payload, {
		onConflict: "chat_id,message_id",
		ignoreDuplicates: false,
	})
	if (error) {
		console.error("supabase_insert_error", error.message)
	}
}

async function updateReviewMessageId(
	client: SupabaseClient,
	chatId: number,
	messageId: number,
	reviewMessageId: number,
): Promise<void> {
	const { error } = await client
		.from(SUPABASE_TABLE)
		.update({ review_message_id: reviewMessageId })
		.eq("chat_id", chatId)
		.eq("message_id", messageId)
	if (error) {
		console.error("supabase_review_update_error", error.message)
	}
}

async function loadPendingMessage(
	client: SupabaseClient,
	chatId: number,
	messageId: number,
): Promise<PendingMessage | null> {
	const { data, error } = await client
		.from(SUPABASE_TABLE)
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

async function updateApproval(
	client: SupabaseClient,
	input: {
		chatId: number
		messageId: number
		formattedText: string
		adminUserId: number
		approvedAt: string
	},
): Promise<void> {
	const { error } = await client
		.from(SUPABASE_TABLE)
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

function logEvent(event: string, payload: Record<string, unknown>): void {
	console.log(
		JSON.stringify({
			event,
			timestamp: new Date().toISOString(),
			...payload,
		}),
	)
}

export default webhookCallback(bot, "https")
// bot.start()
