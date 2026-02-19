import { describe, expect, test } from "bun:test"

import { decideModerationAction } from "./moderation-policy"

describe("decideModerationAction", () => {
	test("не предупреждает на первом нарушении", () => {
		const result = decideModerationAction({
			violationCount: 1,
			warningAtViolation: 2,
			banAtViolation: 3,
		})

		expect(result).toEqual({ shouldWarn: false, shouldBan: false })
	})

	test("дает предупреждение только на втором нарушении", () => {
		const result = decideModerationAction({
			violationCount: 2,
			warningAtViolation: 2,
			banAtViolation: 3,
		})

		expect(result).toEqual({ shouldWarn: true, shouldBan: false })
	})

	test("банит на третьем и следующих нарушениях", () => {
		const third = decideModerationAction({
			violationCount: 3,
			warningAtViolation: 2,
			banAtViolation: 3,
		})
		const fourth = decideModerationAction({
			violationCount: 4,
			warningAtViolation: 2,
			banAtViolation: 3,
		})

		expect(third).toEqual({ shouldWarn: false, shouldBan: true })
		expect(fourth).toEqual({ shouldWarn: false, shouldBan: true })
	})
})
