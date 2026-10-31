/*
  Klassencode – gemeinsamer Baustein für alle Lern-Tools

  Einbindung in einem Tool:
    <script src="../config.js"></script>
    <script src="../klassencode.js"></script>
    <script>
      Klassencode.start("<tool-kurzname>");
      Klassencode.position("Station 4");          // bei jedem Stationswechsel
      Klassencode.ergebnis("Station 4", true);    // nach jeder Übung: true = richtig, false = falsch
    </script>

  Tools, die ihren Fortschritt selbst speichern, können statt ergebnis() den ganzen Stand melden:
      Klassencode.stand({ "Station 1": { richtig: 4, falsch: 1 }, "Station 2": { richtig: 0, falsch: 2 } });

  Verhalten
  - Steht hinter dem # der Adresse kein gültig aussehender Code, passiert nichts:
    keine Bibliothek wird geladen, kein Kontakt zu Supabase.
  - Mit Code wird die Supabase-Bibliothek aus dem Repository nachgeladen und der Code
    über die Datenbankfunktion code_gueltig geprüft (Ja/Nein).
  - Nur bei gültigem Code meldet sich das Gerät anonym im privaten Kanal "klasse:<CODE>" an.
    Gemeldet werden ausschließlich: Tool-Kurzname, Position, richtig/falsch je Station,
    Zeitpunkt der letzten Aktivität und die Nummer des zuletzt bestätigten Hinweises.
  - Hinweise der Lehrkraft kommen als Broadcast im selben Kanal. Angezeigt werden nur Hinweise
    an dieses Gerät (oder an alle). Der Hinweis bleibt mindestens 5 Sekunden, dann wird OK aktiv.
  - Alle 5 Minuten wird der Code erneut geprüft; nach Ende der Stunde wird die Verbindung getrennt.
  - Es wird nichts im Browser gespeichert und nichts auf dem Server gespeichert.
*/
(function () {
  "use strict";

  var ZEICHEN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
  var PRUEF_INTERVALL_MS = 5 * 60 * 1000;
  var HOECHSTDAUER_MS = 90 * 60 * 1000;
  var HINWEIS_MINDEST_S = 5;
  var MAX_STATIONEN = 40;

  var basis = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? new URL(".", s).href : "../";
  })();

  var tool = null;
  var code = null;
  var client = null;
  var kanal = null;
  var schluessel = null;
  var verbunden = false;
  var pruefTimer = null;
  var endeTimer = null;
  var sendeTimer = null;
  var versuch = 0;
  /* st: { "Station 1": [richtig, falsch], ... }  t: letzte Aktivität (Sekunden seit 1970)  ok: zuletzt bestätigter Hinweis */
  var stand = { position: "", st: {}, t: Math.floor(Date.now() / 1000), ok: "" };
  var pille = null;

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

  function nachDomBereit(fn) {
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  /* ---------- Darstellung: Statuspille und Hinweis ---------- */
  function stil() {
    if (document.getElementById("kc-stil")) return;
    var st = document.createElement("style");
    st.id = "kc-stil";
    st.textContent =
      /* Statuspille unten rechts: grün = verbunden, grau = Prüfung läuft oder Verbindung fehlgeschlagen */
      ".kc-pille{position:fixed;z-index:2147483000;right:max(14px,env(safe-area-inset-right,0px));bottom:max(14px,env(safe-area-inset-bottom,0px));" +
      "width:24px;height:12px;border-radius:999px;background:#8a979c;box-shadow:0 0 0 2px #ffffff,0 1px 4px rgba(0,0,0,.18);pointer-events:none}" +
      ".kc-pille.ok{background:#2f8a52}" +
      /* Hinweis: pulsierender Rahmen + Karte unten */
      ".kc-rahmen{position:fixed;inset:0;z-index:2147483001;border:12px solid #534AB7;pointer-events:none;animation:kc-puls 1.6s ease-in-out infinite}" +
      "@keyframes kc-puls{0%,100%{opacity:1}50%{opacity:.35}}" +
      ".kc-karte{position:fixed;z-index:2147483002;left:50%;transform:translateX(-50%);bottom:max(28px,calc(env(safe-area-inset-bottom,0px) + 20px));" +
      "width:min(640px,calc(100vw - 56px));box-sizing:border-box;background:#EEEDFE;color:#26215C;border-radius:14px;padding:16px 16px 14px;" +
      "box-shadow:0 6px 24px rgba(38,33,92,.22);font:400 17px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;text-align:left}" +
      ".kc-zeile{display:flex;align-items:center;gap:16px}" +
      ".kc-nr{font-size:34px;font-weight:600;line-height:1;color:#534AB7;min-width:44px;text-align:center;font-variant-numeric:tabular-nums}" +
      ".kc-text{flex:1;margin:0;overflow-wrap:anywhere}" +
      ".kc-ok{-webkit-appearance:none;appearance:none;font:600 17px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;min-width:96px;min-height:48px;padding:0 18px;" +
      "border:0;border-radius:10px;background:#534AB7;color:#EEEDFE;cursor:pointer;font-variant-numeric:tabular-nums;touch-action:manipulation}" +
      ".kc-ok:disabled{background:#CECBF6;color:#534AB7;cursor:default}" +
      ".kc-ok:focus-visible{outline:3px solid #26215C;outline-offset:2px}" +
      ".kc-zeit{height:5px;border-radius:3px;background:#CECBF6;margin-top:12px;overflow:hidden}" +
      ".kc-zeit span{display:block;height:100%;width:100%;background:#534AB7;transform-origin:left center}" +
      "@media (prefers-color-scheme:dark){.kc-pille{background:#6f7d83;box-shadow:0 0 0 2px #11171a}.kc-pille.ok{background:#3c9a60}" +
      ".kc-rahmen{border-color:#7F77DD}.kc-karte{background:#26215C;color:#EEEDFE;box-shadow:0 6px 24px rgba(0,0,0,.5)}.kc-nr{color:#AFA9EC}" +
      ".kc-ok{background:#AFA9EC;color:#26215C}.kc-ok:disabled{background:#3C3489;color:#AFA9EC}.kc-ok:focus-visible{outline-color:#EEEDFE}" +
      ".kc-zeit{background:#3C3489}.kc-zeit span{background:#AFA9EC}}" +
      "@media (prefers-reduced-motion:reduce){.kc-rahmen{animation:none}}" +
      "@media (max-width:520px){.kc-zeile{flex-wrap:wrap}.kc-text{flex-basis:calc(100% - 60px)}.kc-ok{margin-left:auto}}" +
      "@media print{.kc-pille,.kc-rahmen,.kc-karte{display:none}}";
    document.head.appendChild(st);
  }

  function zeige(text, art) {
    nachDomBereit(function () {
      stil();
      if (!pille) {
        pille = document.createElement("div");
        pille.setAttribute("role", "status");
        document.body.appendChild(pille);
      }
      pille.className = "kc-pille" + (art === "ok" ? " ok" : "");
      pille.setAttribute("aria-label", "Live-Verbindung: " + text);
      if (art !== "ok" && window.console) console.info("Klassencode:", text);
    });
  }

  function verstecke() {
    if (pille) { pille.remove(); pille = null; }
  }

  /* Hinweis der Lehrkraft. Ein neuer Hinweis ersetzt einen noch angezeigten. */
  var hinweisEl = null;
  function hinweisWeg() {
    if (!hinweisEl) return;
    clearInterval(hinweisEl.timer);
    hinweisEl.rahmen.remove();
    hinweisEl.karte.remove();
    hinweisEl = null;
  }

  function zeigeHinweis(id, text, nr) {
    nachDomBereit(function () {
      stil();
      hinweisWeg();
      var vorherFokus = document.activeElement;
      var rahmen = document.createElement("div");
      rahmen.className = "kc-rahmen";
      var karte = document.createElement("div");
      karte.className = "kc-karte";
      karte.setAttribute("role", "alertdialog");
      karte.setAttribute("aria-label", "Hinweis der Lehrkraft");
      var zeile = document.createElement("div");
      zeile.className = "kc-zeile";
      if (nr) {
        var n = document.createElement("div");
        n.className = "kc-nr";
        n.textContent = String(nr);
        n.setAttribute("aria-label", "Gerät " + nr);
        zeile.appendChild(n);
      }
      var p = document.createElement("p");
      p.className = "kc-text";
      p.setAttribute("role", "alert");
      p.textContent = text;
      zeile.appendChild(p);
      var ok = document.createElement("button");
      ok.type = "button";
      ok.className = "kc-ok";
      ok.disabled = true;
      zeile.appendChild(ok);
      var zeit = document.createElement("div");
      zeit.className = "kc-zeit";
      zeit.setAttribute("aria-hidden", "true");
      var balken = document.createElement("span");
      zeit.appendChild(balken);
      karte.appendChild(zeile);
      karte.appendChild(zeit);
      document.body.appendChild(rahmen);
      document.body.appendChild(karte);

      var beginn = Date.now();
      var gesamt = HINWEIS_MINDEST_S * 1000;
      function takt() {
        var vergangen = Date.now() - beginn;
        var rest = Math.max(0, gesamt - vergangen);
        balken.style.transform = "scaleX(" + (rest / gesamt).toFixed(3) + ")";
        if (rest > 0) {
          ok.textContent = "OK (" + Math.ceil(rest / 1000) + ")";
        } else {
          ok.textContent = "OK";
          ok.disabled = false;
          clearInterval(h.timer);
          try { ok.focus({ preventScroll: true }); } catch (e) { /* ignorieren */ }
        }
      }
      var h = { rahmen: rahmen, karte: karte, timer: setInterval(takt, 100) };
      hinweisEl = h;
      takt();

      ok.addEventListener("click", function () {
        if (ok.disabled) return;
        hinweisWeg();
        stand.ok = id;       /* Bestätigung zählt nicht als Aktivität */
        senden();
        if (vorherFokus && vorherFokus.focus) { try { vorherFokus.focus({ preventScroll: true }); } catch (e) { /* ignorieren */ } }
      });
    });
  }

  function hinweisEmpfangen(nachricht) {
    var d = nachricht && nachricht.payload;
    if (!d || typeof d !== "object") return;
    if (d.an !== "*" && d.an !== schluessel) return;
    if (typeof d.id !== "string" || !/^[a-z0-9]{4,16}$/i.test(d.id)) return;
    if (typeof d.text !== "string" || !d.text.trim()) return;
    var nr = (d.an !== "*" && Number.isInteger(d.nr) && d.nr > 0 && d.nr < 1000) ? d.nr : null;
    zeigeHinweis(d.id, d.text.trim().slice(0, 300), nr);
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

  function zahl(x) { return Math.max(0, Math.min(99999, Math.floor(+x || 0))); }

  function nutzlast() {
    var st = {};
    Object.keys(stand.st).slice(0, MAX_STATIONEN).forEach(function (k) {
      st[k.slice(0, 60)] = [zahl(stand.st[k][0]), zahl(stand.st[k][1])];
    });
    return { tool: tool, position: String(stand.position || "").slice(0, 80), st: st, t: stand.t, ok: stand.ok };
  }

  function aktivitaet() { stand.t = Math.floor(Date.now() / 1000); }

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
    if (text) zeige(text, "fehler");
  }

  function beitreten(c) {
    var meinVersuch = ++versuch;
    schluessel = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);
    /* enabled: true meldet die Anwesenheit; der Broadcast-Empfang ist für die Hinweise der Lehrkraft. */
    kanal = client.channel("klasse:" + c, {
      config: { private: true, presence: { key: schluessel, enabled: true }, broadcast: { self: false } }
    });
    kanal.on("broadcast", { event: "hinweis" }, hinweisEmpfangen);
    kanal.subscribe(function (status, fehler) {
      if (meinVersuch !== versuch) return;
      if (status === "SUBSCRIBED") {
        verbunden = true;
        kanal.track(nutzlast());
        zeige("verbunden", "ok");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        verbunden = false;
        var grund = status === "TIMED_OUT" ? "Zeitüberschreitung" : (fehler && fehler.message ? String(fehler.message).slice(0, 140) : "");
        if (window.console) console.warn("Klassencode: Live-Verbindung gestört", status, fehler);
        zeige("gestört" + (grund ? " (" + grund + ")" : ""), "fehler");
      }
    });
    pruefTimer = setInterval(function () {
      pruefe(c).then(function (gueltig) {
        if (!gueltig) trennen("Stunde beendet");
      }).catch(function () { /* bei Netzproblemen später erneut prüfen */ });
    }, PRUEF_INTERVALL_MS);
    endeTimer = setTimeout(function () {
      trennen("Stunde beendet");
    }, HOECHSTDAUER_MS);
  }

  function verbinde() {
    var c = codeAusAdresse();
    if (c === code && (kanal || !c)) return;
    if (kanal) trennen(null);
    code = c;
    if (!code) { verstecke(); return; }
    if (!konfiguriert()) {
      zeige("nicht eingerichtet (config.js)", "fehler");
      return;
    }
    var meinVersuch = ++versuch;
    zeige("Klassencode wird geprüft", "");
    ladeBibliothek()
      .then(function () { erzeugeClient(); return pruefe(code); })
      .then(function (gueltig) {
        if (meinVersuch !== versuch) return;
        if (gueltig) beitreten(code);
        else zeige("Klassencode ungültig oder abgelaufen", "fehler");
      })
      .catch(function () {
        if (meinVersuch !== versuch) return;
        zeige("keine Verbindung", "fehler");
      });
  }

  function eintrag(station) {
    var k = String(station || "").slice(0, 60);
    if (!k) return null;
    if (!stand.st[k]) {
      if (Object.keys(stand.st).length >= MAX_STATIONEN) return null;
      stand.st[k] = [0, 0];
    }
    return stand.st[k];
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
    /* aktuelle Station oder aktueller Modus */
    position: function (text) {
      var neu = String(text || "").slice(0, 80);
      if (neu !== stand.position) { stand.position = neu; aktivitaet(); }
      senden();
    },
    /* eine bearbeitete Übung zählen: richtig = true oder false */
    ergebnis: function (station, richtig) {
      var e = eintrag(station);
      if (!e) return;
      e[richtig ? 0 : 1]++;
      aktivitaet();
      senden();
    },
    /* den ganzen Stand auf einmal melden: { "Station 1": {richtig: 4, falsch: 1}, ... } */
    stand: function (objekt) {
      if (!objekt || typeof objekt !== "object") return;
      var neu = {};
      Object.keys(objekt).slice(0, MAX_STATIONEN).forEach(function (k) {
        var v = objekt[k] || {};
        neu[String(k).slice(0, 60)] = [zahl(v.richtig), zahl(v.falsch)];
      });
      if (JSON.stringify(neu) !== JSON.stringify(stand.st)) { stand.st = neu; aktivitaet(); }
      senden();
    },
    /* nur zum Anzeigen, z. B. für einen Hinweis im Tool */
    aktiv: function () { return verbunden; }
  };
})();
