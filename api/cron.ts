type ApiRequest = {
	headers: Record<string, string | string[] | undefined>
}

type ApiResponse = {
	status: (code: number) => ApiResponse
	json: (body: unknown) => void
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
	if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
		return res.status(401).json({ ok: false, error: "unauthorized" })
	}

	const token = process.env.TOKEN
	const chatId = process.env.CRON_CHAT_ID ?? process.env.GROUP_CHAT_ID ?? process.env.ADMIN_USER_ID

	if (!token || !chatId) {
		return res.status(500).json({ ok: false, error: "missing TOKEN or CRON_CHAT_ID/GROUP_CHAT_ID/ADMIN_USER_ID" })
	}

	const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
			text: "привет!",
		}),
	})

	if (!response.ok) {
		const text = await response.text()
		return res.status(502).json({ ok: false, error: "telegram_send_failed", details: text })
	}

	return res.status(200).json({ ok: true })
}
