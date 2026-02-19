import { BYPASS_MODERATION_TAGS, SERVICE_MESSAGE_KEYS } from "./constants"

export function isServiceMessage(message: object): boolean {
	for (const key of SERVICE_MESSAGE_KEYS) {
		if (key in message) {
			return true
		}
	}
	return false
}

export function makePendingKey(chatId: number, messageId: number): string {
	return `${chatId}:${messageId}`
}

export function makeUserChatKey(chatId: number, userId: number): string {
	return `${chatId}:${userId}`
}

export function hasBypassModerationTag(text: string): boolean {
	if (!text) {
		return false
	}

	const tags = text.match(/#[\p{L}\p{N}_]+/gu) ?? []
	for (const tag of tags) {
		const normalized = tag.slice(1).toLocaleLowerCase("ru-RU")
		if (BYPASS_MODERATION_TAGS.has(normalized)) {
			return true
		}
	}
	return false
}

export function getParticipantName(user: { first_name?: string; last_name?: string; username?: string } | undefined): string {
	if (!user) {
		return "Участник"
	}
	const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim()
	if (fullName) {
		return fullName
	}
	if (user.username) {
		return user.username
	}
	return "Участник"
}

export function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function parseActionData(
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
