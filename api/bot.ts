import { webhookCallback } from "grammy"

import { config } from "dotenv"
import { existsSync } from "fs"
import { resolve } from "path"
import { Bot } from "grammy"

const envPaths = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]
for (const envPath of envPaths) {
	if (existsSync(envPath)) {
		config({ path: envPath })
		break
	}
}

type AnnouncementRecord = {
	chatId: number
	userId: number
	messageId: number
	createdAt: string
	rawText: string
}

const BOT_TOKEN = process.env.TOKEN
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID,)
const REQUIRED_TAG = (process.env.REQUIRED_TAG ?? "#анонс_группы").toLowerCase()
const FORMAT_LINK = process.env.FORMAT_LINK ?? "https://t.me"
const SPAM_WINDOW_MS = parsePositiveInt(process.env.SPAM_WINDOW_MS, 15_000)
const SPAM_MAX_MESSAGES = parsePositiveInt(process.env.SPAM_MAX_MESSAGES, 3)
const DUPLICATE_WINDOW_MS = parsePositiveInt(process.env.DUPLICATE_WINDOW_MS, 30_000)

if (!BOT_TOKEN) {
	throw new Error("TOKEN не найден. Добавьте TOKEN в .env и перезапустите бота.")
}

if (!Number.isInteger(ADMIN_USER_ID) || ADMIN_USER_ID <= 0) {
	throw new Error("ADMIN_USER_ID не найден или некорректен. Добавьте его в .env.")
}

const bot = new Bot(BOT_TOKEN)

const spamBuckets = new Map<string, number[]>()
const lastContentByUser = new Map<string, { hash: string; ts: number }>()
const lastPinnedByChat = new Map<number, number>()
const announcementsSessionStore = new Map<string, AnnouncementRecord>()

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
	const chatId = ctx.chat.id
	const messageId = message.message_id
	const rawText = `${message.text ?? ""}${message.caption ? `\n${message.caption}` : ""}`.trim()
	const normalizedForChecks = normalizeForChecks(rawText)
	const isAdmin = userId === ADMIN_USER_ID

	if (!isAdmin && userId !== undefined) {
		const rateLimited = hitRateLimit(chatId, userId, Date.now())
		const duplicate = isDuplicate(chatId, userId, normalizedForChecks, Date.now())
		if (rateLimited || duplicate) {
			try {
				await ctx.api.deleteMessage(chatId, messageId)
			} catch (error) {
				console.error("delete_message_error", error)
			}

			logEvent("message_rejected", {
				chatId,
				userId,
				messageId,
				reason: rateLimited ? "rate_limit" : "duplicate",
			})
			return
		}
	}

	const hasRequiredTag = normalizedForChecks.includes(REQUIRED_TAG)
	if (!isAdmin && !hasRequiredTag) {
		try {
			await ctx.api.deleteMessage(chatId, messageId)
		} catch (error) {
			console.error("delete_message_error", error)
		}

		try {
			await ctx.reply(`пишите по формату. <a href="${FORMAT_LINK}">Формату</a> - ссылка + текст`, {
				parse_mode: "HTML",
				disable_web_page_preview: true,
			})
		} catch (error) {
			console.error("reply_error", error)
		}

		logEvent("message_rejected", {
			chatId,
			userId,
			messageId,
			reason: "invalid_format",
		})
		return
	}

	if (!hasRequiredTag) {
		return
	}

	if (userId !== undefined) {
		const record: AnnouncementRecord = {
			chatId,
			userId,
			messageId,
			createdAt: new Date().toISOString(),
			rawText,
		}
		announcementsSessionStore.set(`${chatId}:${messageId}`, record)
	}

	const previousPinnedMessageId = lastPinnedByChat.get(chatId)
	if (previousPinnedMessageId !== undefined && previousPinnedMessageId !== messageId) {
		try {
			await ctx.api.unpinChatMessage(chatId, previousPinnedMessageId)
		} catch (error) {
			console.error("unpin_error", error)
		}
	}

	try {
		await ctx.api.pinChatMessage(chatId, messageId, { disable_notification: true })
		lastPinnedByChat.set(chatId, messageId)
	} catch (error) {
		console.error("pin_error", error)
	}

	logEvent("announcement_accepted", {
		chatId,
		userId,
		messageId,
		rawText,
	})
})

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
	if (!rawValue) {
		return fallback
	}

	const parsed = Number(rawValue)
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return fallback
	}

	return parsed
}

function isServiceMessage(message: Record<string, unknown>): boolean {
	for (const key of SERVICE_MESSAGE_KEYS) {
		if (key in message) {
			return true
		}
	}
	return false
}

function hitRateLimit(chatId: number, userId: number, now: number): boolean {
	const key = `${chatId}:${userId}`
	const bucket = spamBuckets.get(key) ?? []
	const freshTimestamps = bucket.filter(ts => now - ts <= SPAM_WINDOW_MS)
	if (freshTimestamps.length >= SPAM_MAX_MESSAGES) {
		spamBuckets.set(key, freshTimestamps)
		return true
	}

	freshTimestamps.push(now)
	spamBuckets.set(key, freshTimestamps)
	return false
}

function isDuplicate(chatId: number, userId: number, normalizedText: string, now: number): boolean {
	if (!normalizedText) {
		return false
	}

	const key = `${chatId}:${userId}`
	const previous = lastContentByUser.get(key)
	const hash = normalizedText

	if (previous && previous.hash === hash && now - previous.ts <= DUPLICATE_WINDOW_MS) {
		return true
	}

	lastContentByUser.set(key, { hash, ts: now })
	return false
}

function normalizeForChecks(text: string): string {
	return text
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim()
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
