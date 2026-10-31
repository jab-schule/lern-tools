-- =====================================================================
-- Lern-Tools: Update für die Hinweis-Funktion (Oktober 2026)
--
-- Nur nötig, wenn setup.sql schon früher ausgeführt wurde.
-- Erlaubt der Lehrkraft, in laufenden eigenen Stunden Hinweise zu senden,
-- und Schülergeräten, diese Hinweise zu empfangen. Schülergeräte können
-- weiterhin nichts senden außer ihrer eigenen Anwesenheit.
-- Das Skript kann gefahrlos mehrfach ausgeführt werden.
-- =====================================================================
drop policy if exists "Schueler lesen Presence laufender Stunden"   on realtime.messages;
drop policy if exists "Schueler melden Presence laufender Stunden"  on realtime.messages;
drop policy if exists "Lehrkraft liest Presence eigener Stunden"   on realtime.messages;
drop policy if exists "Schueler lesen Kanal laufender Stunden"      on realtime.messages;
drop policy if exists "Lehrkraft liest Kanal eigener Stunden"      on realtime.messages;
drop policy if exists "Lehrkraft sendet Hinweise in eigenen Stunden" on realtime.messages;

create policy "Schueler lesen Kanal laufender Stunden"
  on realtime.messages
  for select
  to anon
  using (
    realtime.messages.extension in ('presence', 'broadcast')
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

create policy "Lehrkraft liest Kanal eigener Stunden"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('presence', 'broadcast')
    and public.kanal_eigen((select realtime.topic()))
  );

create policy "Lehrkraft sendet Hinweise in eigenen Stunden"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.kanal_eigen((select realtime.topic()))
    and public.kanal_aktiv((select realtime.topic()))
  );

-- Ende
