import { webhookCallback } from "grammy"

// Импорт библиотек
import { createClient } from "@supabase/supabase-js"
import { Bot } from "grammy"

// Настройки
const BOT_TOKEN = process.env.TOKEN
const SUPABASE_URL = process.env.SP_HOST
const SUPABASE_KEY = process.env.SP_API_SECRET

// Инициализация
const bot = new Bot(BOT_TOKEN)
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Команда /subscribe
bot.command("subscribe", async ctx => {
	const userId = ctx.from.id
	const { error } = await supabase
		.from("subscriptions")
		.insert([{ user_id: userId }], { upsert: true })

	if (error) {
		console.error("Ошибка при добавлении пользователя:", error)
		return ctx.reply("Произошла ошибка при подписке. Попробуйте позже.")
	}

	return ctx.reply("Вы успешно подписались на уведомления о собраниях.")
})

// Команда /end_subscribe
bot.command("end_subscribe", async ctx => {
	const userId = ctx.from.id
	const { error } = await supabase.from("subscriptions").delete().eq("user_id", userId)

	if (error) {
		console.error("Ошибка при удалении пользователя:", error)
		return ctx.reply("Произошла ошибка при отмене подписки. Попробуйте позже.")
	}

	return ctx.reply("Вы успешно отписались от уведомлений о собраниях.")
})

// Хранилище данных о видеочате
let videoChatParticipants = new Set()

// Обработчик сообщений
bot.on("message", async ctx => {
	const text = ctx.message.text || ""

	// Фильтруем сообщения, которые содержат фразу о начале видеочата
	const chatStartedPattern = /(.*) начал(а) видеочат/

	if (chatStartedPattern.test(text)) {
		// Сообщение содержит информацию о начале видеочата
		const chatName = text.match(chatStartedPattern)[1] // Извлекаем название чата

		// Можно отправить уведомление подписчикам
		await ctx.reply(`${chatName} начал(а) видеочат. Присоединяйтесь!`)

		// Очищаем участников
		videoChatParticipants.clear()

		// Получаем список подписчиков
		const { data, error } = await supabase.from("subscriptions").select("user_id")
		if (error) {
			console.error("Ошибка при получении списка подписчиков:", error)
			return
		}

		const subscribers = data.map(sub => sub.user_id)
		const videoChatLink = `https://t.me/${ctx.chat.username}`

		// Отправка уведомлений подписчикам
		await Promise.all(
			subscribers.map(async userId => {
				try {
					await bot.api.sendMessage(userId, `Начало собрания: ${videoChatLink}`)
				} catch (err) {
					console.error(`Ошибка отправки сообщения пользователю ${userId}:`, err)
				}
			}),
		)
	}
})

export default webhookCallback(bot, "https")
