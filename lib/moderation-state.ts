import type { PendingMessage } from "./types"

export type ModerationState = {
	pendingMessages: Map<string, PendingMessage>
}

export function createModerationState(): ModerationState {
	return {
		pendingMessages: new Map<string, PendingMessage>(),
	}
}
