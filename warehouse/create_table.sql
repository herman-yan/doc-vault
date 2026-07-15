-- 库房管理系统 - Supabase 建表脚本
-- 项目：bbiddukkkxthtairizlk（与 project-board / sentiment-log 同一 Supabase 项目）
-- 在 Supabase 控制台 → SQL Editor 中执行本脚本即可启用云端共享存储。
-- 未执行前，系统自动使用「本地缓存 + 静态 warehouse-data.json 种子」兜底，单浏览器可用。

create table if not exists warehouse_data (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamp default now()
);

-- 匿名(anon)可读写（与现有模块一致的 RLS 策略）
alter table warehouse_data enable row level security;

drop policy if exists "warehouse_anon_all" on warehouse_data;
create policy "warehouse_anon_all"
  on warehouse_data for all
  to anon
  using (true)
  with check (true);
