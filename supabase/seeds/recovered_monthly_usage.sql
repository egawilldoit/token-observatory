begin;

create temporary table _recovered_monthly_seed_rows (
  id text not null,
  month date not null,
  agent text not null,
  input_tokens bigint not null,
  output_tokens bigint not null,
  cache_creation_tokens bigint not null,
  cache_read_tokens bigint not null,
  total_tokens bigint not null,
  reported_cost_usd numeric,
  models text[] not null
) on commit drop;

insert into _recovered_monthly_seed_rows values
  ('lost-windows-history-2026-05-08:2026-05:all', '2026-05-01', 'All', 9172233, 760817, 0, 104578084, 114511134, 120.94, '{}'),
  ('lost-windows-history-2026-05-08:2026-05:codex', '2026-05-01', 'Codex', 9162254, 760220, 0, 104572672, 114495146, 120.90, ARRAY['gpt-5.5']),
  ('lost-windows-history-2026-05-08:2026-05:gemini-cli', '2026-05-01', 'Gemini CLI', 9979, 597, 0, 5412, 15988, 0.04, ARRAY['gemini-3.1-pro-preview']),
  ('lost-windows-history-2026-05-08:2026-06:all', '2026-06-01', 'All', 66366953, 6913485, 0, 1324959636, 1398240074, 515.05, '{}'),
  ('lost-windows-history-2026-05-08:2026-06:codex', '2026-06-01', 'Codex', 53210093, 5142031, 0, 837061376, 895413500, 496.05, ARRAY['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5']),
  ('lost-windows-history-2026-05-08:2026-06:opencode', '2026-06-01', 'OpenCode', 13156860, 1771454, 0, 487898260, 502826574, 19.00, ARRAY['deepseek-v4-flash', 'deepseek-v4-flash-free', 'deepseek-v4-pro', 'mimo-v2.5-free', 'minimax-m3']),
  ('lost-windows-history-2026-05-08:2026-07:all', '2026-07-01', 'All', 104026745, 9579406, 0, 2360740627, 2474346778, 329.02, '{}'),
  ('lost-windows-history-2026-05-08:2026-07:codex', '2026-07-01', 'Codex', 49931343, 3776798, 0, 1069986560, 1123694701, 281.84, ARRAY['gpt-5.4-mini', 'gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra']),
  ('lost-windows-history-2026-05-08:2026-07:opencode', '2026-07-01', 'OpenCode', 54093230, 5802563, 0, 1290754067, 1350649860, 47.18, ARRAY['deepseek-v4-flash', 'deepseek-v4-flash-free', 'deepseek-v4-pro', 'gemini-3.6-flash', 'hy3-free', 'kimi-k3', 'laguna-s-2.1-free', 'mimo-v2.5']),
  ('lost-windows-history-2026-05-08:2026-07:pi-agent', '2026-07-01', 'pi-agent', 2172, 45, 0, 0, 2217, 0.00, ARRAY['[pi] deepseek-v4-flash']),
  ('lost-windows-history-2026-05-08:2026-08:all', '2026-08-01', 'All', 123631901, 14944563, 0, 5540616452, 5679192916, 421.18, '{}'),
  ('lost-windows-history-2026-05-08:2026-08:codex', '2026-08-01', 'Codex', 96385495, 10984851, 0, 3978407168, 4085777514, 410.64, ARRAY['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra']),
  ('lost-windows-history-2026-05-08:2026-08:opencode', '2026-08-01', 'OpenCode', 27246406, 3959712, 0, 1562209284, 1593415402, 10.54, ARRAY['deepseek-v4-flash', 'deepseek-v4-flash-free', 'muse-spark-1.2-contributor-free', 'ox-alpha-free']);

do $$
declare
  v_month record;
  v_input bigint;
  v_output bigint;
  v_cache_creation bigint;
  v_cache_read bigint;
  v_total bigint;
begin
  for v_month in
    select month
    from _recovered_monthly_seed_rows
    group by month
    order by month
  loop
    select
      input_tokens,
      output_tokens,
      cache_creation_tokens,
      cache_read_tokens,
      total_tokens
    into v_input, v_output, v_cache_creation, v_cache_read, v_total
    from _recovered_monthly_seed_rows
    where month = v_month.month and agent = 'All';

    if v_input is null then
      raise exception 'Missing All row for recovered month %', v_month.month;
    end if;

    if (select coalesce(sum(input_tokens), 0) from _recovered_monthly_seed_rows where month = v_month.month and agent <> 'All') <> v_input
      or (select coalesce(sum(output_tokens), 0) from _recovered_monthly_seed_rows where month = v_month.month and agent <> 'All') <> v_output
      or (select coalesce(sum(cache_creation_tokens), 0) from _recovered_monthly_seed_rows where month = v_month.month and agent <> 'All') <> v_cache_creation
      or (select coalesce(sum(cache_read_tokens), 0) from _recovered_monthly_seed_rows where month = v_month.month and agent <> 'All') <> v_cache_read
      or (select coalesce(sum(total_tokens), 0) from _recovered_monthly_seed_rows where month = v_month.month and agent <> 'All') <> v_total then
      raise exception 'Recovered month % does not reconcile to agent rows', v_month.month;
    end if;
  end loop;

  select
    sum(input_tokens),
    sum(output_tokens),
    sum(cache_creation_tokens),
    sum(cache_read_tokens),
    sum(total_tokens)
  into v_input, v_output, v_cache_creation, v_cache_read, v_total
  from _recovered_monthly_seed_rows
  where agent = 'All';

  if v_input <> 303197832
    or v_output <> 32198271
    or v_cache_creation <> 0
    or v_cache_read <> 9330894799
    or v_total <> 9666290902 then
    raise exception 'Recovered four-month total failed reconciliation';
  end if;
end;
$$;

insert into public.recovered_usage_sets (
  id,
  description,
  source_type,
  source_machine_count,
  suspected_mirror,
  accounting_mode,
  confidence,
  granularity,
  total_input_tokens,
  total_output_tokens,
  total_cache_creation_tokens,
  total_cache_read_tokens,
  total_tokens,
  reported_cost_usd,
  pricing_complete,
  warnings,
  raw_terminal_text
)
values (
  'lost-windows-history-2026-05-08',
  'Recovered ccusage monthly report from one permanently lost Windows PC',
  'terminal_ccusage_monthly',
  1,
  false,
  'additive_recovered',
  'exact_monthly_aggregate',
  'monthly_agent',
  303197832,
  32198271,
  0,
  9330894799,
  9666290902,
  1386.19,
  false,
  '["Missing pricing for laguna-s-2.1-free; cost excludes this model. Update pricing or run again after LiteLLM has the model.", "Missing pricing for ox-alpha-free; cost excludes this model. Update pricing or run again after LiteLLM has the model."]'::jsonb,
  $lost_machine_a$
PS C:\Users\abdelilah.mortaki> npx ccusage@latest monthly
Need to install the following packages:
ccusage@20.0.20
Ok to proceed? (y)

╭───────────────────────────────────────────────────╮
│                                                   │
│     Coding (Agent) CLI Usage Report - Monthly     │
│  Detected: Codex, Gemini CLI, OpenCode, pi-agent  │
│                                                   │
╰───────────────────────────────────────────────────╯

┌──────────┬────────────┬─────────────────────────────┬───────────┬──────────┬────────────┬─────────────┬─────────────┬──────────┐
│ Month    │ Agent      │ Models                      │     Input │   Output │      Cache │  Cache Read │       Total │     Cost │
│          │            │                             │           │          │     Create     │             │      Tokens │    (USD) │
├──────────┼────────────┼─────────────────────────────┼───────────┼──────────┼────────────┼─────────────┼─────────────┼──────────┤
│ 2026-05  │ All        │                             │ 9,172,233 │  760,817 │          0 │ 104,578,084 │ 114,511,134 │  $120.94 │
├──────────┼────────────┼─────────────────────────────┼───────────┼──────────┼────────────┼─────────────┼─────────────┼──────────┤
│          │ - Codex    │ - gpt-5.5                   │ 9,162,254 │  760,220 │          0 │ 104,572,672 │ 114,495,146 │  $120.90 │
├──────────┼────────────┼─────────────────────────────┼───────────┼──────────┼────────────┼─────────────┼─────────────┼──────────┤
│          │ - Gemini   │ - gemini-3.1-pro-preview    │     9,979 │      597 │          0 │       5,412 │      15,988 │    $0.04 │
│          │ CLI        │                             │           │          │            │             │             │          │
├──────────┼────────────┼─────────────────────────────┼───────────┼──────────┼────────────┼───────────┼─────────────┼──────────┤
│ 2026-06  │ All        │                             │ 66,366,9… │ 6,913,4… │          0 │ 1,324,959,… │ 1,398,240,… │  $515.05 │
├──────────┼────────────┼─────────────────────────────┼───────────┼──────────┼────────────┼─────────────┼──────────┤
│          │ - Codex    │ - gpt-5.4                   │ 53,210,0… │ 5,142,0… │          0 │ 837,061,376 │ 895,413,500 │  $496.05 │
│          │            │ - gpt-5.4-mini              │           │           │            │             │             │          │
│          │            │ - gpt-5.5                   │           │           │            │             │             │          │
├──────────┼────────────┼─────────────────────────────┼───────────┼──────────┼────────────┼─────────────┼──────────┤
│          │ - OpenCode │ - deepseek-v4-flash         │ 13,156,8… │ 1,771,4… │          0 │ 487,898,260 │ 502,826,574 │   $19.00 │
│          │            │ - deepseek-v4-flash-free    │           │           │            │             │             │          │
│          │            │ - deepseek-v4-pro            │           │           │            │             │             │          │
│          │            │ - mimo-v2.5-free            │           │           │            │             │             │          │
│          │            │ - minimax-m3                 │           │           │            │             │             │          │
├──────────┼────────────┼─────────────────────────────┼───────────┼──────────┼─────────────┼─────────────┼──────────┼──────────┤
│ 2026-07  │ All        │                             │ 104,026,… │ 9,579,4… │          0 │ 2,360,740,… │ 2,474,346,… │  $329.02 │
├──────────┼────────────┼─────────────────────────────┼───────────┼──────────┼─────────────┼─────────────┼───────────┼──────────┤
│          │ - Codex    │ - gpt-5.4-mini              │ 49,931,3… │ 3,776,7… │          0 │ 1,069,986,… │ 1,123,694,… │  $281.84 │
│          │            │ - gpt-5.5                   │           │           │            │             │             │          │
│          │            │ - gpt-5.6-luna              │           │           │            │             │             │          │
│          │            │ - gpt-5.6-sol               │           │           │            │             │             │          │
│          │            │ - gpt-5.6-terra             │           │           │            │             │             │          │
├──────────┼────────────┼─────────────────────────────┼───────────┼───────────┼────────────┼─────────────┼─────────────┼──────────┤
│          │ - OpenCode │ - deepseek-v4-flash         │ 54,093,2… │ 5,802,5… │          0 │ 1,290,754,… │ 1,350,649,… │   $47.18 │
│          │            │ - deepseek-v4-flash-free    │           │           │            │             │             │          │
│          │            │ - deepseek-v4-pro            │           │           │            │             │             │          │
│          │            │ - gemini-3.6-flash          │           │           │            │             │             │          │
│          │            │ - hy3-free                   │           │           │            │             │             │          │
│          │            │ - kimi-k3                    │           │           │            │             │             │          │
│          │            │ - laguna-s-2.1-free          │           │           │            │             │             │          │
│          │            │ - mimo-v2.5                  │           │           │            │             │             │          │
├──────────┼────────────┼─────────────────────────────┼───────────┼───────────┼─────────────┼─────────────┼─────────────┼──────────┤
│          │ - pi-agent │ - [pi] deepseek-v4-flash    │     2,172 │       45 │          0 │           0 │       2,217 │    $0.00 │
├──────────┼────────────┼─────────────────────────────┼───────────┼──────────┼─────────────┼─────────────┼─────────────┼──────────┤
│ 2026-08  │ All        │                             │ 123,631,… │ 14,944,… │          0 │ 5,540,616,… │ 5,679,192,… │  $421.18 │
├──────────┼────────────┼─────────────────────────────┼───────────┼──────────┼─────────────┼─────────────┼─────────────┼──────────┤
│          │ - Codex    │ - gpt-5.6-luna              │ 96,385,4… │ 10,984,… │          0 │ 3,978,407,… │ 4,085,777,… │  $410.64 │
│          │            │ - gpt-5.6-sol                │           │           │            │             │             │          │
│          │            │ - gpt-5.6-terra               │           │           │            │             │             │          │
├──────────┼──────────┼───────────────────────────────┼───────────┼──────────┼────────────┼─────────────┼─────────────┼──────────┤
│          │ - OpenCode │ - deepseek-v4-flash         │ 27,246,4… │ 3,959,7… │          0 │ 1,562,209,… │ 1,593,415,… │   $10.54 │
│          │            │ - deepseek-v4-flash-free    │           │           │            │             │             │          │
│          │            │ -                           │           │           │            │             │             │          │
│          │            │ muse-spark-1.2-contributor… │           │           │            │             │             │          │
│          │            │ - ox-alpha-free             │           │           │            │             │             │          │
├──────────┼──────────┼───────────────┼───────────┼──────────┼────────────┼─────────────┼──────────┼──────────┤
│ Total    │            │                             │ 303,197,… │ 32,198,… │          0 │ 9,330,894,… │ 9,666,290,… │ $1386.19 │
└──────────┴────────────┴─────────────────────────────┴───────────┴──────────┴────────────┴─────────────┴──────────┘
WARN  Missing pricing for laguna-s-2.1-free; cost excludes this model. Update pricing or run again after LiteLLM has the model.
WARN  Missing pricing for ox-alpha-free; cost excludes this model. Update pricing or run again after LiteLLM has the model.
PS C:\Users\abdelilah.mortaki>

THE SECOND MACHIN PS C:\Users\abdelilah.mortaki>
PS C:\Users\abdelilah.mortaki>
PS C:\Users\abdelilah.mortaki>
PS C:\Users\abdelilah.mortaki>
PS C:\Users\abdelilah.mortaki>
PS C:\Users\abdelilah.mortaki> npx ccusage@latest monthly

╭───────────────────────────────────────────────────╮
│                                                   │
│     Coding (Agent) CLI Usage Report - Monthly     │
│  Detected: Codex, Gemini CLI, OpenCode, pi-agent  │
│                                                   │
╰───────────────────────────────────────────────────╯

┌──────────┬───────────────┬───────────────────────────────────┬──────────────┬─────────────┬───────────────┬────────────────┬────────────────┬─────────────┐
│ Month    │ Agent         │ Models                            │        Input │      Output │  Cache Create │     Cache Read │   Total Tokens │  Cost (USD) │
│          │               │                                   │             │             │               │                │                │             │
├──────────┼───────────────┼───────────────────────────────────┼──────────────┼─────────────┼───────────────┼────────────────┼────────────────┼─────────────┤
│ 2026-05  │ All           │                                   │    9,172,233 │     760,817 │             0 │    104,578,084 │    114,511,134 │     $120.94 │
├──────────┼───────────────┼───────────────────────────────────┼──────────────┼─────────────┼───────────────┼────────────────┼────────────────┼─────────────┤
│          │ - Codex       │ - gpt-5.5                         │    9,162,254 │     760,220 │             0 │    104,572,672 │    114,495,146 │     $120.90 │
├──────────┼───────────────┼───────────────────────────────────┼──────────────┼─────────────┼───────────────┼────────────────┼────────────────┼─────────────┤
│          │ - Gemini CLI  │ - gemini-3.1-pro-preview          │        9,979 │         597 │             0 │          5,412 │         15,988 │       $0.04 │
├──────────┼───────────────┼───────────────────────────────────┼──────────────┼─────────────┼───────────────┼────────────────┼─────────────┤
│ 2026-06  │ All           │                                   │   66,366,953 │   6,913,485 │             0 │  1,324,959,636 │  1,398,240,074 │     $515.05 │
├──────────┼───────────────┼───────────────────────────────────┼──────────────┼─────────────┼───────────────┼────────────────┼─────────────┤
│          │ - Codex       │ - gpt-5.4                         │   53,210,093 │   5,142,031 │             0 │    837,061,376 │    895,413,500 │     $496.05 │
│          │               │ - gpt-5.4-mini                    │              │             │               │                │                │             │
│          │               │ - gpt-5.5                         │              │             │               │                │                │             │
├──────────┼───────────────┼───────────────────────────────────┼──────────────┼─────────────┼───────────────┼────────────────┼────────────────┼─────────────┤
│          │ - OpenCode    │ - deepseek-v4-flash               │   13,156,860 │   1,771,454 │             0 │    487,898,260 │    502,826,574 │      $19.00 │
│          │               │ - deepseek-v4-flash-free          │              │             │               │                │                │             │
│          │               │ - deepseek-v4-pro                 │              │             │               │                │                │             │
│          │               │ - mimo-v2.5-free                  │              │             │               │                │                │             │
│          │               │ - minimax-m3                      │              │             │               │                │                │             │
├──────────┼───────────────┼───────────────────────────────────┼──────────────┼─────────────┼───────────────┼────────────────┼────────────────┼─────────────┤
│ 2026-07  │ All           │                                   │  104,026,745 │   9,579,406 │             0 │  2,360,740,627 │  2,474,346,778 │     $329.02 │
├──────────┼───────────────┼───────────────────────────────────┼───────────────┼─────────────┼───────────────┼────────────────┼────────────────┼─────────────┤
│          │ - Codex       │ - gpt-5.4-mini                    │   49,931,343 │   3,776,798 │             0 │  1,069,986,560 │  1,123,694,701 │     $281.84 │
│          │               │ - gpt-5.5                         │              │             │               │                │                │             │
│          │               │ - gpt-5.6-luna                    │              │             │               │                │                │             │
│          │               │ - gpt-5.6-sol                     │              │             │               │                │                │             │
│          │               │ - gpt-5.6-terra                   │              │             │               │                │                │             │
├──────────┼───────────────┼───────────────────────────────────┼───────────────┼─────────────┼───────────────┼────────────────┼────────────────┼─────────────┤
│          │ - OpenCode    │ - deepseek-v4-flash               │   54,093,230 │   5,802,563 │             0 │  1,290,754,067 │  1,350,649,860 │      $47.18 │
│          │               │ - deepseek-v4-flash-free          │              │             │               │                │                │             │
│          │               │ - deepseek-v4-pro                 │              │             │               │                │                │             │
│          │               │ - gemini-3.6-flash                │              │             │               │                │                │             │
│          │               │ - hy3-free                        │              │             │               │                │                │             │
│          │               │ - kimi-k3                         │              │             │               │                │                │             │
│          │               │ - laguna-s-2.1-free               │              │             │               │                │                │             │
│          │               │ - mimo-v2.5                       │              │             │               │                │                │             │
├──────────┼───────────────┼───────────────────────────────────┼───────────────┼─────────────┼───────────────┼────────────────┼────────────────┼─────────────┤
│          │ - pi-agent    │ - [pi] deepseek-v4-flash          │        2,172 │          45 │             0 │              0 │          2,217 │       $0.00 │
├──────────┼───────────────┼───────────────────────────────────┼───────────────┼─────────────┼───────────────┼────────────────┼────────────────┼─────────────┤
│ 2026-08  │ All           │                                   │  123,631,901 │  14,944,563 │             0 │  5,540,616,452 │  5,679,192,916 │     $421.18 │
├──────────┼───────────────┼───────────────────────────────────┼───────────────┼───────────────┼───────────────┼────────────────┼─────────────┼─────────────┤
│          │ - Codex       │ - gpt-5.6-luna                    │   96,385,495 │  10,984,851 │             0 │    3,978,407,168 │    4,085,777,514 │     $410.64 │
│          │               │ - gpt-5.6-sol                    │              │              │               │                │                 │             │
│          │               │ - gpt-5.6-terra                  │              │              │               │                │                 │             │
├──────────┼───────────────┼───────────────────────────────────┼──────────────┼─────────────┼───────────────┼────────────────┼────────────────┼─────────────┤
│          │ - OpenCode    │ - deepseek-v4-flash               │   27,246,406 │   3,959,712 │             0 │    1,562,209,284 │    1,593,415,402 │      $10.54 │
│          │               │ - deepseek-v4-flash-free          │              │              │               │                │                 │             │
│          │               │ - muse-spark-1.2-contributor-free │              │              │               │                │                 │             │
│          │               │ - ox-alpha-free                   │              │              │               │                │                 │             │
├──────────┼───────────────┼───────────────────────────────────┼───────────────┼───────────────┼───────────────┼───────────────┼───────────────┼─────────────┤
│ Total     │               │                                   │  303,197,832 │   32,198,271 │             0 │    9,330,894,799 │    9,666,290,902 │    $1386.19 │
└──────────┴───────────────┴───────────────────────────────────┴───────────────┴───────────────┴───────────────┴───────────────┘
WARN  Missing pricing for laguna-s-2.1-free; cost excludes this model. Update pricing or run again after LiteLLM has the model.
WARN  Missing pricing for ox-alpha-free; cost excludes this model. Update pricing or run again after LiteLLM has the model.
PS C:\Users\abdelilah.mortaki>
$lost_machine_a$
)
on conflict (id) do update set
  description = excluded.description,
  source_type = excluded.source_type,
  source_machine_count = excluded.source_machine_count,
  suspected_mirror = excluded.suspected_mirror,
  accounting_mode = excluded.accounting_mode,
  confidence = excluded.confidence,
  granularity = excluded.granularity,
  total_input_tokens = excluded.total_input_tokens,
  total_output_tokens = excluded.total_output_tokens,
  total_cache_creation_tokens = excluded.total_cache_creation_tokens,
  total_cache_read_tokens = excluded.total_cache_read_tokens,
  total_tokens = excluded.total_tokens,
  reported_cost_usd = excluded.reported_cost_usd,
  pricing_complete = excluded.pricing_complete,
  warnings = excluded.warnings,
  raw_terminal_text = excluded.raw_terminal_text;

insert into public.recovered_monthly_usage (
  id,
  recovery_set_id,
  month,
  agent,
  input_tokens,
  output_tokens,
  cache_creation_tokens,
  cache_read_tokens,
  total_tokens,
  reported_cost_usd,
  models
)
select
  id,
  'lost-windows-history-2026-05-08',
  month,
  agent,
  input_tokens,
  output_tokens,
  cache_creation_tokens,
  cache_read_tokens,
  total_tokens,
  reported_cost_usd,
  models
from _recovered_monthly_seed_rows
on conflict (recovery_set_id, month, agent) do nothing;

do $$
declare
  v_set_count bigint;
  v_row_count bigint;
  v_mismatched_rows bigint;
  v_total bigint;
  v_source_machine_count integer;
  v_suspected_mirror boolean;
  v_accounting_mode text;
  v_pricing_complete boolean;
begin
  select count(*) into v_set_count
  from public.recovered_usage_sets
  where id = 'lost-windows-history-2026-05-08';

  select count(*) into v_row_count
  from public.recovered_monthly_usage
  where recovery_set_id = 'lost-windows-history-2026-05-08';

  select count(*) into v_mismatched_rows
  from _recovered_monthly_seed_rows seed
  left join public.recovered_monthly_usage stored
    on stored.recovery_set_id = 'lost-windows-history-2026-05-08'
    and stored.id = seed.id
  where stored.id is null
    or stored.month is distinct from seed.month
    or stored.agent is distinct from seed.agent
    or stored.input_tokens is distinct from seed.input_tokens
    or stored.output_tokens is distinct from seed.output_tokens
    or stored.cache_creation_tokens is distinct from seed.cache_creation_tokens
    or stored.cache_read_tokens is distinct from seed.cache_read_tokens
    or stored.total_tokens is distinct from seed.total_tokens
    or stored.reported_cost_usd is distinct from seed.reported_cost_usd
    or stored.models is distinct from seed.models;

  select
    total_tokens,
    source_machine_count,
    suspected_mirror,
    accounting_mode,
    pricing_complete
  into v_total, v_source_machine_count, v_suspected_mirror, v_accounting_mode, v_pricing_complete
  from public.recovered_usage_sets
  where id = 'lost-windows-history-2026-05-08';

  if v_set_count <> 1 or v_row_count <> 13 or v_mismatched_rows <> 0 or v_total <> 9666290902
    or v_source_machine_count <> 1
    or v_suspected_mirror is distinct from false
    or v_accounting_mode <> 'additive_recovered'
    or v_pricing_complete is distinct from false then
    raise exception 'Recovered seed verification failed';
  end if;
end;
$$;

commit;
