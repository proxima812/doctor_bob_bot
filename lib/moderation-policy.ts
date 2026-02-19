export type ModerationDecision = {
	shouldWarn: boolean
	shouldBan: boolean
}

export function decideModerationAction(input: {
	violationCount: number
	warningAtViolation: number
	banAtViolation: number
}): ModerationDecision {
	const shouldWarn = input.violationCount === input.warningAtViolation
	const shouldBan = input.violationCount >= input.banAtViolation

	return { shouldWarn, shouldBan }
}
