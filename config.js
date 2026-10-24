/*
  Verbindung zu Supabase.
  Hier stehen nur die Projektadresse und der ÖFFENTLICHE anon key (Legacy, beginnt mit eyJ).
  Der publishable key (sb_publishable_…) genügt nicht: Die Live-Zählung braucht einen JWT mit der Rolle anon.
  Der service_role key (bzw. secret key) gehört niemals in dieses Repository.
*/
window.LERN_TOOLS_CONFIG = {
  supabaseUrl: "https://ajooqurzqutghjvxdvzn.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqb29xdXJ6cXV0Z2hqdnhkdnpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NTE4MzksImV4cCI6MjEwODQyNzgzOX0.gwzdOo0MyCUwlyixi8iXHV93FcqdZZbrkNhrgQed2Y8"
};
