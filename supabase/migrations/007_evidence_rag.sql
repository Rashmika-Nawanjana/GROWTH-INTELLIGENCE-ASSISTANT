-- Run after 004_tighten_rls.sql
-- Evidence RAG: durable research artifact store (scraped pages + agent facts)

create table if not exists evidence_documents (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references auth.users not null,
  url          text not null,
  title        text,
  source_tool  text not null,
  domain       text,
  product      text,
  category     text,
  geography    text,
  content_hash text not null,
  fetched_at   timestamptz not null,
  created_at   timestamptz default now(),
  unique (user_id, content_hash)
);

create table if not exists evidence_chunks (
  id          uuid default gen_random_uuid() primary key,
  document_id uuid references evidence_documents on delete cascade not null,
  user_id     uuid references auth.users not null,
  kind        text not null default 'page' check (kind in ('page', 'fact')),
  chunk_index int not null,
  content     text not null,
  embedding   vector(768) not null,
  created_at  timestamptz default now()
);

create index if not exists evidence_documents_user_product_idx
  on evidence_documents (user_id, product);

create index if not exists evidence_documents_user_fetched_idx
  on evidence_documents (user_id, fetched_at desc);

create index if not exists evidence_chunks_user_id_idx
  on evidence_chunks (user_id);

create index if not exists evidence_chunks_document_id_idx
  on evidence_chunks (document_id);

create index if not exists evidence_chunks_embedding_idx
  on evidence_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table evidence_documents enable row level security;
alter table evidence_chunks enable row level security;

create policy "Users own their evidence documents"
  on evidence_documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users own their evidence chunks"
  on evidence_chunks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function match_evidence_chunks(
  p_user_id uuid,
  p_query_embedding vector(768),
  p_match_count int default 8,
  p_product text default null,
  p_domain text default null,
  p_max_age_days int default 30
)
returns table (
  id uuid,
  document_id uuid,
  kind text,
  chunk_index int,
  content text,
  similarity float,
  url text,
  title text,
  source_tool text,
  domain text,
  product text,
  fetched_at timestamptz,
  age_days int
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    c.kind,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> p_query_embedding) as similarity,
    d.url,
    d.title,
    d.source_tool,
    d.domain,
    d.product,
    d.fetched_at,
    greatest(0, (extract(epoch from (now() - d.fetched_at)) / 86400)::int) as age_days
  from evidence_chunks c
  join evidence_documents d on d.id = c.document_id
  where c.user_id = p_user_id
    and d.fetched_at >= now() - make_interval(days => greatest(1, p_max_age_days))
    and (p_product is null or p_product = '' or d.product ilike '%' || p_product || '%')
    and (p_domain is null or p_domain = '' or d.domain = p_domain)
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 20));
$$;
