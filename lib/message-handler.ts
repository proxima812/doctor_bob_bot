import type { Bot, Context } from "grammy"

import { logEvent } from "./logger"
import { decideModerationAction } from "./moderation-policy"
import type { ModerationRepository } from "./moderation-repository"
import { escapeHtml, getParticipantName, hasBypassModerationTag, isServiceMessage } from "./utils"

type MessageHandlerDeps = {
	adminUserId: number
	moderationRepository: ModerationRepository
	formatGuideUrl: string
	warningDeleteAfterMs: number
	warningAtViolation: number
	banAtViolation: number
	whitelistUserIds: Set<number>
}

export function registerMessageHandler(bot: Bot<Context>, deps: MessageHandlerDeps): void {
	bot.on("message", async ctx => {
		if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
			return
		}

		const message = ctx.message
		const userId = ctx.from?.id
		if (userId === undefined || userId === deps.adminUserId || deps.whitelistUserIds.has(userId)) {
			return
		}

		if ("new_chat_members" in message && Array.isArray(message.new_chat_members)) {
			const addedBot = message.new_chat_members.some(member => member.is_bot)
			if (addedBot) {
				try {
					await ctx.api.banChatMember(ctx.chat.id, userId)
					await deps.moderationRepository.incrementDailyStat(ctx.chat.id, "users_banned")
					logEvent("user_banned_for_adding_bot", { chatId: ctx.chat.id, userId })
				} catch (error) {
					console.error("ban_user_for_adding_bot_error", error)
				}
				return
			}
		}

		if (isServiceMessage(message)) {
			return
		}

		const chatId = ctx.chat.id
		const messageId = message.message_id
		const rawText = `${message.text ?? ""}${message.caption ? `\n${message.caption}` : ""}`.trim()

		if (hasBypassModerationTag(rawText)) {
			await deps.moderationRepository.resetViolation(chatId, userId)
			await deps.moderationRepository.incrementDailyStat(chatId, "messages_bypassed")
			logEvent("message_bypassed_by_tag", { chatId, userId, messageId })
			return
		}

		try {
			await ctx.api.deleteMessage(chatId, messageId)
			await deps.moderationRepository.incrementDailyStat(chatId, "messages_deleted")
			logEvent("message_deleted_missing_tag", { chatId, userId, messageId })
		} catch (error) {
			console.error("delete_missing_tag_message_error", error)
		}

		const currentViolation = await deps.moderationRepository.getViolation(chatId, userId)
		const nextCount = (currentViolation?.count ?? 0) + 1
		const decision = decideModerationAction({
			violationCount: nextCount,
			warningAtViolation: deps.warningAtViolation,
			banAtViolation: deps.banAtViolation,
		})

		if (!decision.shouldBan) {
			try {
				const participantName = escapeHtml(getParticipantName(ctx.from))
				const warningPrefix = decision.shouldWarn ? " Это предупреждение." : ""
				const noticeLifetimeMs = 5_000
				const warning = await ctx.api.sendMessage(
					chatId,
					`<a href="tg://user?id=${userId}">${participantName}</a>, сообщение удалено.${warningPrefix} Перед публикацией прочитайте формат: ${deps.formatGuideUrl}`,
					{ parse_mode: "HTML" },
				)

				if (decision.shouldWarn) {
					await deps.moderationRepository.incrementDailyStat(chatId, "warnings_sent")
				}

				setTimeout(async () => {
					try {
						await ctx.api.deleteMessage(chatId, warning.message_id)
					} catch (error) {
						console.error("delete_format_warning_message_error", error)
					}
				}, noticeLifetimeMs)
			} catch (error) {
				console.error("notify_missing_tag_format_error", error)
			}
		}

		if (decision.shouldBan) {
			try {
				await ctx.api.banChatMember(chatId, userId)
				await deps.moderationRepository.resetViolation(chatId, userId)
				await deps.moderationRepository.incrementDailyStat(chatId, "users_banned")
				logEvent("user_banned_after_format_violations", { chatId, userId, violations: nextCount })
				return
			} catch (error) {
				console.error("ban_user_after_format_violations_error", error)
			}
		}

		await deps.moderationRepository.upsertViolation({
			chatId,
			userId,
			count: nextCount,
			warningIssued: decision.shouldWarn || Boolean(currentViolation?.warningIssued),
		})
	})
}
