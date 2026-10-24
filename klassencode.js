/*
  Klassencode – gemeinsamer Baustein für alle Lern-Tools

  Einbindung in einem Tool:
    <script src="../config.js"></script>
    <script src="../klassencode.js"></script>
    <script>
      Klassencode.start("<tool-kurzname>");
      Klassencode.position("Station 4");                        // bei jedem Stationswechsel
      Klassencode.position("Station 4", {richtig: 7, falsch: 2}); // optional mit Zählern
    </script>

  Verhalten
  - Steht hinter dem # der Adresse kein gültig aussehender Code, passiert nichts:
    keine Bibliothek wird geladen, kein Kontakt zu Supabase.
  - Mit Code wird die Supabase-Bibliothek aus dem Repository nachgeladen und der Code
    über die Datenbankfunktion code_gueltig geprüft (Ja/Nein).
  - Nur bei gültigem Code meldet sich das Gerät anonym im privaten Kanal "klasse:<CODE>" an.
    Gemeldet werden ausschließlich Tool-Kurzname, Position und die beiden Zähler.
  - Alle 5 Minuten wird der Code erneut geprüft; nach Ende der Stunde wird die Verbindung getrennt.
  - Es wird nichts im Browser gespeichert und nichts auf dem Server gespeichert.
*/
(function () {
  "use strict";

  var ZEICHEN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
  var PRUEF_INTERVALL_MS = 5 * 60 * 1000;
  var HOECHSTDAUER_MS = 90 * 60 * 1000;

  var basis = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? new URL(".", s).href : "../";
  })();

  var tool = null;
  var code = null;
  var client = null;
  var kanal = null;
  var verbunden = false;
  var pruefTimer = null;
  var endeTimer = null;
  var sendeTimer = null;
  var versuch = 0;
  var stand = { position: "", richtig: null, falsch: null };
  var hinweis = null;

  function konfiguriert() {
    var c = window.LERN_TOOLS_CONFIG;
    return !!(c && c.supabaseUrl && c.supabaseKey &&
      c.supabaseUrl.indexOf("DEIN-PROJEKT") === -1 && c.supabaseKey.indexOf("DEIN-") !== 0);
  }

  function codeAusAdresse() {
    var h = "";
    try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) { h = location.hash.slice(1); }
    h = h.trim().toUpperCase();
    return ZEICHEN.test(h) ? h : null;
  }

  /* ---------- kleiner Statushinweis unten rechts ---------- */
  function stil() {
    if (document.getElementById("kc-stil")) return;
    var st = document.createElement("style");
    st.id = "kc-stil";
    st.textContent =
      ".kc-hinweis{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:max(12px,env(safe-area-inset-bottom,0px));z-index:2147483000;" +
      "font:14px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d2427;background:#ffffff;border:1px solid #cfd6d9;border-radius:999px;" +
      "padding:8px 14px;display:flex;gap:8px;align-items:center;box-shadow:0 2px 10px rgba(0,0,0,.08);max-width:calc(100vw - 24px)}" +
      ".kc-hinweis i{width:8px;height:8px;border-radius:50%;background:#8a979c;flex:none}" +
      ".kc-hinweis.ok i{background:#2c7646}.kc-hinweis.fehler i{background:#ad3a2d}" +
      ".kc-hinweis button{font:inherit;color:inherit;background:none;border:0;padding:4px 2px 4px 8px;margin:-4px 0;cursor:pointer;opacity:.6;min-height:32px}" +
      "@media (prefers-color-scheme:dark){.kc-hinweis{color:#e3e9eb;background:#182125;border-color:#2c383d;box-shadow:none}" +
      ".kc-hinweis.ok i{background:#73c48f}.kc-hinweis.fehler i{background:#e8907f}}" +
      "@media print{.kc-hinweis{display:none}}";
    document.head.appendChild(st);
  }

  function zeige(text, art, schliessbar) {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", function () { zeige(text, art, schliessbar); }, { once: true });
      return;
    }
    stil();
    if (!hinweis) {
      hinweis = document.createElement("div");
      hinweis.setAttribute("role", "status");
      document.body.appendChild(hinweis);
    }
    hinweis.className = "kc-hinweis" + (art ? " " + art : "");
    hinweis.innerHTML = "";
    var punkt = document.createElement("i");
    var t = document.createElement("span");
    t.textContent = text;
    hinweis.appendChild(punkt);
    hinweis.appendChild(t);
    if (schliessbar) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", "Hinweis schließen");
      b.textContent = "×";
      b.onclick = verstecke;
      hinweis.appendChild(b);
    }
  }

  function verstecke() {
    if (hinweis) { hinweis.remove(); hinweis = null; }
  }

  /* ---------- Supabase nur bei Bedarf laden ---------- */
  function ladeBibliothek() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise(function (ok, fehler) {
      var s = document.createElement("script");
      s.src = basis + "vendor/supabase.js";
      s.onload = function () { ok(); };
      s.onerror = function () { fehler(new Error("Bibliothek nicht geladen")); };
      document.head.appendChild(s);
    });
  }

  function erzeugeClient() {
    if (client) return client;
    var c = window.LERN_TOOLS_CONFIG;
    client = window.supabase.createClient(c.supabaseUrl, c.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return client;
  }

  function pruefe(c) {
    return client.rpc("code_gueltig", { p_code: c, p_tool: tool }).then(function (r) {
      if (r.error) throw r.error;
      return r.data === true;
    });
  }

  function nutzlast() {
    var p = { tool: tool, position: String(stand.position || "").slice(0, 80) };
    if (typeof stand.richtig === "number") p.richtig = Math.max(0, Math.floor(stand.richtig));
    if (typeof stand.falsch === "number") p.falsch = Math.max(0, Math.floor(stand.falsch));
    return p;
  }

  function senden() {
    if (!kanal || !verbunden) return;
    clearTimeout(sendeTimer);
    sendeTimer = setTimeout(function () {
      if (kanal && verbunden) kanal.track(nutzlast());
    }, 400);
  }

  function trennen(text) {
    clearInterval(pruefTimer); pruefTimer = null;
    clearTimeout(endeTimer); endeTimer = null;
    clearTimeout(sendeTimer);
    verbunden = false;
    var k = kanal;
    kanal = null;
    if (k && client) {
      try { k.untrack(); } catch (e) { /* ignorieren */ }
      client.removeChannel(k);
    }
    if (text) zeige(text, "", true);
  }

  function beitreten(c) {
    var meinVersuch = ++versuch;
    var schluessel = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);
    kanal = client.channel("klasse:" + c, { config: { private: true, presence: { key: schluessel } } });
    kanal.subscribe(function (status, fehler) {
      if (meinVersuch !== versuch) return;
      if (status === "SUBSCRIBED") {
        verbunden = true;
        kanal.track(nutzlast());
        zeige("Mit der Klasse verbunden (anonym)", "ok", true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        verbunden = false;
        var grund = status === "TIMED_OUT" ? "Zeitüberschreitung" : (fehler && fehler.message ? String(fehler.message).slice(0, 140) : "");
        if (window.console) console.warn("Klassencode: Live-Verbindung gestört", status, fehler);
        zeige("Live-Verbindung gestört. Das Tool funktioniert trotzdem." + (grund ? " (" + grund + ")" : ""), "fehler", true);
      }
    });
    pruefTimer = setInterval(function () {
      pruefe(c).then(function (gueltig) {
        if (!gueltig) trennen("Die Stunde ist beendet. Das Tool funktioniert weiter.");
      }).catch(function () { /* bei Netzproblemen später erneut prüfen */ });
    }, PRUEF_INTERVALL_MS);
    endeTimer = setTimeout(function () {
      trennen("Die Stunde ist beendet. Das Tool funktioniert weiter.");
    }, HOECHSTDAUER_MS);
  }

  function verbinde() {
    var c = codeAusAdresse();
    if (c === code && (kanal || !c)) return;
    if (kanal) trennen(null);
    code = c;
    if (!code) { verstecke(); return; }
    if (!konfiguriert()) {
      zeige("Klassencode erkannt, aber die Live-Zählung ist noch nicht eingerichtet.", "fehler", true);
      return;
    }
    var meinVersuch = ++versuch;
    zeige("Klassencode wird geprüft …", "");
    ladeBibliothek()
      .then(function () { erzeugeClient(); return pruefe(code); })
      .then(function (gueltig) {
        if (meinVersuch !== versuch) return;
        if (gueltig) beitreten(code);
        else zeige("Klassencode ungültig oder abgelaufen. Das Tool funktioniert trotzdem.", "fehler", true);
      })
      .catch(function () {
        if (meinVersuch !== versuch) return;
        zeige("Keine Verbindung zur Klasse. Das Tool funktioniert trotzdem.", "fehler", true);
      });
  }

  window.Klassencode = {
    start: function (kurzname) {
      if (tool) return;
      if (!/^[a-z0-9-]{1,60}$/.test(String(kurzname))) {
        console.warn("Klassencode.start: ungültiger Kurzname", kurzname);
        return;
      }
      tool = kurzname;
      verbinde();
      window.addEventListener("hashchange", verbinde);
      window.addEventListener("pagehide", function () { if (kanal) trennen(null); });
      window.addEventListener("pageshow", function (e) { if (e.persisted) { code = null; verbinde(); } });
    },
    position: function (text, zaehler) {
      stand.position = text;
      if (zaehler && typeof zaehler === "object") {
        if ("richtig" in zaehler) stand.richtig = zaehler.richtig;
        if ("falsch" in zaehler) stand.falsch = zaehler.falsch;
      }
      senden();
    },
    /* nur zum Anzeigen, z. B. für einen Hinweis im Tool */
    aktiv: function () { return verbunden; }
  };
})();
