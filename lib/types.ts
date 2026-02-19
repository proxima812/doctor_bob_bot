export type PendingMessage = {
	chatId: number
	userId: number
	messageId: number
	rawText: string
}

export type DbMessageRecord = {
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

export type ViolationRecord = {
	chatId: number
	userId: number
	count: number
	warningIssued: boolean
	updatedAt: string
}

export type DailyStatEvent =
	| "messages_deleted"
	| "warnings_sent"
	| "users_banned"
	| "messages_bypassed"
	| "rate_limited"
