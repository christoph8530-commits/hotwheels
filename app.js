// Hot-Wheels-Sammlung – eigenständige Web-App (Vorlage: Pokémon-App).
// Daten: privates GitHub-Repo (speicher.js). Verzeichnis und Erkennung: erkennung.js (Hot Wheels Wiki + Gemini).
import { Index, bestimme, rueckseite, bildUrl, norm, haken } from "./erkennung.js";
import { GitHubSpeicher, TestSpeicher, PFADE } from "./speicher.js";

// ---------- Grundlagen ----------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const heute = () => new Date().toISOString().slice(0, 10);
const datumText = d => d ? new Date(d + "T12:00:00").toLocaleDateString("de-AT") : "";
const zahl = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = v => v == null || isNaN(v) ? "–" : zahl.format(v) + " €";
const betrag = s => { const n = parseFloat(String(s || "").replace(/\s/g, "").replace("€", "").replace(",", ".")); return isNaN(n) ? null : Math.round(n * 100) / 100; };
const DIESES_JAHR = new Date().getFullYear();
const TEST = new URLSearchParams(location.search).has("test");
const VERSION = "1.15 (20.11.2026)";      // in den Einstellungen sichtbar – hilft beim Prüfen, ob die neue Fassung geladen ist

// Pokémon- und Hot-Wheels-App laufen beide unter christoph8530-commits.github.io und teilen sich damit den Gerätespeicher.
// Darum hat hier jeder Name die Vorsilbe „hw-“ (auch die Zwischenspeicher), sonst überschreiben sich die Apps gegenseitig.
const P = "hw-";
const lies = k => { try { return localStorage.getItem(P + k) || ""; } catch (e) { return ""; } };
const merke = (k, v) => { try { v ? localStorage.setItem(P + k, v) : localStorage.removeItem(P + k); } catch (e) {} };
(function umziehen() {   // einmalig: was Fassung 1.0–1.3 ohne Vorsilbe gespeichert hat, übernehmen und der Pokémon-App zurückgeben
  try {
    if (localStorage.getItem(P + "umgezogen")) return;
    const repo = localStorage.getItem("repo") || "";
    if (/hotwheels/i.test(repo)) { localStorage.setItem(P + "repo", repo); localStorage.removeItem("repo"); }   // Pokémon nimmt wieder ihr Standard-Repo
    for (const k of ["token", "gemini"]) { const v = localStorage.getItem(k); if (v && !localStorage.getItem(P + k)) localStorage.setItem(P + k, v); }
    const sammeln = localStorage.getItem("sammeln");
    if (sammeln) { localStorage.setItem(P + "sammeln", sammeln); localStorage.removeItem("sammeln"); }
    try { if (JSON.parse(localStorage.getItem("stand") || "null")?.SAM) localStorage.removeItem("stand"); } catch (e) {}
    localStorage.removeItem("verzeichnis-geprueft");
    localStorage.setItem(P + "umgezogen", "1");
  } catch (e) {}
})();
const EINST = { repo: lies("repo") || "christoph8530-commits/hotwheelsprivate", token: lies("token"), gemini: lies("gemini") };
// Was gesammelt wird (nur auf diesem Gerät): Jahre, Farbvarianten einzeln, Super Treasure Hunts
const OPT = (() => { const std = { jahre: [], varianten: true, sth: false, sonder: false, box: 30 };
  try { return { ...std, ...JSON.parse(lies("sammeln") || "{}") }; } catch (e) { return std; } })();

let IDX = null;               // Modellverzeichnis
let SAM = [];                 // Einträge der Sammlung (app-daten/sammlung.json)
let speicher = null, schreibbar = false, geladen = false;
const FOTOURL = {};           // Handyfotos: Pfad -> Objekt-URL (werden mit Token geladen)

function toast(text) {
  const t = $("toast"); t.textContent = text; t.hidden = false;
  clearTimeout(toast.zeit); toast.zeit = setTimeout(() => { t.hidden = true; }, 2800);
}
function status(text, art) { $("status-text").textContent = text; $("status").className = "status " + (art || ""); }

// ---------- Sammlung zusammenfassen ----------
// je Modell (oder frei eingetragenem Auto) ein Eintrag mit Anzahl, verpackt/lose und neuestem Foto
let invCache = null;
// Modell zu einem gespeicherten Eintrag. Ändert sich eine Kennung im Verzeichnis (Korrektur im Wiki),
// findet die App das Auto über Toy-Nr. bzw. Name, Jahr und Serie wieder.
const modellCache = new Map();
function modellVon(z) {
  if (!z.modell || !IDX) return null;
  const direkt = IDX.modell(z.modell); if (direkt) return direkt;
  if (!modellCache.has(z.modell)) {
    const n = norm(z.name);
    const kand = (z.toy && IDX.nachToy.get(z.toy)) || IDX.modelle.filter(m => m.n === n && m.jahr === z.jahr);
    const passend = kand.filter(m => !z.serie || IDX.serien[m.s].name === z.serie);
    modellCache.set(z.modell, (passend.length === 1 ? passend[0] : kand.length === 1 ? kand[0] : null));
  }
  return modellCache.get(z.modell);
}
function inventar() {
  if (invCache) return invCache;
  const map = new Map();
  for (const z of SAM) {
    const mz = modellVon(z);
    const key = mz?.id || z.modell || "frei|" + norm(z.name);
    let e = map.get(key);
    if (!e) {
      const m = mz;
      e = { key, m: m || null, name: m?.name || z.name, jahr: m?.jahr ?? z.jahr ?? null, anzahl: 0, verpackt: 0, lose: 0, foto: null, zuletzt: "", eintraege: [] };
      map.set(key, e);
    }
    const n = Number(z.anzahl) || 0;
    e.anzahl += n; e[z.zustand === "lose" ? "lose" : "verpackt"] += n;
    if (z.foto) e.foto = z.foto;
    if ((z.erstellt || "") > e.zuletzt) e.zuletzt = z.erstellt || "";
    e.eintraege.push(z);
  }
  invCache = { liste: [...map.values()].filter(e => e.anzahl > 0), map };
  return invCache;
}
const hat = id => inventar().map.get(id)?.anzahl || 0;

// Zähleinheit für Fortschritt und Fehlliste: jede Farbvariante einzeln oder ein Platz pro Serie
const zaehlt = m => OPT.sth || !(m.marken || []).includes("STH");
// eine Einheit je Farbvariante, sonst je Platz der Serie – bei Sonderserien je Modell (mehrere Mixe teilen sich die Plätze, z. B. Pantone 3× 1/6–6/6)
const einheit = m => OPT.varianten ? m.id : m.x ? `${m.s}|${m.k ?? m.n}` : `${m.s}|${m.snr}`;
// Serien, die für Fortschritt und Fehlliste zählen: Mainline, auf Wunsch auch Premium und Sonderserien
const gezaehlteSerien = jahr => (IDX.serienJahr.get(jahr) || []).filter(s => !s.sonder || OPT.sonder);
function serieStand(si) {
  const alle = IDX.jeSerie[si].filter(zaehlt), einheiten = new Map();
  for (const m of alle) { const k = einheit(m); if (!einheiten.has(k)) einheiten.set(k, []); einheiten.get(k).push(m); }
  let besitz = 0; const fehlt = [];
  for (const l of einheiten.values()) {
    if (l.some(m => hat(m.id))) besitz++;
    else fehlt.push(l.find(m => !m.var) || l[0]);   // Vertreter: Erstfarbe
  }
  return { hat: besitz, gesamt: einheiten.size, fehlt };
}
function meineJahre() {
  if (OPT.jahre.length) return [...OPT.jahre].sort((a, b) => b - a);
  const j = [...new Set(inventar().liste.map(e => e.jahr).filter(x => IDX?.serienJahr.has(x)))].sort((a, b) => b - a);
  return j.length ? j : [DIESES_JAHR];
}

// ---------- Bilder ----------
function fotoUrl(pfad) {
  if (!pfad) return null;
  if (FOTOURL[pfad]) return FOTOURL[pfad] === "laedt" ? null : FOTOURL[pfad];
  FOTOURL[pfad] = "laedt";
  speicher?.fotoLesen(pfad).then(b => { FOTOURL[pfad] = b ? URL.createObjectURL(b) : null; spaeter(); }).catch(() => { FOTOURL[pfad] = null; });
  return null;
}
// Hat eine Ausführung im Wiki kein Foto (oft bei neuen 2. Farben), nehmen wir das einer anderen Ausführung desselben Modells:
// zuerst gleiches Jahr und gleiche Serie, dann gleiches Jahr, dann die neueste
const ersatzCache = new Map();
function ersatz(m) {
  if (!m || m.bild || !IDX) return null;
  if (!ersatzCache.has(m.id)) {
    const l = IDX.ausfuehrungen(m).filter(x => x.bild && x.id !== m.id);
    const rang = x => (x.jahr === m.jahr ? 0 : 2) + (x.s === m.s ? 0 : 1);
    ersatzCache.set(m.id, l.sort((a, b) => rang(a) - rang(b) || b.jahr - a.jahr)[0] || null);
  }
  return ersatzCache.get(m.id);
}
const wikiBild = (m, breite) => m?.bild ? bildUrl(m.bild, breite) : ersatz(m) ? bildUrl(ersatz(m).bild, breite) : null;
const ersatzHinweis = m => !m?.bild && ersatz(m) ? `<span class="ersatz-hinweis">Bild: andere Farbe</span>` : "";
function bildHtml(src, alt = "") {
  return src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" crossorigin="anonymous" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'leerbild'}))">` : `<div class="leerbild"></div>`;
}
let spaeterZeit;
function spaeter() { clearTimeout(spaeterZeit); spaeterZeit = setTimeout(alles, 120); }

// ---------- Wert ----------
// Keine Preisquelle für Hot Wheels: Die App markiert, was sich zu prüfen lohnt, und verlinkt verkaufte Angebote.
const WERTVOLL = /RLC|Red Line Club|Convention|Mail[- ]?In|Collector Edition|Elite 64|Treasure Hunt|Employee|Prototype/i;
const wertvoll = m => !!m && ((m.marken || []).some(k => k === "TH" || k === "STH") || WERTVOLL.test(`${IDX.serien[m.s].name} ${m.exkl || ""} ${m.zusatz || ""}`));
const wertGrund = m => m.marken?.includes("STH") ? "Super Treasure Hunt" : m.marken?.includes("TH") ? "Treasure Hunt"
  : (`${IDX.serien[m.s].name} ${m.exkl || ""} ${m.zusatz || ""}`.match(WERTVOLL) ? IDX.serien[m.s].name : "");
function suchbegriff(m) {   // so, wie Verkäufer Hot Wheels anbieten: Name, bei Besonderem „Super Treasure Hunt“ bzw. die Serie
  const mk = m.marken || [], s = IDX.serien[m.s].name;
  const zusatz = mk.includes("STH") ? "super treasure hunt" : mk.includes("TH") ? "treasure hunt" : m.x ? s.replace(/\s*(Series|Collection)$/i, "") : "";
  return `hot wheels ${m.name.replace(/^'/, "")} ${zusatz}`.replace(/\s+/g, " ").trim();
}
// Die Carz (Marktwerte aus echten Verkäufen): Die Suche dort braucht ein Login und der Katalog soll laut Die Carz
// nicht automatisch abgegrast werden – darum eine Google-Suche nur auf diecarz.com nach Name und Jahr (steht im Seitentitel).
const dieCarz = m => `https://www.google.com/search?q=${encodeURIComponent(`site:diecarz.com ${m.name.replace(/^'/, "")} ${m.jahr}`)}`;
function preisLinks(m) {
  const q = encodeURIComponent(suchbegriff(m)), verkauft = "&LH_Sold=1&LH_Complete=1&_sop=13";
  return `<div class="preislinks"><span class="muted">Wert prüfen (verkaufte Angebote):</span>
    <a class="knopf" href="https://www.ebay.de/sch/i.html?_nkw=${q}${verkauft}" target="_blank" rel="noopener">eBay.de</a>
    <a class="knopf" href="https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?keyword=${q}" target="_blank" rel="noopener">willhaben</a>
    <a class="knopf" href="${dieCarz(m)}" target="_blank" rel="noopener">Die Carz</a></div>`;
}

// ---------- Texte zu einem Modell ----------
const serieVon = m => IDX.serien[m.s];
const VAR_TEXT = m => m.var ? `${m.var}. Farbe${m.vtext ? " · " + m.vtext : ""}` : (m.vtext || "");
function chips(m, e) {
  const c = [];
  const mk = m?.marken || [];
  if (mk.includes("STH")) c.push(`<span class="chip sth">Super TH</span>`);
  else if (mk.includes("TH")) c.push(`<span class="chip th">Treasure Hunt</span>`);
  if (mk.includes("NEU")) c.push(`<span class="chip gelb">Neu</span>`);
  if (m && VAR_TEXT(m)) c.push(`<span class="chip">${esc(VAR_TEXT(m))}</span>`);
  if (m?.exkl) c.push(`<span class="chip">${esc(m.exkl)}</span>`);
  if (m?.x) c.push(`<span class="chip">Sonderserie</span>`);
  if (wertvoll(m) && !mk.some(k => k === "TH" || k === "STH")) c.push(`<span class="chip sth">wertvoll?</span>`);
  if (e?.lose && !e.verpackt) c.push(`<span class="chip">lose</span>`);
  return c.length ? `<span class="chips">${c.join("")}</span>` : "";
}
function metaText(m) {
  const s = serieVon(m);
  return `${m.jahr}${m.nr ? ` · <span class="mono">#${esc(m.nr)}</span>` : ""} · ${esc(s.name)} ${m.snr ? `<span class="mono">${m.snr}/${s.gesamt}</span>` : ""}${m.farbe ? ` · ${esc(m.farbe)}` : ""}`;
}
function kachel(m, e) {   // Modell aus dem Verzeichnis, mit oder ohne Besitz
  const anzahl = e?.anzahl || 0;
  const bild = m.bild ? wikiBild(m) : (e?.foto && fotoUrl(e.foto)) || wikiBild(m);   // Wiki-Produktfoto, sonst eigenes, sonst andere Farbe
  return `<button type="button" class="karte${anzahl ? "" : " fehlt"}" data-modell="${esc(m.id)}">
    <span class="bild">${bildHtml(bild, m.name)}${e?.foto && fotoUrl(e.foto) && !m.bild ? "" : ersatzHinweis(m)}</span>
    ${anzahl > 1 ? `<span class="stueck">×${anzahl}</span>` : ""}${anzahl ? `<span class="marke hat">✓ Hast du</span>` : `<span class="marke">Fehlt</span>`}
    <span class="info"><span class="k-titel">${esc(m.name)}</span><span class="meta">${metaText(m)}</span>${chips(m, e)}</span>
  </button>`;
}
function kachelFrei(e) {
  return `<button type="button" class="karte" data-frei="${esc(e.key)}">
    <span class="bild">${bildHtml(e.foto && fotoUrl(e.foto), e.name)}</span>
    ${e.anzahl > 1 ? `<span class="stueck">×${e.anzahl}</span>` : ""}<span class="marke">Eigener Eintrag</span>
    <span class="info"><span class="k-titel">${esc(e.name)}</span><span class="meta">nicht im Verzeichnis</span>${chips(null, e)}</span>
  </button>`;
}

// ---------- Anzeige ----------
let tab = "sammlung";
function alles() {
  if (!IDX) return;
  invCache = null;
  if ($("s-jahr").value) fuelleSerien();   // Stand der Serien in der Auswahl aktuell halten
  bilanz(); sammlung(); meineAutos(); serien(); fehlliste(); verlauf();
}
function bilanz() {
  const inv = inventar().liste;
  const stueck = inv.reduce((a, e) => a + e.anzahl, 0);
  const jahr = IDX.serienJahr.has(DIESES_JAHR) ? DIESES_JAHR : IDX.jahre.at(-1);
  let jh = 0, jg = 0;
  for (const s of gezaehlteSerien(jahr)) { const st = serieStand(s.i); jh += st.hat; jg += st.gesamt; }
  let komplett = 0, alleSerien = 0;
  for (const j of meineJahre()) for (const s of gezaehlteSerien(j)) { const st = serieStand(s.i); alleSerien++; if (st.gesamt && st.hat === st.gesamt) komplett++; }
  const th = inv.filter(e => e.m?.marken?.includes("TH")).length, sth = inv.filter(e => e.m?.marken?.includes("STH")).length;
  const wv = inv.filter(e => wertvoll(e.m)).length;
  $("bilanz").innerHTML = `
    <div><span class="label">Autos</span><span class="wert">${stueck}</span><small>${inv.length} verschiedene</small></div>
    <div><span class="label">Jahr ${jahr}</span><span class="wert">${jh} / ${jg}</span><small>${OPT.varianten ? "Modelle mit Farbvarianten" : "Modelle"}</small></div>
    <div><span class="label">Serien komplett</span><span class="wert">${komplett} / ${alleSerien}</span><small>in deinen Jahren</small></div>
    <button type="button" id="b-wertvoll" aria-label="Wertvolle Autos anzeigen"><span class="label">Wertvoll ›</span><span class="wert">${wv}</span><small>${wv ? `${th} TH · ${sth} Super TH${wv - th - sth > 0 ? ` · ${wv - th - sth} weitere` : ""}` : "antippen: welche fehlen"}</small></button>`;
  $("b-wertvoll").onclick = () => {   // eigene wertvolle zeigen – oder, solange es keine gibt, die fehlenden der eigenen Jahre
    $("suche").value = ""; $("s-wertvoll").checked = true; $("s-doppelt").checked = false;
    $("s-fehlend").checked = !wv; $("s-jahr").value = ""; fuelleSerien(); $("s-sort").value = "nr";
    alles(); zeigeTab("sammlung"); $("panel-sammlung").scrollIntoView({ block: "start" });
  };
}

const nrZahl = m => parseInt(m?.nr, 10) || 999;
function sammlung() {
  const suche = $("suche").value.trim();
  const jahr = Number($("s-jahr").value) || null, serie = $("s-serie").value, sort = $("s-sort").value;
  const doppelt = $("s-doppelt").checked, nurWert = $("s-wertvoll").checked;
  const mitFehl = $("s-fehlend").checked && !doppelt && (jahr || serie !== "" || nurWert);
  const { liste: inv, map } = inventar();
  let html = "", text = "";
  if (suche.length >= 2) {
    // Suche im ganzen Verzeichnis: sofort sehen, ob du ein Modell schon hast
    const treffer = IDX.suche(suche, nurWert ? 50000 : 240).filter(m => (!jahr || m.jahr === jahr) && (serie === "" || m.s === Number(serie)) && (!nurWert || wertvoll(m)));
    treffer.splice(240);
    const freie = inv.filter(e => !e.m && norm(e.name).includes(norm(suche)));
    treffer.sort((a, b) => (hat(b.id) ? 1 : 0) - (hat(a.id) ? 1 : 0));
    const anzahlHat = treffer.filter(m => hat(m.id)).length + freie.length;
    text = `${treffer.length + freie.length} Treffer · ${anzahlHat} hast du`;
    html = freie.map(kachelFrei).join("") + treffer.map(m => kachel(m, map.get(m.id))).join("");
  } else {
    let liste = inv.filter(e => (!jahr || e.jahr === jahr) && (serie === "" || e.m?.s === Number(serie)) && (!doppelt || e.anzahl > 1) && (!nurWert || wertvoll(e.m)));
    const eigene = liste.length;
    let fehlt = [];
    let bereich = "";
    if (mitFehl && nurWert) {
      // wertvolle, die fehlen: jede Ausführung einzeln, auch aus Sonderserien (RLC, Conventions, Mail-ins …)
      const jahre = jahr ? [jahr] : meineJahre();
      if (!jahr && serie === "") bereich = ` in ${jahre.join(", ")}`;
      const serienListe = serie !== "" ? [Number(serie)] : jahre.flatMap(j => (IDX.serienJahr.get(j) || []).map(s => s.i));
      fehlt = serienListe.flatMap(si => IDX.jeSerie[si]).filter(m => wertvoll(m) && !hat(m.id));
    } else if (mitFehl) {
      const serienListe = serie !== "" ? [Number(serie)] : gezaehlteSerien(jahr).map(s => s.i);
      fehlt = serienListe.flatMap(si => serieStand(si).fehlt);
    }
    const sortierer = {
      nr: (a, b) => (b.jahr || 0) - (a.jahr || 0) || nrZahl(a.m) - nrZahl(b.m) || (a.m?.var || 1) - (b.m?.var || 1),
      name: (a, b) => a.name.localeCompare(b.name, "de"),
      neu: (a, b) => (b.zuletzt || "").localeCompare(a.zuletzt || ""),
    };
    const alle = [...liste, ...fehlt.map(m => ({ key: m.id, m, name: m.name, jahr: m.jahr, anzahl: 0, zuletzt: "" }))].sort(sortierer[sort] || sortierer.nr);
    text = `${eigene} Modelle` + (mitFehl ? ` · ${fehlt.length} fehlen${bereich}` : "");
    html = alle.map(e => e.m ? kachel(e.m, e.anzahl ? e : null) : kachelFrei(e)).join("");
    if (!inv.length && !mitFehl && geladen)
      html = `<div class="willkommen"><strong>Noch keine Autos erfasst.</strong><span>Tippe unten rechts auf „＋ Auto“, fotografiere ein Auto oder such es nach Name. Mit „Prüfen“ siehst du, ob du ein Auto schon hast, ohne es zu speichern.</span></div>`;
  }
  $("s-treffer").textContent = text;
  $("s-raster").innerHTML = html || `<div class="leer">${nurWert && !mitFehl && suche.length < 2
    ? "Du hast noch kein potenziell wertvolles Auto. Hak „Fehlende zeigen“ an, dann siehst du, welche es in deinen Jahren gibt."
    : "Kein Auto passt zu diesen Filtern."}</div>`;
}

// ---------- Box-Plan ----------
// Aufbewahrung in Boxen (z. B. IKEA Samla): Mainline-Jahre mit genug Autos (oder die angehakten Jahre) bekommen eigene Boxen,
// sortiert nach Serie (erste Sammler-Nr.) und Sammler-Nr.; der Rest kommt in „Sonderserien & Ältere“ – Premium hinten,
// große Packungen liegend oben drauf. Ist eine Box voll, wird an einer Seriengrenze geteilt.
const PREMIUM = /Boulevard|Car Culture|Premium|Pop Culture|Team Transport|Fast & Furious Premium|Elite 64|RLC/i;
const PACKUNG = /\d+-Pack|Pack$|Set$|Multipack|Gift Pack/i;
const stueckVon = l => l.reduce((a, e) => a + e.anzahl, 0);
function boxPlan() {
  const inv = inventar().liste, gross = OPT.box || 30;
  const mainlineJahr = e => e.m && !e.m.x ? e.m.jahr : null;
  const proJahr = {};
  for (const e of inv) { const j = mainlineJahr(e); if (j) proJahr[j] = (proJahr[j] || 0) + e.anzahl; }
  const eigeneJahre = Object.keys(proJahr).map(Number).filter(j => OPT.jahre.includes(j) || proJahr[j] >= Math.ceil(gross / 2)).sort((a, b) => b - a);
  const boxen = [], ort = new Map();
  const sortNr = (a, b) => nrZahl(a.m) - nrZahl(b.m) || (a.m?.snr || 0) - (b.m?.snr || 0) || (a.m?.var || 1) - (b.m?.var || 1);
  // Fächer (Trennkarten) auf Boxen verteilen, ohne eine Serie zu zerreißen (außer sie allein ist größer als eine Box)
  const verteile = (titel, faecher, bereich) => {
    let box = null, teil = 1;
    const neueBox = () => { box = { titel, faecher: [], stueck: 0 }; boxen.push(box); };
    for (const f of faecher) {
      const n = stueckVon(f.autos);
      if (!box || (box.stueck + n > gross && box.stueck > 0 && !f.oben)) neueBox();
      box.faecher.push(f); box.stueck += n;
    }
    const meine = boxen.slice(boxen.length - (boxen.filter(b => b.titel === titel).length));
    meine.forEach((b, i) => { if (meine.length > 1) b.titel = `${titel} (${i + 1}/${meine.length})`; if (bereich) b.bereich = bereich(b); });
  };
  for (const j of eigeneJahre) {
    const autos = inv.filter(e => mainlineJahr(e) === j), serien = new Map();
    for (const e of autos) { if (!serien.has(e.m.s)) serien.set(e.m.s, []); serien.get(e.m.s).push(e); }
    const faecher = [...serien].sort((a, b) => IDX.serien[a[0]].ab - IDX.serien[b[0]].ab)
      .map(([si, l]) => ({ name: IDX.serien[si].name, autos: l.sort(sortNr) }));
    verteile(`${j} Mainline`, faecher, b => { const nr = b.faecher.flatMap(f => f.autos.map(e => nrZahl(e.m))).filter(n => n < 999); return nr.length ? `#${String(Math.min(...nr)).padStart(3, "0")}–#${String(Math.max(...nr)).padStart(3, "0")}` : ""; });
  }
  const rest = inv.filter(e => !eigeneJahre.includes(mainlineJahr(e)));
  if (rest.length) {
    const gruppen = new Map();   // Fach-Schlüssel → {name, autos, art}
    for (const e of rest) {
      const s = e.m && IDX.serien[e.m.s];
      const art = !e.m ? 3 : PACKUNG.test(s.name) ? 4 : PREMIUM.test(s.name) ? 2 : e.m.x ? 0 : 1;   // 0 Sonderserien, 1 ältere Mainline, 2 Premium, 3 eigene, 4 Packungen
      const k = art === 1 ? `j${e.m.jahr}` : art === 3 ? "frei" : art === 4 ? "pack" : `s${e.m.s}`;
      const name = art === 1 ? `${e.m.jahr} Mainline` : art === 3 ? "Eigene Einträge" : art === 4 ? "Packungen – liegend oben drauf" : `${s.name} ${e.m.jahr}`;
      if (!gruppen.has(k)) gruppen.set(k, { name, autos: [], art, jahr: e.m?.jahr || 0, oben: art === 4 });
      gruppen.get(k).autos.push(e);
    }
    const faecher = [...gruppen.values()].sort((a, b) => a.art - b.art || b.jahr - a.jahr || a.name.localeCompare(b.name));
    faecher.forEach(f => f.autos.sort(sortNr));   // ältere Mainline ohne eigene Box: einfach nach Sammler-Nr.
    verteile("Sonderserien & Ältere", faecher);
  }
  boxen.forEach((b, i) => { b.nr = i + 1; b.titel = `Box ${i + 1} · ${b.titel}`; for (const f of b.faecher) for (const e of f.autos) ort.set(e.key, { box: b, fach: f }); });
  return { boxen, ort, gross };
}
function lagerortHtml(key) {
  const o = boxPlan().ort.get(key);
  return o ? `<div class="lagerort">📦 <strong>${esc(o.box.titel)}</strong> · Trennkarte <strong>${esc(o.fach.name)}</strong></div>` : "";
}
function zeigeBoxPlan() {
  const { boxen, gross } = boxPlan();
  $("bx-info").textContent = `${boxen.length} ${boxen.length === 1 ? "Box" : "Boxen"} à ca. ${gross} Autos (änderbar in den Einstellungen). Karten stehend auf der langen Kante, jede zweite umdrehen. Auto antippen: Details.`;
  $("bx-boxen").innerHTML = boxen.map(b => `<section class="box"><header><h3>📦 ${esc(b.titel)}</h3><span class="muted">${b.bereich ? esc(b.bereich) + " · " : ""}${b.stueck} / ${gross}</span></header>
    ${b.faecher.map(f => `<div class="fach"><span class="fach-name">${esc(f.name)} <span class="muted">· ${stueckVon(f.autos)}</span></span>
      ${f.autos.map(e => `<button type="button" class="auto" ${e.m ? `data-modell="${esc(e.m.id)}"` : `data-frei="${esc(e.key)}"`}>${e.m?.nr ? `<span class="mono">#${esc(e.m.nr)}</span> ` : e.m?.snr ? `<span class="mono">${e.m.snr}/${IDX.serien[e.m.s].gesamt}</span> ` : ""}${esc(e.name)}${e.m?.farbe ? ` <span class="muted">· ${esc(e.m.farbe)}</span>` : ""}${e.anzahl > 1 ? ` ×${e.anzahl}` : ""}${e.lose && !e.verpackt ? " <span class=\"muted\">· lose</span>" : ""}</button>`).join("")}</div>`).join("")}</section>`).join("")
    || `<div class="leer">Noch keine Autos erfasst.</div>`;
  if (!$("dlg-box").open) $("dlg-box").showModal();
}
$("box-knopf").addEventListener("click", zeigeBoxPlan);
$("bx-boxen").addEventListener("click", e => { const b = e.target.closest("[data-modell],[data-frei]"); if (!b) return; $("dlg-box").close(); });

// Alle eigenen Autos, unabhängig von Suche und Filtern: nach Jahr (neueste zuerst) und Serie gruppiert
function meineAutos() {
  const inv = inventar().liste, wahl = $("m-jahr").value;
  const jahre = [...new Set(inv.map(e => e.jahr ?? 0))].sort((a, b) => b - a);
  $("m-jahr").innerHTML = `<option value="">Alle Jahre</option>` + jahre.map(j => `<option value="${j}">${j || "ohne Jahr"}</option>`).join("");
  $("m-jahr").value = jahre.map(String).includes(wahl) ? wahl : "";
  const liste = inv.filter(e => !$("m-jahr").value || String(e.jahr ?? 0) === $("m-jahr").value);
  $("m-treffer").textContent = `${liste.reduce((a, e) => a + e.anzahl, 0)} Autos · ${liste.length} verschiedene`;
  if (!liste.length) { $("m-liste").innerHTML = `<div class="leer">Noch keine Autos erfasst.</div>`; return; }
  const html = jahre.filter(j => liste.some(e => (e.jahr ?? 0) === j)).map(j => {
    const imJahr = liste.filter(e => (e.jahr ?? 0) === j);
    const gruppen = new Map();   // Serie → Autos; frei Eingetragene unter „Eigene Einträge“
    for (const e of imJahr) { const k = e.m ? e.m.s : "frei"; if (!gruppen.has(k)) gruppen.set(k, []); gruppen.get(k).push(e); }
    const reihe = [...gruppen.keys()].sort((a, b) => a === "frei" ? 1 : b === "frei" ? -1
      : (IDX.serien[a].sonder ? 1 : 0) - (IDX.serien[b].sonder ? 1 : 0) || IDX.serien[a].ab - IDX.serien[b].ab || IDX.serien[a].name.localeCompare(IDX.serien[b].name));
    return `<section class="m-jahr"><h2>${j || "Ohne Jahr"} <span class="muted" style="font-weight:400;font-size:1rem">· ${imJahr.reduce((a, e) => a + e.anzahl, 0)} Autos</span></h2>` +
      reihe.map(k => {
        const autos = gruppen.get(k).sort((a, b) => (a.m?.snr || 0) - (b.m?.snr || 0) || nrZahl(a.m) - nrZahl(b.m) || (a.m?.var || 1) - (b.m?.var || 1));
        if (k === "frei") return `<div class="m-serie"><div class="m-kopf"><h3>Eigene Einträge</h3><span class="num">${autos.length}</span></div><div class="raster">${autos.map(kachelFrei).join("")}</div></div>`;
        const s = IDX.serien[k], st = serieStand(k);
        return `<div class="m-serie"><button type="button" class="m-kopf" data-serie-liste="${k}"><h3>${esc(s.name)}${s.sonder ? ` <span class="chip">Sonderserie</span>` : ""}</h3>
          <span class="num">${st.hat} / ${st.gesamt}${st.gesamt && st.hat === st.gesamt ? " ✓" : ""} ›</span></button>
          <div class="raster">${autos.map(e => kachel(e.m, e)).join("")}</div></div>`;
      }).join("") + `</section>`;
  }).join("");
  $("m-liste").innerHTML = html;
}
$("m-jahr").addEventListener("input", meineAutos);
$("m-liste").addEventListener("click", e => {   // Serienkopf antippen: Checkliste der Serie in der Sammlung
  const b = e.target.closest("[data-serie-liste]"); if (!b) return;
  const s = IDX.serien[Number(b.dataset.serieListe)];
  $("suche").value = ""; $("s-jahr").value = String(s.jahr); fuelleSerien(); $("s-serie").value = String(s.i);
  $("s-doppelt").checked = false; $("s-wertvoll").checked = false; $("s-fehlend").checked = true; $("s-sort").value = "nr";
  alles(); zeigeTab("sammlung");
});

// Serien eines Jahres mit Fortschritt
let serienJahr = null, serienJahrVonHand = false;   // ohne eigene Wahl: das neueste deiner Jahre
function serien() {
  const jahre = meineJahre();
  if (!serienJahrVonHand || !IDX.serienJahr.has(serienJahr)) serienJahr = jahre[0];
  const weitere = IDX.jahre.filter(j => !jahre.includes(j)).sort((a, b) => b - a);
  $("r-jahre").innerHTML = jahre.map(j => `<button type="button" class="chip-knopf" data-jahr="${j}" aria-pressed="${j === serienJahr}">${j}</button>`).join("") +
    `<select id="r-anderes" aria-label="Anderes Jahr"><option value="">Anderes Jahr …</option>${weitere.map(j => `<option value="${j}"${j === serienJahr ? " selected" : ""}>${j}</option>`).join("")}</select>`;
  $("r-anderes").onchange = e => { if (e.target.value) { serienJahr = Number(e.target.value); serienJahrVonHand = true; serien(); } };
  const liste = gezaehlteSerien(serienJahr);
  // nicht gezählte Premium- und Sonderserien des Jahres (bei „mitzählen“ stecken sie schon in liste)
  const sonder = OPT.sonder ? [] : (IDX.serienJahr.get(serienJahr) || []).filter(s => s.sonder).sort((a, b) => a.name.localeCompare(b.name));
  let h = 0, g = 0, k = 0;
  const karte = (s, st) => {
    const voll = st.gesamt && st.hat === st.gesamt;
    return `<button type="button" class="setkarte${voll ? " komplett" : ""}" data-serie="${s.i}"><span><strong>${esc(s.name)}</strong>${s.ab < 999 ? ` <span class="muted">· ab #${String(s.ab).padStart(3, "0")}</span>` : ""}${s.sonder ? ` <span class="chip">Sonderserie</span>` : ""}</span>
      <span class="num">${st.hat} / ${st.gesamt}</span>
      <span class="voll"><span class="balken"><span style="width:${st.gesamt ? st.hat / st.gesamt * 100 : 0}%"></span></span><span>${voll ? "komplett ✓" : `${st.gesamt - st.hat} fehlen`}</span></span></button>`;
  };
  // Gruppen: alle Serien mit eigenen Autos oben (Mainline und Sonderserien, meiste Autos zuerst),
  // dann komplette, dann Mainline-Serien ohne Autos; Sonderserien ohne Autos nur auf Wunsch
  const gruppen = { angefangen: [], komplett: [], keine: [] };
  for (const s of liste) {
    const st = serieStand(s.i); h += st.hat; g += st.gesamt;
    const voll = st.gesamt && st.hat === st.gesamt; if (voll) k++;
    gruppen[voll ? "komplett" : hatAutos(s) ? "angefangen" : "keine"].push({ s, st });
  }
  for (const s of sonder.filter(hatAutos)) {
    const st = serieStand(s.i);
    gruppen[st.gesamt && st.hat === st.gesamt ? "komplett" : "angefangen"].push({ s, st });
  }
  gruppen.angefangen.sort((a, b) => b.st.hat / b.st.gesamt - a.st.hat / a.st.gesamt || b.st.hat - a.st.hat);
  const nurMeine = $("r-meine").checked;
  const abschnitt = (titel, l) => l.length ? `<h3 class="r-gruppe">${titel} <span class="muted">· ${l.length}</span></h3>${l.map(x => karte(x.s, x.st)).join("")}` : "";
  $("r-serien").innerHTML = abschnitt("Angefangen", gruppen.angefangen) + abschnitt("Komplett", gruppen.komplett)
    + (nurMeine ? "" : abschnitt("Noch keine Autos", gruppen.keine))
    || `<div class="leer">${nurMeine ? `Aus ${serienJahr} hast du noch keine Serie angefangen. Schalte „Nur meine Serien“ aus, um alle zu sehen.` : `Für ${serienJahr} gibt es keine Serien im Verzeichnis.`}</div>`;
  $("r-info").textContent = `${serienJahr}: ${h} von ${g} ${OPT.varianten ? "Modellen inkl. Farbvarianten" : "Modellen"}, ${k} von ${liste.length} ${OPT.sonder ? "Serien" : "Mainline-Serien"} komplett. Tippe auf eine Serie für die Checkliste.`;
  // weitere Premium- und Sonderserien ohne eigene Autos: zusammengeklappt
  const ohne = sonder.filter(s => !hatAutos(s));
  $("r-weitere").hidden = !ohne.length || nurMeine;
  $("r-weitere").innerHTML = ohne.length && !nurMeine ? `<h3 class="r-gruppe">Weitere Premium- und Sonderserien <span class="muted">· ${ohne.length}</span></h3>
    <p class="muted">Zählen nicht zum Fortschritt (umstellbar in den Einstellungen).</p>
    ${alleSonder ? `<div class="setliste">${ohne.map(s => karte(s, serieStand(s.i))).join("")}</div>` : ""}
    <button type="button" class="knopf" id="r-alle" style="justify-self:start">${alleSonder ? "Wieder zuklappen" : `Alle ${ohne.length} anzeigen`}</button>` : "";
  if (ohne.length && !nurMeine) $("r-alle").onclick = () => { alleSonder = !alleSonder; serien(); };
}
let alleSonder = false;
const hatAutos = s => IDX.jeSerie[s.i].some(m => hat(m.id));   // mindestens ein Auto der Serie (auch ein nicht gezähltes, z. B. Super TH)
$("r-meine").checked = lies("nur-meine") === "1";
$("r-meine").addEventListener("change", e => { merke("nur-meine", e.target.checked ? "1" : ""); serien(); });
$("r-jahre").addEventListener("click", e => { const b = e.target.closest("[data-jahr]"); if (b) { serienJahr = Number(b.dataset.jahr); serienJahrVonHand = true; serien(); } });
["r-serien", "r-weitere"].forEach(id => $(id).addEventListener("click", e => {   // Serie antippen: in der Sammlung als Checkliste zeigen
  const b = e.target.closest("[data-serie]"); if (!b) return;
  const s = IDX.serien[Number(b.dataset.serie)];
  $("suche").value = ""; $("s-jahr").value = String(s.jahr); fuelleSerien(); $("s-serie").value = String(s.i);
  $("s-doppelt").checked = false; $("s-fehlend").checked = true; $("s-sort").value = "nr";
  alles(); zeigeTab("sammlung");
}));

function fehlliste() {
  const jahre = meineJahre(), wahl = $("f-jahr").value;
  $("f-jahr").innerHTML = `<option value="">Alle deine Jahre (${jahre.join(", ")})</option>` + jahre.map(j => `<option value="${j}">${j}</option>`).join("");
  $("f-jahr").value = jahre.includes(Number(wahl)) ? wahl : "";
  // Suchwörter müssen alle vorkommen: Name, Serie, Jahr, Sammler- oder Toy-Nr.
  const woerter = norm($("suche").value).split(" ").filter(Boolean);
  const passt = (m, s) => { const t = `${m.n} ${norm(s.name)} ${m.jahr} ${m.nr} ${Number(m.nr)} ${(m.toy || "").toLowerCase()}`; return woerter.every(w => t.includes(w)); };
  let gesamt = 0;
  const html = (wahl ? [Number(wahl)] : jahre).map(j => {
    const teile = gezaehlteSerien(j).map(s => {
      const fehlt = serieStand(s.i).fehlt.filter(m => passt(m, s));
      if (!fehlt.length) return "";
      gesamt += fehlt.length;
      return `<li style="display:block;padding:8px 12px;background:var(--bg)"><strong>${esc(s.name)}</strong> <span class="muted">· ${fehlt.length} fehlen</span></li>` +
        fehlt.map(m => `<li><span class="streifen" style="background:${m.marken?.includes("STH") ? "var(--gold)" : m.marken?.includes("TH") ? "var(--gruen)" : "var(--accent)"}"></span>${bildHtml(wikiBild(m, 160), m.name)}
          <span class="name" data-modell="${esc(m.id)}" style="cursor:pointer">${esc(m.name)}<span class="unter">${m.nr ? `<span class="mono">#${esc(m.nr)}</span> · ` : ""}${m.snr}/${serieVon(m).gesamt}${m.toy ? ` · <span class="mono">${esc(m.toy)}</span>` : ""}${VAR_TEXT(m) ? " · " + esc(VAR_TEXT(m)) : ""}${m.exkl ? " · " + esc(m.exkl) : ""}${m.marken?.includes("STH") ? " · Super TH" : m.marken?.includes("TH") ? " · Treasure Hunt" : ""}</span></span>
          <span class="rechts">${schreibbar ? `<button type="button" class="knopf" data-kaufen="${esc(m.id)}">Gekauft</button>` : ""}</span></li>`).join("");
    }).join("");
    return teile ? `<section style="display:grid;gap:8px"><h2>${j}</h2><ol class="liste">${teile}</ol></section>` : "";
  }).join("");
  $("f-treffer").textContent = `${gesamt} fehlen`;
  $("f-listen").innerHTML = html || `<div class="leer">Nichts mehr offen – alles komplett!</div>`;
}

function verlauf() {
  const eintraege = [...SAM].sort((a, b) => (b.erstellt || "").localeCompare(a.erstellt || ""));
  const stueck = SAM.reduce((a, z) => a + (Number(z.anzahl) || 0), 0);
  const monat = heute().slice(0, 7), diesenMonat = SAM.filter(z => (z.datum || "").startsWith(monat)).reduce((a, z) => a + (Number(z.anzahl) || 0), 0);
  const verpackt = SAM.filter(z => z.zustand !== "lose").reduce((a, z) => a + (Number(z.anzahl) || 0), 0);
  const mitPreis = SAM.filter(z => z.bezahlt != null), ausgegeben = mitPreis.reduce((a, z) => a + Number(z.bezahlt), 0);
  const imMonat = mitPreis.filter(z => (z.datum || "").startsWith(monat)).reduce((a, z) => a + Number(z.bezahlt), 0);
  $("h-summen").innerHTML = `
    <div><span class="muted">Erfasst</span><span class="wert">${stueck}</span><small class="muted">Autos in ${SAM.length} Einträgen, ${verpackt} verpackt</small></div>
    <div><span class="muted">Diesen Monat</span><span class="wert">${diesenMonat}</span><small class="muted">neu dazugekommen${imMonat ? ", " + eur(imMonat) : ""}</small></div>
    <div><span class="muted">Ausgegeben</span><span class="wert">${eur(ausgegeben)}</span><small class="muted">${mitPreis.length ? `${mitPreis.length} Einträge mit Preis` : "Preis beim Hinzufügen eintragen"}</small></div>`;
  $("h-liste").innerHTML = eintraege.length ? eintraege.map(z => {
    const m = modellVon(z);
    return `<li><span class="streifen" style="background:var(--gruen)"></span>${bildHtml(wikiBild(m, 160) || (z.foto && fotoUrl(z.foto)), z.name)}
      <span class="name"${m ? ` data-modell="${esc(m.id)}" style="cursor:pointer"` : ""}>${esc(z.name)} ${Number(z.anzahl) > 1 ? `×${z.anzahl}` : ""}
        <span class="unter">${m ? `${m.jahr}${m.nr ? " · #" + esc(m.nr) : ""} · ${esc(serieVon(m).name)}` : "eigener Eintrag"} · ${z.zustand === "lose" ? "lose" : "verpackt"} · ${datumText(z.datum)} · ${esc(z.herkunft || "")}${z.notiz ? " · " + esc(z.notiz) : ""}</span></span>
      <span class="rechts">${z.bezahlt != null ? eur(z.bezahlt) : ""}${schreibbar ? `<button type="button" class="knopf gefahr" data-loeschen="${esc(z.id)}">Löschen</button>` : ""}</span></li>`;
  }).join("") : `<li style="display:block;padding:14px"><span class="muted">Noch keine Einträge. Neue Autos erfasst du mit „＋ Auto“ unten rechts.</span></li>`;
}

// ---------- Tabs, Filter ----------
function zeigeTab(name) {
  if (!["sammlung", "meine", "serien", "fehlliste", "verlauf"].includes(name)) name = "sammlung";
  tab = name;
  document.querySelectorAll("[data-tab]").forEach(b => { b.setAttribute("aria-selected", b.dataset.tab === name); b.tabIndex = b.dataset.tab === name ? 0 : -1; });
  document.querySelectorAll(".panel").forEach(p => { p.hidden = p.id !== "panel-" + name; });
  if (location.hash.slice(1) !== name) history.replaceState(null, "", location.search + "#" + name);
  const p = $("panel-" + name); if (p.getBoundingClientRect().top < 0) p.scrollIntoView();
}
document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) zeigeTab(b.dataset.tab); });
let suchZeit;
$("suche").addEventListener("input", () => {
  if (!["sammlung", "fehlliste"].includes(tab)) zeigeTab("sammlung");
  clearTimeout(suchZeit); suchZeit = setTimeout(alles, 150);
});
function fuelleJahre() {
  const wahl = $("s-jahr").value;
  $("s-jahr").innerHTML = `<option value="">Alle Jahre</option>` + [...IDX.jahre].reverse().map(j => `<option value="${j}">${j}</option>`).join("");
  $("s-jahr").value = wahl;
}
function fuelleSerien() {
  const jahr = Number($("s-jahr").value), wahl = $("s-serie").value;
  const alle = jahr ? IDX.serienJahr.get(jahr) || [] : [];
  const opt = s => { const st = hatAutos(s) ? serieStand(s.i) : null;
    return `<option value="${s.i}">${st ? "✓ " : ""}${esc(s.name)}${st ? ` · ${st.hat}/${st.gesamt}` : ""}</option>`; };
  const meine = alle.filter(hatAutos), andere = alle.filter(s => !hatAutos(s));
  const sonder = andere.filter(s => s.sonder).sort((a, b) => a.name.localeCompare(b.name));
  $("s-serie").innerHTML = `<option value="">Alle Serien</option>` +
    (meine.length ? `<optgroup label="Meine Serien">${meine.map(opt).join("")}</optgroup>` : "") +
    `<optgroup label="${meine.length ? "Weitere Serien" : "Serien"}">${andere.filter(s => !s.sonder).map(opt).join("")}</optgroup>` +
    (sonder.length ? `<optgroup label="Premium und Sonderserien">${sonder.map(opt).join("")}</optgroup>` : "");
  $("s-serie").value = [...$("s-serie").options].some(o => o.value === wahl) ? wahl : "";
  $("s-serie").disabled = !jahr;
}
$("s-jahr").addEventListener("input", () => { fuelleSerien(); alles(); });
["s-serie", "s-sort", "s-doppelt", "s-wertvoll", "s-fehlend", "f-jahr"].forEach(id => $(id).addEventListener("input", alles));
$("s-fehlend").addEventListener("change", e => { merke("fehlende-zeigen", e.target.checked ? "1" : ""); if (e.target.checked && !$("s-jahr").value) { $("s-jahr").value = String(meineJahre()[0]); fuelleSerien(); alles(); } });

// ---------- Dialoge ----------
document.querySelectorAll("dialog").forEach(d => {
  d.addEventListener("click", e => { if (e.target === d || e.target.closest("[data-zu]")) d.close(); });
});

function zeigeModell(id) {
  const m = IDX.modell(id); if (!m) return;
  const e = inventar().map.get(id), s = serieVon(m);
  $("k-titel").textContent = m.name;
  $("k-bild").innerHTML = bildHtml(m.bild ? wikiBild(m, 600) : (e?.foto && fotoUrl(e.foto)) || wikiBild(m, 600), m.name) +
    (!m.bild && !(e?.foto && fotoUrl(e.foto)) && ersatz(m) ? `<div class="muted" style="font-size:0.85rem;margin-top:4px">Für diese Ausführung gibt es im Wiki noch kein Foto – gezeigt wird ${esc(ersatz(m).jahr)} ${esc(ersatz(m).farbe || "eine andere Farbe")}.</div>` : "");
  const besitz = e ? `<div class="besitz hat"><strong>Hast du: ${e.anzahl}×</strong> (${[e.verpackt ? e.verpackt + " verpackt" : "", e.lose ? e.lose + " lose" : ""].filter(Boolean).join(", ")})</div>`
                   : `<div class="besitz fehlt"><strong>Fehlt dir noch.</strong></div>`;
  $("k-info").innerHTML = `${besitz}
    <div>${m.jahr} · Sammler-Nr. <span class="mono">${esc(m.nr || "–")}</span>${m.toy ? ` · Toy-Nr. <span class="mono">${esc(m.toy)}</span>` : ""}</div>
    <div>Serie: <strong>${esc(s.name)}</strong> ${m.snr ? `<span class="mono">${m.snr}/${s.gesamt}</span>` : ""}</div>
    ${chips(m)}${m.zusatz ? `<div class="muted">${esc(m.zusatz)}</div>` : ""}
    ${e?.eintraege.some(z => z.bezahlt != null) ? `<div>Bezahlt: <strong class="num">${eur(e.eintraege.reduce((a, z) => a + (Number(z.bezahlt) || 0), 0))}</strong> für ${e.anzahl} Stück</div>` : ""}
    ${wertvoll(m) ? `<div class="besitz hat" style="font-size:0.92rem"><strong>Potenziell wertvoll</strong> – ${esc(wertGrund(m))}. Ein Blick auf die verkauften Angebote lohnt sich.</div>` : ""}
    ${e ? lagerortHtml(e.key) : ""}
    ${preisLinks(m)}
    <div><a href="https://hotwheels.fandom.com/wiki/Special:Search?query=${encodeURIComponent(m.name)}" target="_blank" rel="noopener">Im Hot Wheels Wiki ansehen</a></div>`;
  $("k-aktionen").innerHTML = schreibbar ? `<button type="button" class="knopf voll" id="k-mehr">${e ? "Weiteres Exemplar" : "Hinzufügen"}</button>` : "";
  if (schreibbar) $("k-mehr").onclick = () => { $("dlg-karte").close(); oeffneNeu({ modell: m.id, zustand: e?.eintraege.at(-1)?.zustand }); };
  // andere Ausführungen desselben Modells (andere Jahre und Farben)
  const andere = IDX.ausfuehrungen(m).filter(x => x.id !== m.id).sort((a, b) => b.jahr - a.jahr || (a.var || 1) - (b.var || 1));
  $("k-versionen").innerHTML = andere.length ? `<strong>Andere Ausführungen (${andere.length})</strong><div class="versionen">${andere.slice(0, 30).map(x =>
    `<button type="button" class="kandidat" data-modell="${esc(x.id)}">${bildHtml(wikiBild(x, 200), x.name)}${hat(x.id) ? `<span class="hat-punkt">✓ ${hat(x.id)}</span>` : ""}
      <span><strong>${x.jahr}</strong>${x.nr ? " · #" + esc(x.nr) : ""}<br><span class="muted">${esc(serieVon(x).name)}${VAR_TEXT(x) ? " · " + esc(VAR_TEXT(x)) : ""}</span></span></button>`).join("")}</div>` : "";
  if (!$("dlg-karte").open) $("dlg-karte").showModal(); else $("dlg-karte").scrollTop = 0;
}
function zeigeFrei(key) {
  const e = inventar().map.get(key); if (!e) return;
  $("k-titel").textContent = e.name;
  $("k-bild").innerHTML = e.foto ? bildHtml(fotoUrl(e.foto), e.name) : "";
  $("k-info").innerHTML = `<div class="besitz hat"><strong>Hast du: ${e.anzahl}×</strong> · eigener Eintrag, nicht im Verzeichnis</div>`;
  $("k-aktionen").innerHTML = ""; $("k-versionen").innerHTML = "";
  $("dlg-karte").showModal();
}
document.addEventListener("click", e => {
  if (e.target.closest("a")) return;
  const k = e.target.closest("[data-kaufen]");
  if (k) { oeffneNeu({ modell: k.dataset.kaufen, herkunft: "Gekauft" }); return; }
  const l = e.target.closest("[data-loeschen]"); if (l) { frageLoeschen(l.dataset.loeschen); return; }
  if (e.target.closest("#dlg-neu")) return;   // im Erfassen-Dialog wählen die Kandidaten, nicht die Detailansicht
  const m = e.target.closest("[data-modell]"); if (m) { zeigeModell(m.dataset.modell); return; }
  const f = e.target.closest("[data-frei]"); if (f) zeigeFrei(f.dataset.frei);
});

// ---------- Auto hinzufügen / prüfen ----------
let neuFoto = null, wahl = null, modus = "neu", erkennung = null, kandidaten = [], frei = false;
// Packungen mit mehreren Autos (2-Pack, 4-Pack …) haben eine gemeinsame Toy-Nr. – dann werden alle zusammen erfasst
let pack = [], nurEinzeln = false;
const packVon = m => m?.toy ? (IDX.nachToy.get(m.toy) || []).filter(x => x.s === m.s) : [];
const packText = ids => ids.map(id => IDX.modell(id).name).join(" + ");
const kannErkennen = () => !!EINST.gemini && !!IDX;
function zeigeKandidaten(titel) {
  if (!kandidaten.length) { $("n-kandidaten").hidden = true; return; }
  $("n-kandidaten").hidden = false;
  $("n-kandidaten").innerHTML = `<strong>${esc(titel)}</strong><div class="reihe">${kandidaten.slice(0, 30).map(id => { const m = IDX.modell(id);
    return `<button type="button" class="kandidat" data-kandidat="${esc(id)}" aria-pressed="${id === wahl}">${bildHtml(wikiBild(m, 200), m.name)}${hat(id) ? `<span class="hat-punkt">✓ ${hat(id)}</span>` : ""}
      <span><strong>${esc(m.name)}</strong><br><span class="muted">${m.jahr}${m.nr ? " · #" + esc(m.nr) : ""} · ${esc(serieVon(m).name)}${m.farbe ? " · " + esc(m.farbe) : ""}${VAR_TEXT(m) ? " · " + esc(VAR_TEXT(m)) : ""}${m.exkl ? " · " + esc(m.exkl) : ""}${m.marken?.includes("STH") ? " · Super TH" : m.marken?.includes("TH") ? " · TH" : ""}</span></span></button>`; }).join("")}</div>` +
    (kandidaten.length > 30 ? `<span class="muted">… und ${kandidaten.length - 30} weitere. Grenze die Suche ein, z. B. mit dem Jahr.</span>` : "");
}
function markiereKandidat() { document.querySelectorAll("[data-kandidat]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.kandidat === wahl || pack.includes(b.dataset.kandidat)))); }
$("n-besitz").addEventListener("click", e => {
  const b = e.target.closest("[data-checkliste]"); if (!b) return;
  const si = IDX.serien[Number(b.dataset.checkliste)];
  $("dlg-neu").close();
  $("suche").value = ""; $("s-jahr").value = String(si.jahr); fuelleSerien(); $("s-serie").value = String(si.i);
  $("s-doppelt").checked = false; $("s-wertvoll").checked = false; $("s-fehlend").checked = true; $("s-sort").value = "nr";
  alles(); zeigeTab("sammlung"); $("panel-sammlung").scrollIntoView({ block: "start" });
});
$("n-kandidaten").addEventListener("click", e => { const b = e.target.closest("[data-kandidat]"); if (b) { waehle(b.dataset.kandidat); } });
function waehle(id) {
  wahl = id; frei = false; $("n-frei").hidden = true;
  const p = packVon(IDX.modell(id));
  pack = p.length > 1 && !nurEinzeln ? [id, ...p.map(x => x.id).filter(x => x !== id)] : [];
  markiereKandidat(); zeigeBesitz();
}
// Stand der Serie zum gewählten Auto: wie viele du hast, was dieses Auto ändern würde, welche du daraus hast
function serienBlock(m, neuIds = [m.id]) {
  const s = serieVon(m), st = serieStand(m.s);
  const eigene = IDX.jeSerie[m.s].filter(x => hat(x.id));
  const einheitenVorher = new Set(eigene.filter(zaehlt).map(einheit));
  const dazu = new Set(neuIds.map(id => IDX.modell(id)).filter(x => zaehlt(x) && !einheitenVorher.has(einheit(x))).map(einheit)).size;
  const komplett = st.gesamt && st.hat === st.gesamt;
  const kopf = komplett ? `✓ Serie <strong>${esc(s.name)} ${m.jahr}</strong> komplett (${st.hat}/${st.gesamt})`
    : !eigene.length ? `Serie <strong>${esc(s.name)} ${m.jahr}</strong>: noch keines – das wäre dein erstes`
    : `Serie <strong>${esc(s.name)} ${m.jahr}</strong>: du hast <strong>${st.hat} von ${st.gesamt}</strong>${dazu ? ` – mit ${neuIds.length > 1 ? "dieser Packung" : "diesem Auto"} ${st.hat + dazu}${st.hat + dazu === st.gesamt ? " ✓ komplett!" : ""}` : ""}`;
  const liste = eigene.length ? `<div class="muted" style="font-size:0.86rem">Du hast daraus: ${eigene.slice(0, 8).map(x => esc(x.name) + (x.var ? ` (${x.var}. Farbe)` : "")).join(" · ")}${eigene.length > 8 ? " …" : ""}</div>` : "";
  return `<div class="serien-info"><div>📚 ${kopf}</div>${liste}<button type="button" class="knopf" data-checkliste="${m.s}" style="justify-self:start">Checkliste der Serie</button></div>`;
}
// andere Ausführungen desselben Modells (andere Farbe oder anderes Jahr), die du schon hast – gut sichtbar
function ausfuehrungenBlock(m) {
  const verwandt = IDX.ausfuehrungen(m).filter(x => x.id !== m.id && hat(x.id)).sort((a, b) => b.jahr - a.jahr);
  if (!verwandt.length) return "";
  return `<div class="serien-info"><div>🚗 <strong>Dieses Modell hast du schon in ${verwandt.length === 1 ? "einer anderen Ausführung" : verwandt.length + " anderen Ausführungen"}:</strong></div>
    <div style="font-size:0.9rem">${verwandt.slice(0, 5).map(x => `${x.jahr} · ${esc(serieVon(x).name)}${x.farbe ? " · " + esc(x.farbe) : ""}`).join("<br>")}${verwandt.length > 5 ? "<br>…" : ""}</div></div>`;
}
function zeigeBesitz() {
  const feld = $("n-besitz"), m = wahl && IDX.modell(wahl);
  if (!m) { feld.hidden = true; return; }
  if (pack.length > 1) {   // Packung: alle Autos zeigen
    const s = serieVon(m), alleDa = pack.every(id => hat(id));
    feld.hidden = false; feld.className = "besitz " + (alleDa ? "hat" : "fehlt");
    feld.innerHTML = `<strong class="gross-text">📦 ${pack.length}-Pack${alleDa ? " – hast du schon" : ""}</strong>
      <div class="muted" style="font-size:0.88rem">${esc(s.name)} · ${m.jahr}${m.toy ? " · " + esc(m.toy) : ""} – ${modus === "neu" ? "beim Speichern werden alle Autos erfasst" : "alle Autos der Packung"}</div>
      ${pack.map(id => { const x = IDX.modell(id); return `<div class="zeile" style="margin-top:8px">${wikiBild(x) ? `<img src="${esc(wikiBild(x))}" alt="" crossorigin="anonymous">` : ""}<div>
        <strong>${esc(x.name)}</strong><div class="muted" style="font-size:0.88rem">${esc(x.farbe || "")}</div><div>${hat(id) ? `✓ hast du (${hat(id)}×)` : "fehlt dir noch"}</div></div></div>`; }).join("")}
      ${modus === "neu" ? `<button type="button" class="knopf" id="n-nur-eins" style="margin-top:8px">Nur ${esc(m.name)} speichern</button>` : ""}`;
    feld.insertAdjacentHTML("beforeend", serienBlock(m, pack));
    if ($("n-nur-eins")) $("n-nur-eins").onclick = () => { nurEinzeln = true; waehle(wahl); };
    return;
  }
  const e = inventar().map.get(m.id), s = serieVon(m);
  const auto = `${esc(m.name)} · ${m.jahr}${m.nr ? " · #" + esc(m.nr) : ""} · ${esc(s.name)} ${m.snr ? m.snr + "/" + s.gesamt : ""}${m.farbe ? " · " + esc(m.farbe) : ""}${VAR_TEXT(m) ? " · " + esc(VAR_TEXT(m)) : ""}${m.exkl ? " · " + esc(m.exkl) : ""}${m.toy ? " · " + esc(m.toy) : ""}`;
  feld.hidden = false;
  feld.className = "besitz " + (e ? "hat" : "fehlt");
  const wert = wertvoll(m);
  if (wert && vibriertFuer !== m.id) { vibriertFuer = m.id; try { navigator.vibrate?.([120, 60, 120]); } catch (err) {} }
  feld.innerHTML = `${wert ? `<div class="wert-alarm">⚠ Potenziell wertvoll! <span>${esc(wertGrund(m))}</span></div>` : ""}<div class="zeile">${wikiBild(m) ? `<img src="${esc(wikiBild(m))}" alt="Bild aus dem Verzeichnis" crossorigin="anonymous">` : ""}<div>
    ${e ? `<strong class="gross-text">Hast du schon</strong><div>${e.anzahl}× (${[e.verpackt ? e.verpackt + " verpackt" : "", e.lose ? e.lose + " lose" : ""].filter(Boolean).join(", ")}).${modus === "neu" ? " Das wäre ein weiteres Exemplar." : ""}</div>`
        : `<strong class="gross-text">Fehlt dir noch!</strong>`}
    <div class="muted" style="font-size:0.88rem">${auto}</div></div></div>${serienBlock(m)}${ausfuehrungenBlock(m)}${wert ? preisLinks(m) : ""}`;
}
let vibriertFuer = null;   // pro erkanntem Auto nur einmal vibrieren
function setzeModus(m) {
  modus = m;
  $("neu-titel").textContent = m === "pruefen" ? "Auto prüfen" : "Auto hinzufügen";
  document.querySelectorAll("#form-neu .nur-neu").forEach(el => { el.hidden = m === "pruefen"; });
  $("n-speichern").hidden = m === "pruefen";
  $("n-wechsel").hidden = !(m === "pruefen" && schreibbar);
  $("n-naechste").hidden = m !== "pruefen";
  $("n-frei-knopf").hidden = m === "pruefen";
  $("n-korrigieren").hidden = true;
}
$("n-wechsel").addEventListener("click", () => { setzeModus("neu"); $("n-datum").value = heute(); $("n-anzahl").value = 1; zeigeBesitz(); });
$("n-korrigieren").addEventListener("click", () => { $("n-korrigieren").hidden = true; zeigeKandidaten("Welches Auto ist es?"); $("n-suche").focus(); });
$("n-frei-knopf").addEventListener("click", () => { frei = true; wahl = null; $("n-frei").hidden = false; markiereKandidat(); zeigeBesitz(); $("n-freitext").focus(); });

function oeffneNeu(vor = {}) {
  const m = vor.modus || "neu";
  if (m === "neu" && !schreibbar) { toast("Zum Speichern bitte zuerst GitHub in den Einstellungen einrichten."); return; }
  $("form-neu").reset(); sucheVonHand = false; neuFoto = null; wahl = null; erkennung = null; kandidaten = []; frei = false; speicherId = null; pack = []; nurEinzeln = false;
  $("n-vorschau").innerHTML = `<div class="leerbild"></div>`;
  $("n-meldung").className = "meldung";
  $("n-meldung").textContent = kannErkennen() ? "Verpackt: am sichersten die Rückseite (Code wie JKX60-ND710, oft oben beim Aufhängeloch). Sonst die Vorderseite oder das Auto fotografieren, oder unten suchen."
    : "Such das Auto unten nach Name oder Toy-Nr. (Code auf der Kartenrückseite, z. B. JKX60). Für die Foto-Erkennung fehlt der Gemini-Schlüssel.";
  $("n-rueck-knopf").hidden = !kannErkennen();
  $("n-speichern-meldung").textContent = ""; $("n-erkennen").hidden = true; $("n-frei").hidden = true;
  $("n-kandidaten").hidden = true; $("n-besitz").hidden = true;
  $("n-zustand").value = vor.zustand || "verpackt"; $("n-herkunft").value = vor.herkunft || "Gekauft";
  $("n-datum").value = heute(); $("n-anzahl").value = 1;
  setzeModus(m);
  if (vor.modell && IDX.modell(vor.modell)) { kandidaten = [vor.modell]; waehle(vor.modell); zeigeKandidaten("Gewählt"); }
  $("dlg-neu").showModal();
}
$("fab").addEventListener("click", () => oeffneNeu());
function scannen() {
  oeffneNeu({ modus: "pruefen" });
  if (kannErkennen()) $("n-foto").click();   // öffnet direkt die Kamera
  else $("n-suche").focus();
}
$("fab-pruefen").addEventListener("click", scannen);
$("n-naechste").addEventListener("click", scannen);

// Suche im Dialog: Name, Toy-Nr., Jahr, Sammler-Nr.
function dialogSuche() {
  const t = $("n-suche").value.trim(); if (!t || !IDX) return;
  kandidaten = IDX.suche(t, 200).map(m => m.id);
  $("n-meldung").className = "meldung";
  $("n-meldung").textContent = kandidaten.length ? (kandidaten.length === 1 ? "Ein Treffer." : `${kandidaten.length} Treffer – tippe das richtige Auto an.`) : `Nichts gefunden für „${t}“.`;
  if (kandidaten.length === 1) waehle(kandidaten[0]); else if (!kandidaten.includes(wahl)) { wahl = null; zeigeBesitz(); }
  zeigeKandidaten(kandidaten.length === 1 ? "Gefunden" : "Welches Auto ist es?");
}
$("n-suchen").addEventListener("click", dialogSuche);
// Nur selbst Eingetipptes ist ein Hinweis für die Foto-Erkennung, nicht eine Nummer, die die App eingetragen hat
let sucheVonHand = false;
$("n-suche").addEventListener("input", () => { sucheVonHand = !!$("n-suche").value.trim(); });
$("n-suche").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); dialogSuche(); } });

async function verkleinere(datei, max = 1600) {
  const bild = await createImageBitmap(datei, { imageOrientation: "from-image" }).catch(() => null);
  if (!bild) return datei;
  const f = Math.min(1, max / Math.max(bild.width, bild.height));
  const c = document.createElement("canvas"); c.width = Math.round(bild.width * f); c.height = Math.round(bild.height * f);
  c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
  return await new Promise(r => c.toBlob(b => r(b || datei), "image/jpeg", 0.85));
}
async function fotoGewaehlt(e) {
  const datei = e.target.files && e.target.files[0]; if (!datei) return;
  e.target.value = "";
  $("n-meldung").className = "meldung"; $("n-meldung").textContent = "Foto wird vorbereitet …";
  neuFoto = await verkleinere(datei);
  $("n-vorschau").innerHTML = `<img src="${URL.createObjectURL(neuFoto)}" alt="Dein Foto">`;
  $("n-erkennen").hidden = !kannErkennen();
  $("n-meldung").textContent = kannErkennen() ? "Erkenne das Auto …" : "Such jetzt das Auto nach Name oder Toy-Nr.";
  if (kannErkennen()) erkenne();
}
$("n-foto").addEventListener("change", fotoGewaehlt);
// Rückseite: nur die Toy-Nr. lesen („JKX60-ND710 (G1) 21A“ → JKX60). Das Foto wird nicht gespeichert,
// gespeichert wird nur ein Foto der Vorderseite bzw. des Autos.
$("n-rueck").addEventListener("change", async e => {
  const datei = e.target.files && e.target.files[0]; if (!datei) return;
  e.target.value = "";
  const meldung = $("n-meldung"), knopf = $("n-rueck-knopf");
  meldung.className = "meldung"; meldung.textContent = "Lese den Code auf der Rückseite …";
  knopf.classList.add("laedt");
  $("n-kandidaten").hidden = true; $("n-korrigieren").hidden = true;
  try {
    const r = await rueckseite(await verkleinere(datei, 2000), IDX, EINST.gemini);
    const treffer = r.genau.length ? r.genau : r.aehnlich;
    if (!treffer.length) {
      meldung.textContent = r.code ? `Gelesen: „${r.code}“ – diese Toy-Nr. ist nicht im Verzeichnis. Prüf sie und tipp sie unten ein, oder fotografiere die Vorderseite.`
                                   : "Den Code konnte ich nicht lesen. Bitte näher ran, ohne Spiegelung, oder die Toy-Nr. unten eintippen.";
      if (r.toy) $("n-suche").value = r.toy;
      return;
    }
    kandidaten = treffer.map(m => m.id); $("n-suche").value = r.toy;
    waehle(kandidaten[0]);
    const m = IDX.modell(kandidaten[0]);
    if (r.genau.length === 1 && r.korrigiert) {
      meldung.textContent = `Gelesen „${r.korrigiert}“ – vermutlich Toy-Nr. ${r.toy}: ${m.name}, ${m.jahr}${m.farbe ? ", " + m.farbe : ""}. Stimmt das Bild? Sonst die Nummer unten eintippen.`;
    } else if (r.genau.length === 1) {
      meldung.textContent = `Erkannt über die Toy-Nr. ${r.toy}: ${m.name}, ${m.jahr}${m.farbe ? ", " + m.farbe : ""}.`;
    } else if (pack.length > 1) {
      meldung.textContent = `${pack.length}-Pack erkannt über die Toy-Nr. ${r.toy}: ${packText(pack)}.`;
    } else if (r.genau.length) {
      meldung.textContent = `Toy-Nr. ${r.toy} gibt es ${r.genau.length}× – bitte die richtige Ausführung antippen.`;
      zeigeKandidaten("Welche Ausführung ist es?");
    } else {
      meldung.textContent = `Gelesen: „${r.code}“. Genau so gibt es die Nummer nicht, vermutlich ein Lesefehler – bitte das richtige Auto antippen.`;
      zeigeKandidaten("Welches Auto ist es?");
    }
  } catch (err) {
    meldung.className = "meldung fehler";
    meldung.textContent = FEHLERTEXT[err?.code] || "Die Rückseite konnte nicht gelesen werden. Bitte die Toy-Nr. unten eintippen.";
  } finally { knopf.classList.remove("laedt"); }
});
$("n-galerie").addEventListener("change", fotoGewaehlt);
$("n-erkennen").addEventListener("click", () => erkenne());

const FEHLERTEXT = {
  kontingent: "Das Gratis-Kontingent von Gemini ist für heute aufgebraucht. Such das Auto bitte nach Name oder Toy-Nr.",
  zu_schnell: "Gerade zu viele Anfragen an Gemini. Bitte kurz warten oder das Auto suchen.",
  ueberlastet: "Gemini ist gerade überlastet. Bitte nochmal versuchen oder das Auto suchen.",
  schluessel: "Der Gemini-Schlüssel wird nicht akzeptiert. Bitte in den Einstellungen prüfen.",
  offline: "Keine Internetverbindung. Bitte das Auto suchen.",
};
async function erkenne() {
  if (!neuFoto || !IDX) return;
  const knopf = $("n-erkennen"); knopf.disabled = true;
  $("n-kandidaten").hidden = true; $("n-besitz").hidden = true; $("n-korrigieren").hidden = true;
  const meldung = $("n-meldung"); meldung.className = "meldung";
  try {
    erkennung = await bestimme(neuFoto, IDX, EINST.gemini, t => { meldung.textContent = t; }, sucheVonHand ? $("n-suche").value.trim() : "");
    const r = erkennung.antwort;
    kandidaten = erkennung.tipp;
    if (r && !r.ist_auto) { meldung.textContent = "Auf dem Foto ist kein Hot-Wheels-Auto zu erkennen. Bitte nochmal fotografieren oder suchen."; return; }
    if (r?.verpackt === false) $("n-zustand").value = "lose";
    if (!kandidaten.length) {
      meldung.textContent = `${r?.name ? "„" + r.name + "“" : "Das Auto"} wurde im Verzeichnis nicht gefunden. Such es unten anders, oder speichere es als eigenen Eintrag.`;
      if (r?.name) $("n-suche").value = r.name;
      if (modus === "neu") {   // gleich zum freien Eintrag, mit allem, was Gemini gelesen hat
        frei = true; wahl = null; $("n-frei").hidden = false; zeigeBesitz();
        $("n-freitext").value = [r?.name, r?.serie && r.serie + (r.serie_nr ? " " + r.serie_nr : ""), r?.toy, r?.farbe].filter(Boolean).join(", ");
      }
      return;
    }
    waehle(kandidaten[0]);
    const m = IDX.modell(kandidaten[0]);
    if (erkennung.status === "ok" && pack.length > 1) {
      meldung.textContent = `${pack.length}-Pack erkannt: ${packText(pack)}. Stimmen die Bilder?`;
      $("n-korrigieren").hidden = false; $("n-kandidaten").hidden = true;
    } else if (erkennung.status === "ok") {
      meldung.textContent = `Erkannt: ${m.name}, ${m.jahr}${m.nr ? " #" + m.nr : ""}${m.farbe ? ", " + m.farbe : ""}${VAR_TEXT(m) ? " (" + VAR_TEXT(m) + ")" : ""}. Stimmt das Bild?`;
      $("n-korrigieren").hidden = kandidaten.length < 2;
      $("n-kandidaten").hidden = true;
    } else {
      meldung.textContent = `Nicht ganz eindeutig – bitte das richtige Auto antippen. (Gemini las: ${[r?.name, r?.toy, r?.sammlernr, r?.serie].filter(Boolean).join(" · ") || "?"})`;
      zeigeKandidaten("Welches Auto ist es?");
    }
  } catch (e) {
    meldung.className = "meldung fehler";
    meldung.textContent = FEHLERTEXT[e?.code] || "Das Auto konnte nicht erkannt werden. Bitte suchen.";
  } finally { knopf.disabled = false; knopf.hidden = !kannErkennen(); }
}

const neueId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
// gleiche ID bei einem zweiten Versuch: kam der erste doch an, entsteht kein doppelter Eintrag und kein zweites Foto
let speicherId = null;
$("form-neu").addEventListener("submit", async ev => {
  ev.preventDefault();
  if (modus === "pruefen" || !schreibbar) return;
  const meldung = $("n-speichern-meldung"), knopf = $("n-speichern");
  let eintrag;
  if (frei) {
    const text = $("n-freitext").value.trim();
    if (!text) { meldung.textContent = "Bitte Name, Jahr und Serie eintragen."; return; }
    eintrag = { modell: null, name: text };
  } else {
    const m = wahl && IDX.modell(wahl);
    if (!m) { meldung.textContent = "Noch kein Auto gewählt: fotografieren, suchen oder frei eintragen."; return; }
    eintrag = { modell: m.id, name: m.name, jahr: m.jahr, nr: m.nr, toy: m.toy, serie: serieVon(m).name, ...(m.var ? { var: m.var } : {}) };
    if (pack.length > 1) eintrag.name = m.name;   // weitere Autos der Packung folgen unten
  }
  const anzahl = Math.max(1, Math.min(99, parseInt($("n-anzahl").value, 10) || 1));
  const id = speicherId ??= neueId();
  knopf.disabled = true; meldung.textContent = neuFoto && !(eintrag.modell && IDX.modell(eintrag.modell)?.bild) ? "Foto wird hochgeladen …" : "Speichert …";
  try {
    let foto = null;
    // eigenes Foto nur hochladen, wenn es kein Produktfoto im Wiki gibt (freier Eintrag oder Modell ohne Bild)
    const mitWikiBild = !!(eintrag.modell && IDX.modell(eintrag.modell)?.bild);
    if (neuFoto && !mitWikiBild) { foto = `${PFADE.fotoOrdner}${id}.jpg`; await speicher.fotoHochladen(foto, neuFoto, `Foto: ${eintrag.name}`); FOTOURL[foto] = URL.createObjectURL(neuFoto); }
    meldung.textContent = "Speichert …";
    const gemeinsam = { zustand: $("n-zustand").value, anzahl, herkunft: $("n-herkunft").value, datum: $("n-datum").value || heute(), notiz: $("n-notiz").value.trim(), erstellt: new Date().toISOString() };
    const bezahlt = betrag($("n-preis").value);
    // Packung: ein Eintrag je Auto, gleiche Daten; der Preis wird aufgeteilt (Rest auf das erste Auto)
    const ids = !frei && pack.length > 1 ? pack : [eintrag.modell];
    const anteil = bezahlt == null ? null : Math.floor(bezahlt / ids.length * 100) / 100;
    const neue = ids.map((mid, i) => {
      const x = mid && IDX.modell(mid);
      const basis = i === 0 ? eintrag : { modell: x.id, name: x.name, jahr: x.jahr, nr: x.nr, toy: x.toy, serie: serieVon(x).name, ...(x.var ? { var: x.var } : {}) };
      return { id: i === 0 ? id : `${id}-${i}`, ...basis, ...gemeinsam, foto: i === 0 ? foto : null,
        bezahlt: bezahlt == null ? null : i === 0 ? Math.round((bezahlt - anteil * (ids.length - 1)) * 100) / 100 : anteil,
        ...(ids.length > 1 ? { pack: `${ids.length}-Pack ${x?.toy || ""}`.trim() } : {}) };
    });
    const titel = neue.length > 1 ? `${neue.length}-Pack ${packText(ids)}` : eintrag.name;
    SAM = await speicher.aendern(PFADE.sammlung, l => [...l, ...neue.filter(n => !l.some(x => x.id === n.id))], `Zugang: ${anzahl}× ${titel}`);
    speicherId = null;
    merkeStand(); alles();
    $("dlg-neu").close();
    const ort = boxPlan().ort.get(eintrag.modell ? (modellVon(eintrag)?.id || eintrag.modell) : "frei|" + norm(eintrag.name));
    toast(ort ? `Gespeichert${neue.length > 1 ? ` (${neue.length} Autos)` : ""} – kommt in ${ort.box.titel}, ${ort.fach.name}` : `Gespeichert: ${titel}`);
  } catch (e) {
    meldung.textContent = e?.code === "zeit" ? "GitHub hat nicht geantwortet (Verbindung zu langsam?). Bitte nochmal auf Speichern tippen."
      : e?.code === "offline" ? "Keine Internetverbindung – bitte später nochmal speichern."
      : e?.code === "token" || e?.code === "rechte" ? e.message + " Bitte in den Einstellungen prüfen."
      : "Speichern hat nicht geklappt. Bitte noch einmal versuchen.";
  } finally { knopf.disabled = false; }
});

// ---------- Löschen ----------
let loeschZiel = null;
function frageLoeschen(id) {
  const x = SAM.find(y => y.id === id); if (!x) return;
  loeschZiel = x;
  $("f-text").textContent = `${x.name} (${x.anzahl} Stück) wird aus der Sammlung entfernt${x.foto ? ", das Foto wird gelöscht (in der GitHub-Historie bleibt es erhalten)" : ""}.`;
  $("dlg-frage").showModal();
}
$("f-ja").addEventListener("click", async () => {
  const x = loeschZiel; if (!x) return;
  $("f-ja").disabled = true;
  try {
    SAM = await speicher.aendern(PFADE.sammlung, l => l.filter(y => y.id !== x.id), `Gelöscht: ${x.name}`);
    if (x.foto) await speicher.loeschen(x.foto, `Foto gelöscht: ${x.name}`).catch(() => {});
    merkeStand(); alles();
    $("dlg-frage").close(); toast("Gelöscht");
  } catch (e) { $("f-text").textContent = "Löschen hat nicht geklappt. Bitte noch einmal versuchen."; }
  finally { $("f-ja").disabled = false; }
});

// ---------- Einstellungen ----------
function oeffneEinstellungen() {
  $("e-repo").value = EINST.repo; $("e-token").value = EINST.token; $("e-gemini").value = EINST.gemini;
  $("e-jahre").innerHTML = (IDX ? [...IDX.jahre].reverse() : []).map(j => `<label><input type="checkbox" value="${j}"${OPT.jahre.includes(j) ? " checked" : ""}>${j}</label>`).join("");
  $("e-varianten").checked = OPT.varianten; $("e-sth").checked = OPT.sth; $("e-sonder").checked = OPT.sonder; $("e-boxgroesse").value = OPT.box;
  $("e-ergebnis").innerHTML = `<div class="muted">App-Version ${VERSION}${IDX ? ` · Verzeichnis vom ${datumText(IDX.stand)}, ${IDX.modelle.length} Modelle` : ""}</div>
    <button type="button" class="knopf" id="e-aktualisieren" style="justify-self:start">App aktualisieren</button>`;
  $("e-aktualisieren").onclick = aktualisieren;
  $("dlg-einstellungen").showModal();
}
$("einstellungen-knopf").addEventListener("click", oeffneEinstellungen);
$("e-vergessen").addEventListener("click", () => {
  for (const k of ["token", "gemini"]) { EINST[k] = ""; merke(k, ""); }
  $("e-token").value = ""; $("e-gemini").value = "";
  $("e-ergebnis").innerHTML = "Beide Schlüssel sind von diesem Gerät entfernt.";
});
$("form-einstellungen").addEventListener("submit", async ev => {
  ev.preventDefault();
  OPT.jahre = [...$("e-jahre").querySelectorAll("input:checked")].map(i => Number(i.value));
  OPT.varianten = $("e-varianten").checked; OPT.sth = $("e-sth").checked; OPT.sonder = $("e-sonder").checked;
  OPT.box = Math.max(10, Math.min(80, parseInt($("e-boxgroesse").value, 10) || 30));
  merke("sammeln", JSON.stringify(OPT)); alles();
  const neuerSchluessel = EINST.repo !== $("e-repo").value.trim() || EINST.token !== $("e-token").value.trim();
  EINST.repo = $("e-repo").value.trim(); EINST.token = $("e-token").value.trim(); EINST.gemini = $("e-gemini").value.trim();
  for (const k of ["repo", "token", "gemini"]) merke(k, EINST[k]);
  const zeilen = [];
  const zeige = () => { $("e-ergebnis").innerHTML = zeilen.join(""); };
  zeilen.push("<div>GitHub wird geprüft …</div>"); zeige();
  try {
    const s = TEST ? speicher : new GitHubSpeicher({ token: EINST.token, repo: EINST.repo });
    const r = await s.pruefen();
    zeilen[0] = r.schreiben ? "<div>✓ GitHub: verbunden, Speichern erlaubt</div>" : "<div>⚠ GitHub: nur Lesen erlaubt – beim Token „Contents: Read and write“ wählen</div>";
  } catch (e) { zeilen[0] = `<div>✗ GitHub: ${esc(e.message)}</div>`; }
  zeige();
  if (EINST.gemini && !TEST) {
    zeilen.push("<div>Gemini wird geprüft …</div>"); zeige();
    try {
      const a = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": EINST.gemini } });
      zeilen[1] = a.ok ? "<div>✓ Gemini: Schlüssel gültig</div>" : "<div>✗ Gemini: Schlüssel wird nicht akzeptiert</div>";
    } catch (e) { zeilen[1] = "<div>✗ Gemini: keine Verbindung</div>"; }
  } else if (!EINST.gemini) zeilen.push("<div>– Gemini: kein Schlüssel, Foto-Erkennung aus</div>");
  zeilen.push("<div>✓ Sammel-Einstellungen gespeichert</div>");
  zeige();
  if (!TEST && neuerSchluessel) await verbinde();
});

// ---------- Laden und Verbinden ----------
function merkeStand() { merke("stand", JSON.stringify({ SAM })); }
function gemerkterStand() { try { return JSON.parse(lies("stand") || "null"); } catch (e) { return null; } }

async function verbinde() {
  if (!TEST && !EINST.token) {
    schreibbar = false; $("fab").hidden = true; geladen = false;
    status("Nicht verbunden: Tippe auf ⚙ Einstellungen und trage deinen GitHub-Zugangsschlüssel ein. Suchen und Prüfen gehen auch so.", "warn");
    $("s-raster").innerHTML = `<div class="willkommen"><strong>Willkommen!</strong><span>Deine Sammlung liegt in deinem privaten GitHub-Repo. Trage einmalig den Zugangsschlüssel ein, dann lädt die App sie hierher. Suchen im Verzeichnis geht schon jetzt.</span><button type="button" class="knopf voll" style="justify-self:start" id="w-einstellungen">Einstellungen öffnen</button></div>`;
    $("w-einstellungen").onclick = oeffneEinstellungen;
    return;
  }
  speicher = TEST ? speicher : new GitHubSpeicher({ token: EINST.token, repo: EINST.repo });
  status("Lädt die Sammlung von GitHub …");
  try {
    const r = await speicher.pruefen();
    SAM = (await speicher.lesen(PFADE.sammlung)) || [];
    geladen = true;
    schreibbar = r.schreiben; $("fab").hidden = !schreibbar; $("n-wechsel").hidden = !(modus === "pruefen" && schreibbar);
    status(schreibbar ? "Verbunden mit GitHub: Änderungen werden gespeichert." : "Nur ansehen: Der Zugangsschlüssel darf nicht speichern.", schreibbar ? "ok" : "warn");
    merkeStand(); alles();
  } catch (e) {
    schreibbar = false; $("fab").hidden = true;
    const alt = gemerkterStand();
    if (alt?.SAM && e.code === "offline") { SAM = alt.SAM; geladen = true; alles(); status("Offline: gespeicherter Stand, Änderungen erst wieder mit Internet.", "warn"); }
    else status(e.message + (e.code === "token" || e.code === "repo" ? " Bitte in den Einstellungen prüfen." : ""), "warn");
  }
}
// „App aktualisieren“: neueste Fassung holen, alte Kopien verwerfen, neu laden
async function aktualisieren() {
  const k = $("e-aktualisieren"); k.disabled = true; k.textContent = "Lade neueste Version …";
  const dateien = ["./", "index.html", "app.js", "erkennung.js", "speicher.js", "sw.js", "daten/modell-index.json"];
  try { await Promise.all(dateien.map(u => fetch(u, { cache: "reload" }))); } catch {}
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
  try { for (const n of await caches.keys()) if (n.startsWith("hw-app-")) await caches.delete(n); } catch {}
  location.reload();
}
function neueVersionHinweis() {
  if ($("neue-version")) return;
  const b = document.createElement("button");
  b.id = "neue-version"; b.type = "button"; b.className = "knopf voll";
  b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top, 0px));z-index:30;padding:8px 14px";
  b.textContent = "Neue Version verfügbar – tippen zum Aktualisieren";
  b.onclick = () => location.reload();
  document.body.append(b);
}

// Neue Modelle: Die Wochen-Automatik aktualisiert das Verzeichnis im privaten Repo. Die App schaut höchstens
// einmal am Tag nach, ob es dort ein neueres gibt, und legt es im Zwischenspeicher des Geräts ab.
async function neuesVerzeichnis() {
  if (!speicher || TEST || !EINST.token || lies("verzeichnis-geprueft") === heute()) return;
  try {
    const d = await speicher.lesen(PFADE.verzeichnis, { gross: true });
    merke("verzeichnis-geprueft", heute());
    if (d?.stand && (!IDX || d.stand > IDX.stand)) {
      IDX = new Index(d); modellCache.clear(); ersatzCache.clear(); fuelleJahre(); fuelleSerien(); alles();
      try { await (await caches.open("hw-verzeichnis")).put("neuestes", new Response(JSON.stringify(d))); } catch (e) {}
    }
  } catch (e) {}
}

// beim Zurückkehren in die App frische Daten holen (z. B. nach Änderungen auf einem anderen Gerät)
let zuletzt = Date.now();
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !speicher || TEST || Date.now() - zuletzt < 60000) return;
  zuletzt = Date.now();
  try { SAM = (await speicher.lesen(PFADE.sammlung)) || []; merkeStand(); alles(); } catch (e) {}
});

async function start() {
  if (TEST) {
    speicher = new TestSpeicher("../");
    window.testSpeicher = speicher; window.testHaken = haken;   // für Tests am PC
    EINST.gemini = EINST.gemini || "test";
  }
  // Verzeichnis: mitgeliefert, oder eine neuere Fassung, die die App schon einmal aus dem Repo geholt hat
  try {
    const d = await fetch("daten/modell-index.json").then(r => r.json());
    let gemerkt = null;
    try { gemerkt = await (await (await caches.open("hw-verzeichnis")).match("neuestes"))?.json(); } catch (e) {}
    IDX = new Index(gemerkt && gemerkt.stand > d.stand ? gemerkt : d);
  } catch (e) { status("Das Modellverzeichnis konnte nicht geladen werden.", "warn"); return; }
  fuelleJahre(); fuelleSerien();
  $("s-fehlend").checked = lies("fehlende-zeigen") === "1";
  zeigeTab(location.hash.slice(1));
  alles();
  await verbinde();
  neuesVerzeichnis();
  if (TEST) status("Testmodus: Daten vom PC, Änderungen nur im Arbeitsspeicher.", "ok");
  if ("serviceWorker" in navigator && !TEST) {
    const hatteSteuerung = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hatteSteuerung) neueVersionHinweis(); });
    navigator.serviceWorker.register("sw.js").then(reg => {
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }
}
window.addEventListener("hashchange", () => zeigeTab(location.hash.slice(1)));
start();
