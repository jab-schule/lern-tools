-- =====================================================================
-- Lern-Tools: Einrichtung der Datenbank (einmalig im SQL Editor ausführen)
--
-- Inhalt
--   1. Tabelle "sitzungen" (eine Zeile pro Unterrichtsstunde mit Klassencode)
--   2. Zugriffsregeln (Row Level Security) für die Tabelle
--   3. Funktionen: stunde_starten, stunde_beenden, code_gueltig
--   4. Zugriffsregeln für die Live-Zählung (Realtime Presence)
--
-- Das Skript kann gefahrlos mehrfach ausgeführt werden.
-- Es speichert keine Daten über Schüler. Fortschritt wird nie gespeichert.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tabelle
-- ---------------------------------------------------------------------
create table if not exists public.sitzungen (
  code         text        primary key
                           check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  tool         text        not null
                           check (tool ~ '^[a-z0-9-]{1,60}$'),
  lehrer_id    uuid        not null default auth.uid()
                           references auth.users (id) on delete cascade,
  gestartet_am timestamptz not null default now(),
  gueltig_bis  timestamptz not null default now() + interval '90 minutes',
  beendet_am   timestamptz
);

create index if not exists sitzungen_lehrer_idx on public.sitzungen (lehrer_id, gueltig_bis desc);


-- ---------------------------------------------------------------------
-- 2. Zugriffsregeln für die Tabelle
--    Schülerseiten (Rolle anon) erhalten überhaupt keinen Tabellenzugriff.
--    Das angemeldete Lehrerkonto sieht nur die eigenen Stunden.
--    Anlegen und Beenden laufen ausschließlich über die Funktionen unten.
-- ---------------------------------------------------------------------
alter table public.sitzungen enable row level security;

revoke all on public.sitzungen from anon, authenticated;
grant select on public.sitzungen to authenticated;

drop policy if exists "Lehrkraft sieht eigene Stunden" on public.sitzungen;
create policy "Lehrkraft sieht eigene Stunden"
  on public.sitzungen
  for select
  to authenticated
  using (lehrer_id = (select auth.uid()));


-- ---------------------------------------------------------------------
-- 3. Funktionen
-- ---------------------------------------------------------------------

-- Stunde starten: beendet eine evtl. noch laufende Stunde der Lehrkraft,
-- erzeugt einen zufälligen Code (6 Zeichen ohne 0, O, 1, I, L) und speichert ihn.
create or replace function public.stunde_starten(p_tool text)
returns table (code text, tool text, gueltig_bis timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_zeichen  constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_bytes    bytea;
  i          int;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  if p_tool is null or p_tool !~ '^[a-z0-9-]{1,60}$' then
    raise exception 'Ungültiger Tool-Kurzname' using errcode = '22023';
  end if;

  update public.sitzungen s
     set beendet_am = now()
   where s.lehrer_id = v_uid
     and s.beendet_am is null
     and s.gueltig_bis > now();

  loop
    -- die ersten 6 Byte einer Zufalls-UUID (v4) sind vollständig zufällig
    v_bytes := substring(pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) from 1 for 6);
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_zeichen, 1 + (get_byte(v_bytes, i) % length(v_zeichen)), 1);
    end loop;
    exit when not exists (select 1 from public.sitzungen s where s.code = v_code);
  end loop;

  insert into public.sitzungen (code, tool, lehrer_id)
  values (v_code, p_tool, v_uid);

  return query
    select s.code, s.tool, s.gueltig_bis
      from public.sitzungen s
     where s.code = v_code;
end;
$$;

-- Stunde beenden: nur die eigene Stunde.
create or replace function public.stunde_beenden(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  update public.sitzungen s
     set beendet_am = now()
   where s.code = upper(p_code)
     and s.lehrer_id = auth.uid()
     and s.beendet_am is null;
end;
$$;

-- Ja/Nein-Prüfung für Schülerseiten: Ist der Code jetzt gültig und gehört er zu diesem Tool?
-- Gibt nichts anderes preis (keine Liste, keine Zeiten, keine Lehrkraft).
create or replace function public.code_gueltig(p_code text, p_tool text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.sitzungen s
     where s.code = upper(p_code)
       and s.tool = p_tool
       and s.beendet_am is null
       and now() < s.gueltig_bis
  );
$$;

-- Hilfsfunktion für die Realtime-Regeln: Ist der Kanalname "klasse:<CODE>" eine laufende Stunde?
create or replace function public.kanal_aktiv(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.sitzungen s
     where 'klasse:' || s.code = p_topic
       and s.beendet_am is null
       and now() < s.gueltig_bis
  );
$$;

-- Hilfsfunktion: Gehört der Kanal zu einer Stunde der angemeldeten Lehrkraft?
create or replace function public.kanal_eigen(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.sitzungen s
     where 'klasse:' || s.code = p_topic
       and s.lehrer_id = auth.uid()
  );
$$;

-- Ausführungsrechte: standardmäßig darf jeder jede Funktion aufrufen; das wird hier eingeschränkt.
revoke execute on function public.stunde_starten(text)      from public, anon;
revoke execute on function public.stunde_beenden(text)      from public, anon;
revoke execute on function public.code_gueltig(text, text)  from public;
revoke execute on function public.kanal_aktiv(text)         from public;
revoke execute on function public.kanal_eigen(text)         from public, anon;

grant execute on function public.stunde_starten(text)      to authenticated;
grant execute on function public.stunde_beenden(text)      to authenticated;
grant execute on function public.code_gueltig(text, text)  to anon, authenticated;
grant execute on function public.kanal_aktiv(text)         to anon, authenticated;
grant execute on function public.kanal_eigen(text)         to authenticated;


-- ---------------------------------------------------------------------
-- 4. Zugriffsregeln für die Live-Zählung (Realtime Presence)
--    Gilt nur für private Kanäle. In den Realtime-Einstellungen muss
--    "Allow public access" ausgeschaltet sein (siehe ANLEITUNG.md),
--    damit ausschließlich private Kanäle zugelassen sind.
--
--    Schülergeräte (anon): dürfen nur dem Kanal einer laufenden Stunde
--    beitreten und dort ihre Anwesenheit melden.
--    Lehrkraft (authenticated): darf die Kanäle ihrer eigenen Stunden lesen.
--    Broadcast-Nachrichten sind für niemanden freigegeben.
-- ---------------------------------------------------------------------
drop policy if exists "Schueler lesen Presence laufender Stunden"   on realtime.messages;
drop policy if exists "Schueler melden Presence laufender Stunden"  on realtime.messages;
drop policy if exists "Lehrkraft liest Presence eigener Stunden"   on realtime.messages;

create policy "Schueler lesen Presence laufender Stunden"
  on realtime.messages
  for select
  to anon
  using (
    realtime.messages.extension = 'presence'
    and public.kanal_aktiv((select realtime.topic()))
  );

create policy "Schueler melden Presence laufender Stunden"
  on realtime.messages
  for insert
  to anon
  with check (
    realtime.messages.extension = 'presence'
    and public.kanal_aktiv((select realtime.topic()))
  );

create policy "Lehrkraft liest Presence eigener Stunden"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and public.kanal_eigen((select realtime.topic()))
  );

-- Ende
