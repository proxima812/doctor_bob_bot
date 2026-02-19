-- Таблица нарушений формата (персистентный счетчик)
create table if not exists public.format_violations (
    chat_id bigint not null,
    user_id bigint not null,
    violation_count integer not null default 0,
    warning_issued boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (chat_id, user_id)
);

create index if not exists idx_format_violations_updated_at
    on public.format_violations (updated_at);

-- Ежедневная статистика модерации
create table if not exists public.moderation_daily_stats (
    chat_id bigint not null,
    day date not null,
    messages_deleted integer not null default 0,
    warnings_sent integer not null default 0,
    users_banned integer not null default 0,
    messages_bypassed integer not null default 0,
    rate_limited integer not null default 0,
    updated_at timestamptz not null default now(),
    primary key (chat_id, day)
);
