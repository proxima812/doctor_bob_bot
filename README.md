# @doctor_bob_bot

Telegram-бот для групповой модерации формата сообщений с хранением состояния в Supabase и запуском через Vercel Functions.

## Что делает бот

- Проверяет все сообщения в `group/supergroup`.
- Удаляет сообщения, которые не содержат разрешённые bypass-теги.
- Ведёт счётчик нарушений по пользователю и чату.
- Выдаёт предупреждение на заданном пороге нарушений.
- Банит пользователя на следующем пороге.
- Удаляет флуд-сообщения через rate limiter.
- Банит пользователя, если он добавил в чат другого бота.
- Считает ежедневную статистику модерации в БД.
- Периодически очищает просроченные записи нарушений.
- Имеет защищённый cron-эндпоинт `/api/cron` для тестового уведомления в Telegram.

## Правила модерации (по умолчанию)

- 1-е нарушение: удаление сообщения.
- 2-е нарушение: удаление + предупреждение.
- 3-е и далее: бан.

Пороги настраиваются через env:
- `WARNING_AT_VIOLATION`
- `BAN_AT_VIOLATION`

## Какие сообщения пропускаются

Если в тексте есть один из тегов (без учёта регистра), сообщение проходит без санкций:

- `#анонс`
- `#группа`
- `#объявления`

Теги заданы в `lib/constants.ts` (`BYPASS_MODERATION_TAGS`).

## Антифлуд

Используется `@grammyjs/ratelimiter`.

По умолчанию:
- окно: `10_000` мс
- лимит: `3` сообщения

При превышении лимита сообщение удаляется и пишется событие `rate_limited` в статистику.

## Архитектура

### Основные точки входа

- `api/bot.ts` — webhook-обработчик Telegram для бота.
- `api/cron.ts` — защищённый cron endpoint (Bearer `CRON_SECRET`) для отправки сервисного сообщения.

### Модули

- `lib/config.ts` — загрузка и валидация env.
- `lib/message-handler.ts` — основная логика модерации сообщений.
- `lib/moderation-repository.ts` — работа с таблицами нарушений и daily-статистики.
- `lib/message-repository.ts` — репозиторий сообщений (pending/approved).
- `lib/callback-handler.ts` — обработка callback-кнопок `approve/reject` (админ-only).
- `lib/moderation-policy.ts` — правила решения warn/ban.
- `lib/moderation-state.ts` — in-memory pending state.
- `lib/utils.ts` / `lib/constants.ts` / `lib/logger.ts` — утилиты, константы, логирование.

## Как работает поток сообщений

1. Telegram отправляет update на `/api/bot` (webhook).
2. Проверяется rate limit (кроме whitelist-пользователей).
3. Сообщение обрабатывается только для групп/супергрупп.
4. Игнорируются сервисные сообщения Telegram.
5. Если пользователь добавил нового бота в чат — инициируется бан.
6. Если в сообщении есть bypass-тег — счётчик нарушений сбрасывается.
7. Если тега нет — сообщение удаляется, нарушение инкрементируется.
8. На пороге warning отправляется предупреждение (с автоудалением).
9. На пороге ban пользователь банится, счётчик нарушений сбрасывается.

## База данных (Supabase)

Используются таблицы:

- `messages` (или значение `SUPABASE_TABLE`) — записи сообщений для сценария approve/reject.
- `format_violations` — счётчики нарушений.
- `moderation_daily_stats` — суточная статистика модерации.

SQL для таблиц нарушений и статистики: `sql/moderation_tables.sql`.

Применить можно в SQL Editor Supabase.

## Переменные окружения

Обязательные:

- `TOKEN` — токен Telegram-бота.
- `ADMIN_USER_ID` — Telegram user id администратора.
- `SUPABASE_URL` (или `URL`) — URL Supabase.
- `SUPABASE_KEY` (или `API`) — ключ Supabase.

Часто используемые опциональные:

- `SUPABASE_TABLE` (по умолчанию `messages`)
- `SUPABASE_VIOLATIONS_TABLE` (по умолчанию `format_violations`)
- `SUPABASE_STATS_TABLE` (по умолчанию `moderation_daily_stats`)
- `FORMAT_GUIDE_URL` (ссылка на правила формата)
- `WARNING_DELETE_AFTER_MS` (валидируется, но в текущей реализации фактически не используется для таймера предупреждения)
- `WARNING_AT_VIOLATION` (по умолчанию `2`)
- `BAN_AT_VIOLATION` (по умолчанию `3`)
- `VIOLATION_TTL_HOURS` (по умолчанию `336` = 14 дней)
- `RATE_LIMIT_WINDOW_MS` (по умолчанию `10000`)
- `RATE_LIMIT_MAX_MESSAGES` (по умолчанию `3`)
- `WHITELIST_USER_IDS` (список через запятую)
- `CRON_SECRET` (для `/api/cron`)
- `CRON_CHAT_ID` (чат для cron-сообщения; fallback: `GROUP_CHAT_ID`, затем `ADMIN_USER_ID`)

## Локальный запуск

Установка зависимостей:

```bash
bun install
```

Сборка:

```bash
bun run build
```

Тесты:

```bash
bun test
```

Примечание: в `package.json` скрипт `dev` сейчас указывает на несуществующий путь `src/api/bot.ts`. Для локальной разработки через Vercel удобнее использовать `vercel dev`.

## Деплой (Vercel)

Проект настроен через `vercel.json`:

- build command: `bun run build`
- функции:
  - `api/bot.ts` (memory 1024, maxDuration 10)
  - `api/cron.ts` (memory 512, maxDuration 10)
- cron: `0 10 * * 1` вызывает `/api/cron`

После деплоя нужно установить webhook Telegram:

```text
https://api.telegram.org/bot<TOKEN>/setWebhook?url=<VERCEL_URL>/api/bot/
```

Пример есть в `curl.txt`.

## Callback approve/reject

В коде есть обработчик callback-кнопок (`approve:<chatId>:<messageId>`, `reject:<chatId>:<messageId>`), доступный только `ADMIN_USER_ID`.

Важно: в текущей версии основной message flow не создаёт такие callback-кнопки автоматически, поэтому этот функционал требует отдельного источника callback-сообщений.

## Логи

События пишутся в stdout JSON-объектами через `logEvent(...)`.

Примеры событий:

- `message_deleted_missing_tag`
- `message_bypassed_by_tag`
- `message_rate_limited`
- `user_banned_for_adding_bot`
- `user_banned_after_format_violations`
- `message_approved`
- `message_rejected_by_admin`

## Ограничения и текущие нюансы

- `warningDeleteAfterMs` передаётся в зависимости, но в `message-handler.ts` сейчас используется жёсткое значение `5_000` мс.
- `api/cron.ts` отправляет фиксированный текст `"привет!"` (технический health-check сценарий).
- `message-repository.ts` и `callback-handler.ts` реализованы, но не полностью задействованы в текущем базовом флоу модерации.

## Быстрый чеклист после настройки

1. Заполнить `.env`.
2. Создать таблицы в Supabase (`sql/moderation_tables.sql`).
3. Задеплоить на Vercel.
4. Установить webhook Telegram на `/api/bot`.
5. Проверить в группе:
   - сообщение без тега удаляется,
   - с тегом проходит,
   - на 2-м нарушении приходит предупреждение,
   - на 3-м нарушении пользователь банится.
