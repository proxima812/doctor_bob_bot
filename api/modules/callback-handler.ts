import type { Bot, Context } from "grammy"

import { logEvent } from "./logger"
import type { MessageRepository } from "./message-repository"
import type { ModerationState } from "./moderation-state"
import { makePendingKey, parseActionData } from "./utils"

type CallbackHandlerDeps = {
	adminUserId: number
	repository: MessageRepository
	state: ModerationState
}

export function registerCallbackHandler(bot: Bot<Context>, deps: CallbackHandlerDeps): void {
	bot.on("callback_query:data", async ctx => {
		const userId = ctx.from?.id
		const data = ctx.callbackQuery.data ?? ""
		if (!data.startsWith("approve:") && !data.startsWith("reject:")) {
			return
		}

		if (userId !== deps.adminUserId) {
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
		const pending = deps.state.pendingMessages.get(key) ?? (await deps.repository.loadPendingMessage(chatId, messageId))
		if (!pending) {
			await ctx.answerCallbackQuery({ text: "Запись не найдена в pending.", show_alert: true })
			return
		}
		const reviewMessageId = ctx.callbackQuery.message?.message_id

		if (action === "reject") {
			deps.state.pendingMessages.delete(key)
			await deps.repository.deleteMessageRecord(chatId, messageId)
			try {
				if (reviewMessageId !== undefined) {
					await ctx.api.deleteMessage(deps.adminUserId, reviewMessageId)
				}
			} catch (error) {
				console.error("delete_review_message_error", error)
			}

			try {
				await ctx.api.sendMessage(
					deps.adminUserId,
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

		deps.state.pendingMessages.delete(key)
		await deps.repository.updateApproval({
			chatId,
			messageId,
			formattedText: pending.rawText,
			adminUserId: deps.adminUserId,
			approvedAt: new Date().toISOString(),
		})
		await deps.repository.deleteMessageRecord(chatId, messageId)

		try {
			if (reviewMessageId !== undefined) {
				await ctx.api.deleteMessage(deps.adminUserId, reviewMessageId)
			}
		} catch (error) {
			console.error("delete_review_message_error", error)
		}

		await ctx.answerCallbackQuery({ text: "Готово." })
		logEvent("message_approved", { chatId, sourceMessageId: messageId, sentMessageId, sourceDeleted })
	})
}
