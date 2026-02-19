import { limit } from "@grammyjs/ratelimiter"
import { createClient } from "@supabase/supabase-js"
import { Bot, webhookCallback } from "grammy"

import { registerCallbackHandler } from "../lib/callback-handler"
import { loadConfig } from "../lib/config"
import { logEvent } from "../lib/logger"
import { registerMessageHandler } from "../lib/message-handler"
import { createMessageRepository } from "../lib/message-repository"
import { createModerationRepository } from "../lib/moderation-repository"
import { createModerationState } from "../lib/moderation-state"

const appConfig = loadConfig()

const bot = new Bot(appConfig.botToken)
const supabase = createClient(appConfig.supabaseUrl, appConfig.supabaseKey)

const repository = createMessageRepository(supabase, appConfig.supabaseTable)
const moderationRepository = createModerationRepository(supabase, {
	violationsTable: appConfig.violationsTable,
	statsTable: appConfig.statsTable,
	violationTtlHours: appConfig.violationTtlHours,
})
const state = createModerationState()

const limiterMiddleware = limit({
	timeFrame: appConfig.rateLimitWindowMs,
	limit: appConfig.rateLimitMaxMessages,
	keyGenerator: (ctx: any) => `${ctx.chat?.id ?? "private"}:${ctx.from?.id ?? "anon"}`,
	onLimitExceeded: async (ctx: any) => {
		if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
			return
		}
		const userId = ctx.from?.id
		if (!userId || appConfig.whitelistUserIds.has(userId)) {
			return
		}
		try {
			if ("message" in ctx.update && ctx.update.message) {
				await ctx.api.deleteMessage(ctx.chat.id, ctx.update.message.message_id)
			}
		} catch (error) {
			console.error("rate_limit_delete_message_error", error)
		}
		await moderationRepository.incrementDailyStat(ctx.chat.id, "rate_limited")
		logEvent("message_rate_limited", { chatId: ctx.chat.id, userId })
	},
})

bot.use(async (ctx, next) => {
	const userId = ctx.from?.id
	if (userId && appConfig.whitelistUserIds.has(userId)) {
		return next()
	}
	return limiterMiddleware(ctx, next)
})

registerMessageHandler(bot, {
	adminUserId: appConfig.adminUserId,
	moderationRepository,
	formatGuideUrl: appConfig.formatGuideUrl,
	warningDeleteAfterMs: appConfig.warningDeleteAfterMs,
	warningAtViolation: appConfig.warningAtViolation,
	banAtViolation: appConfig.banAtViolation,
	whitelistUserIds: appConfig.whitelistUserIds,
})

registerCallbackHandler(bot, {
	adminUserId: appConfig.adminUserId,
	repository,
	state,
})

const cleanupTimer = setInterval(() => {
	void moderationRepository.cleanupExpiredViolations()
}, 60 * 60 * 1000)
cleanupTimer.unref?.()

export default webhookCallback(bot, "https")
// bot.start()
