import { config } from "dotenv"
import { existsSync } from "fs"
import { resolve } from "path"

const DEFAULT_WHITELIST_USER_IDS = [5522146122, 6493585665]

export type BotConfig = {
	botToken: string
	adminUserId: number
	supabaseUrl: string
	supabaseKey: string
	supabaseTable: string
	violationsTable: string
	statsTable: string
	formatGuideUrl: string
	warningDeleteAfterMs: number
	warningAtViolation: number
	banAtViolation: number
	violationTtlHours: number
	rateLimitWindowMs: number
	rateLimitMaxMessages: number
	whitelistUserIds: Set<number>
}

export function loadConfig(): BotConfig {
	const envPaths = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]
	for (const envPath of envPaths) {
		if (existsSync(envPath)) {
			config({ path: envPath })
			break
		}
	}

	const botToken = process.env.TOKEN
	const adminUserId = Number(process.env.ADMIN_USER_ID ?? "5522146122")
	const supabaseUrl = process.env.SUPABASE_URL ?? process.env.URL
	const supabaseKey = process.env.SUPABASE_KEY ?? process.env.API
	const supabaseTable = process.env.SUPABASE_TABLE ?? "messages"

	const violationsTable = process.env.SUPABASE_VIOLATIONS_TABLE ?? "format_violations"
	const statsTable = process.env.SUPABASE_STATS_TABLE ?? "moderation_daily_stats"
	const formatGuideUrl = process.env.FORMAT_GUIDE_URL ?? "https://t.me/all_12steps/11031"
	const warningDeleteAfterMs = Number(process.env.WARNING_DELETE_AFTER_MS ?? "5000")
	const warningAtViolation = Number(process.env.WARNING_AT_VIOLATION ?? "2")
	const banAtViolation = Number(process.env.BAN_AT_VIOLATION ?? "3")
	const violationTtlHours = Number(process.env.VIOLATION_TTL_HOURS ?? "336")
	const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? "10000")
	const rateLimitMaxMessages = Number(process.env.RATE_LIMIT_MAX_MESSAGES ?? "3")

	const whitelistFromEnv = parseUserIds(process.env.WHITELIST_USER_IDS)
	const whitelistUserIds = new Set<number>([...DEFAULT_WHITELIST_USER_IDS, ...whitelistFromEnv, adminUserId])

	if (!botToken) {
		throw new Error("TOKEN не найден. Добавьте TOKEN в .env и перезапустите бота.")
	}

	if (!Number.isInteger(adminUserId) || adminUserId <= 0) {
		throw new Error("ADMIN_USER_ID не найден или некорректен. Добавьте его в .env.")
	}

	if (!supabaseUrl || !supabaseKey) {
		throw new Error("SUPABASE_URL/SUPABASE_KEY (или URL/API) не найдены в .env.")
	}

	if (!Number.isFinite(warningDeleteAfterMs) || warningDeleteAfterMs < 0) {
		throw new Error("WARNING_DELETE_AFTER_MS должен быть числом >= 0")
	}

	if (!Number.isInteger(warningAtViolation) || warningAtViolation <= 0) {
		throw new Error("WARNING_AT_VIOLATION должен быть целым числом > 0")
	}

	if (!Number.isInteger(banAtViolation) || banAtViolation <= warningAtViolation) {
		throw new Error("BAN_AT_VIOLATION должен быть целым числом > WARNING_AT_VIOLATION")
	}

	if (!Number.isInteger(rateLimitWindowMs) || rateLimitWindowMs <= 0) {
		throw new Error("RATE_LIMIT_WINDOW_MS должен быть целым числом > 0")
	}

	if (!Number.isInteger(rateLimitMaxMessages) || rateLimitMaxMessages <= 0) {
		throw new Error("RATE_LIMIT_MAX_MESSAGES должен быть целым числом > 0")
	}

	return {
		botToken,
		adminUserId,
		supabaseUrl,
		supabaseKey,
		supabaseTable,
		violationsTable,
		statsTable,
		formatGuideUrl,
		warningDeleteAfterMs,
		warningAtViolation,
		banAtViolation,
		violationTtlHours,
		rateLimitWindowMs,
		rateLimitMaxMessages,
		whitelistUserIds,
	}
}

function parseUserIds(raw: string | undefined): number[] {
	if (!raw) {
		return []
	}

	return raw
		.split(",")
		.map(value => Number(value.trim()))
		.filter(value => Number.isInteger(value) && value > 0)
}
