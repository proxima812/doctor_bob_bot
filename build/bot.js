"use strict"
Object.defineProperty(exports, "__esModule", { value: true })
const grammy_1 = require("grammy")
// Импорт библиотек
const supabase_js_1 = require("@supabase/supabase-js")
const grammy_2 = require("grammy")
// Настройки
const BOT_TOKEN = "6923422402:AAEBObqEF04ncfNijpfCK5jO5rHOIqqSRIo"
const SUPABASE_URL = "https://fkwivycaacgpuwfvozlp.supabase.co"
const SUPABASE_KEY =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrd2l2eWNhYWNncHV3ZnZvemxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzM5MDc4MTEsImV4cCI6MjA0OTQ4MzgxMX0.44dYay0RWos4tqwuj6H-ylqN4TrAIabeQLNzBn6Xuy0"
// Инициализация
const bot = new grammy_2.Bot(BOT_TOKEN)
const supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_KEY)
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
bot.on("video-chat-started", async ctx => {
	// Очищаем участников
	videoChatParticipants.clear()
	// Уведомляем подписчиков
	const { data, error } = await supabase.from("subscriptions").select("user_id")
	if (error) {
		console.error("Ошибка при получении списка подписчиков:", error)
		return
	}
	const subscribers = data.map(sub => sub.user_id)
	const videoChatLink = `https://t.me/${ctx.chat.username}`
	await Promise.all(
		subscribers.map(async userId => {
			try {
				await bot.api.sendMessage(userId, `Начало собрания: ${videoChatLink}`)
			} catch (err) {
				console.error(`Ошибка отправки сообщения пользователю ${userId}:`, err)
			}
		}),
	)
})
// Обработчик события добавления участников
bot.on("video-chat-participants-invited", ctx => {
	const invitedUsers = ctx.update.message.video_chat_participants_invited.users
	invitedUsers.forEach(user => videoChatParticipants.add(user.id))
})
// Обработчик завершения видеочата
bot.on("video-chat-ended", ctx => {
	const participantsCount = videoChatParticipants.size
	ctx.reply(`Видеочат завершен. Количество участников: ${participantsCount}.`)
	videoChatParticipants.clear() // Сбрасываем данные для следующего видеочата
})
// Запуск бота
bot.catch(err => {
	const ctx = err.ctx
	console.error(`Ошибка обработки обновления ${ctx.update.update_id}:`, err)
	if (err instanceof grammy_2.GrammyError) {
		console.error("Ошибка в Telegram API:", err.description)
	} else if (err instanceof grammy_2.HttpError) {
		console.error("Ошибка HTTP запроса:", err)
	} else {
		console.error("Неизвестная ошибка:", err)
	}
})
bot.start()
