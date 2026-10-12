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
const VERSION = "1.6 (12.10.2026)";      // in den Einstellungen sichtbar – hilft beim Prüfen, ob die neue Fassung geladen ist

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
const OPT = (() => { const std = { jahre: [], varianten: true, sth: false, sonder: false };
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
function inventar() {
  if (invCache) return invCache;
  const map = new Map();
  for (const z of SAM) {
    const key = z.modell || "frei|" + norm(z.name);
    let e = map.get(key);
    if (!e) {
      const m = z.modell && IDX?.modell(z.modell);
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
const wikiBild = (m, breite) => m?.bild ? bildUrl(m.bild, breite) : null;
function bildHtml(src, alt = "") {
  return src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" crossorigin="anonymous" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'leerbild'}))">` : `<div class="leerbild"></div>`;
}
let spaeterZeit;
function spaeter() { clearTimeout(spaeterZeit); spaeterZeit = setTimeout(alles, 120); }

// ---------- Wert ----------
// Keine Preisquelle für Hot Wheels: Die App markiert, was sich zu prüfen lohnt, und verlinkt verkaufte Angebote.
const WERTVOLL = /RLC|Red Line Club|Convention|Mail[- ]?In|Collector Edition|Elite 64|Treasure Hunt|Employee|Prototype/i;
const wertvoll = m => !!m && ((m.marken || []).some(k => k === "TH" || k === "STH") || WERTVOLL.test(`${IDX.serien[m.s].name} ${m.exkl || ""} ${m.zusatz || ""}`));
function suchbegriff(m) {   // so, wie Verkäufer Hot Wheels anbieten: Name, bei Besonderem „Super Treasure Hunt“ bzw. die Serie
  const mk = m.marken || [], s = IDX.serien[m.s].name;
  const zusatz = mk.includes("STH") ? "super treasure hunt" : mk.includes("TH") ? "treasure hunt" : m.x ? s.replace(/\s*(Series|Collection)$/i, "") : "";
  return `hot wheels ${m.name.replace(/^'/, "")} ${zusatz}`.replace(/\s+/g, " ").trim();
}
function preisLinks(m) {
  const q = encodeURIComponent(suchbegriff(m)), verkauft = "&LH_Sold=1&LH_Complete=1&_sop=13";
  return `<div class="preislinks"><span class="muted">Wert prüfen (verkaufte Angebote):</span>
    <a class="knopf" href="https://www.ebay.at/sch/i.html?_nkw=${q}${verkauft}" target="_blank" rel="noopener">eBay.at</a>
    <a class="knopf" href="https://www.ebay.de/sch/i.html?_nkw=${q}${verkauft}" target="_blank" rel="noopener">eBay.de</a>
    <a class="knopf" href="https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?keyword=${q}" target="_blank" rel="noopener">willhaben</a></div>`;
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
  const bild = wikiBild(m) || (e?.foto && fotoUrl(e.foto));   // Produktfoto aus dem Wiki, eigenes nur ohne
  return `<button type="button" class="karte${anzahl ? "" : " fehlt"}" data-modell="${esc(m.id)}">
    <span class="bild">${bildHtml(bild, m.name)}</span>
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
  bilanz(); sammlung(); serien(); fehlliste(); verlauf();
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
  $("bilanz").innerHTML = `
    <div><span class="label">Autos</span><span class="wert">${stueck}</span><small>${inv.length} verschiedene</small></div>
    <div><span class="label">Jahr ${jahr}</span><span class="wert">${jh} / ${jg}</span><small>${OPT.varianten ? "Modelle mit Farbvarianten" : "Modelle"}</small></div>
    <div><span class="label">Serien komplett</span><span class="wert">${komplett} / ${alleSerien}</span><small>in deinen Jahren</small></div>
    <div><span class="label">Treasure Hunts</span><span class="wert">${th} + ${sth}</span><small>TH + Super TH</small></div>`;
}

const nrZahl = m => parseInt(m?.nr, 10) || 999;
function sammlung() {
  const suche = $("suche").value.trim();
  const jahr = Number($("s-jahr").value) || null, serie = $("s-serie").value, sort = $("s-sort").value;
  const doppelt = $("s-doppelt").checked, nurWert = $("s-wertvoll").checked;
  const mitFehl = $("s-fehlend").checked && !doppelt && !nurWert && (jahr || serie !== "");
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
    if (mitFehl) {
      const serienListe = serie !== "" ? [Number(serie)] : gezaehlteSerien(jahr).map(s => s.i);
      fehlt = serienListe.flatMap(si => serieStand(si).fehlt);
    }
    const sortierer = {
      nr: (a, b) => (b.jahr || 0) - (a.jahr || 0) || nrZahl(a.m) - nrZahl(b.m) || (a.m?.var || 1) - (b.m?.var || 1),
      name: (a, b) => a.name.localeCompare(b.name, "de"),
      neu: (a, b) => (b.zuletzt || "").localeCompare(a.zuletzt || ""),
    };
    const alle = [...liste, ...fehlt.map(m => ({ key: m.id, m, name: m.name, jahr: m.jahr, anzahl: 0, zuletzt: "" }))].sort(sortierer[sort] || sortierer.nr);
    text = `${eigene} Modelle` + (mitFehl ? ` · ${fehlt.length} fehlen` : "");
    html = alle.map(e => e.m ? kachel(e.m, e.anzahl ? e : null) : kachelFrei(e)).join("");
    if (!inv.length && !mitFehl && geladen)
      html = `<div class="willkommen"><strong>Noch keine Autos erfasst.</strong><span>Tippe unten rechts auf „＋ Auto“, fotografiere ein Auto oder such es nach Name. Mit „Prüfen“ siehst du, ob du ein Auto schon hast, ohne es zu speichern.</span></div>`;
  }
  $("s-treffer").textContent = text;
  $("s-raster").innerHTML = html || `<div class="leer">Kein Auto passt zu diesen Filtern.</div>`;
}

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
    const m = z.modell && IDX?.modell(z.modell);
    return `<li><span class="streifen" style="background:var(--gruen)"></span>${bildHtml(wikiBild(m, 160) || (z.foto && fotoUrl(z.foto)), z.name)}
      <span class="name"${m ? ` data-modell="${esc(m.id)}" style="cursor:pointer"` : ""}>${esc(z.name)} ${Number(z.anzahl) > 1 ? `×${z.anzahl}` : ""}
        <span class="unter">${m ? `${m.jahr}${m.nr ? " · #" + esc(m.nr) : ""} · ${esc(serieVon(m).name)}` : "eigener Eintrag"} · ${z.zustand === "lose" ? "lose" : "verpackt"} · ${datumText(z.datum)} · ${esc(z.herkunft || "")}${z.notiz ? " · " + esc(z.notiz) : ""}</span></span>
      <span class="rechts">${z.bezahlt != null ? eur(z.bezahlt) : ""}${schreibbar ? `<button type="button" class="knopf gefahr" data-loeschen="${esc(z.id)}">Löschen</button>` : ""}</span></li>`;
  }).join("") : `<li style="display:block;padding:14px"><span class="muted">Noch keine Einträge. Neue Autos erfasst du mit „＋ Auto“ unten rechts.</span></li>`;
}

// ---------- Tabs, Filter ----------
function zeigeTab(name) {
  if (!["sammlung", "serien", "fehlliste", "verlauf"].includes(name)) name = "sammlung";
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
  $("k-bild").innerHTML = bildHtml(wikiBild(m, 600) || (e?.foto && fotoUrl(e.foto)), m.name);
  const besitz = e ? `<div class="besitz hat"><strong>Hast du: ${e.anzahl}×</strong> (${[e.verpackt ? e.verpackt + " verpackt" : "", e.lose ? e.lose + " lose" : ""].filter(Boolean).join(", ")})</div>`
                   : `<div class="besitz fehlt"><strong>Fehlt dir noch.</strong></div>`;
  $("k-info").innerHTML = `${besitz}
    <div>${m.jahr} · Sammler-Nr. <span class="mono">${esc(m.nr || "–")}</span>${m.toy ? ` · Toy-Nr. <span class="mono">${esc(m.toy)}</span>` : ""}</div>
    <div>Serie: <strong>${esc(s.name)}</strong> ${m.snr ? `<span class="mono">${m.snr}/${s.gesamt}</span>` : ""}</div>
    ${chips(m)}${m.zusatz ? `<div class="muted">${esc(m.zusatz)}</div>` : ""}
    ${e?.eintraege.some(z => z.bezahlt != null) ? `<div>Bezahlt: <strong class="num">${eur(e.eintraege.reduce((a, z) => a + (Number(z.bezahlt) || 0), 0))}</strong> für ${e.anzahl} Stück</div>` : ""}
    ${wertvoll(m) ? `<div class="besitz hat" style="font-size:0.92rem"><strong>Potenziell wertvoll</strong> – ${m.marken?.includes("STH") ? "Super Treasure Hunt" : m.marken?.includes("TH") ? "Treasure Hunt" : esc(serieVon(m).name)}. Ein Blick auf die verkauften Angebote lohnt sich.</div>` : ""}
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
const kannErkennen = () => !!EINST.gemini && !!IDX;
function zeigeKandidaten(titel) {
  if (!kandidaten.length) { $("n-kandidaten").hidden = true; return; }
  $("n-kandidaten").hidden = false;
  $("n-kandidaten").innerHTML = `<strong>${esc(titel)}</strong><div class="reihe">${kandidaten.slice(0, 30).map(id => { const m = IDX.modell(id);
    return `<button type="button" class="kandidat" data-kandidat="${esc(id)}" aria-pressed="${id === wahl}">${bildHtml(wikiBild(m, 200), m.name)}${hat(id) ? `<span class="hat-punkt">✓ ${hat(id)}</span>` : ""}
      <span><strong>${esc(m.name)}</strong><br><span class="muted">${m.jahr}${m.nr ? " · #" + esc(m.nr) : ""} · ${esc(serieVon(m).name)}${m.farbe ? " · " + esc(m.farbe) : ""}${VAR_TEXT(m) ? " · " + esc(VAR_TEXT(m)) : ""}${m.exkl ? " · " + esc(m.exkl) : ""}${m.marken?.includes("STH") ? " · Super TH" : m.marken?.includes("TH") ? " · TH" : ""}</span></span></button>`; }).join("")}</div>` +
    (kandidaten.length > 30 ? `<span class="muted">… und ${kandidaten.length - 30} weitere. Grenze die Suche ein, z. B. mit dem Jahr.</span>` : "");
}
function markiereKandidat() { document.querySelectorAll("[data-kandidat]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.kandidat === wahl))); }
$("n-kandidaten").addEventListener("click", e => { const b = e.target.closest("[data-kandidat]"); if (b) { waehle(b.dataset.kandidat); } });
function waehle(id) {
  wahl = id; frei = false; $("n-frei").hidden = true;
  markiereKandidat(); zeigeBesitz();
}
function zeigeBesitz() {
  const feld = $("n-besitz"), m = wahl && IDX.modell(wahl);
  if (!m) { feld.hidden = true; return; }
  const e = inventar().map.get(m.id), s = serieVon(m);
  const auto = `${esc(m.name)} · ${m.jahr}${m.nr ? " · #" + esc(m.nr) : ""} · ${esc(s.name)} ${m.snr ? m.snr + "/" + s.gesamt : ""}${m.farbe ? " · " + esc(m.farbe) : ""}${VAR_TEXT(m) ? " · " + esc(VAR_TEXT(m)) : ""}${m.exkl ? " · " + esc(m.exkl) : ""}${m.toy ? " · " + esc(m.toy) : ""}`;
  // andere Farben desselben Platzes oder dasselbe Modell aus anderen Jahren
  const verwandt = IDX.ausfuehrungen(m).filter(x => x.id !== m.id && hat(x.id));
  const verwandtText = verwandt.length ? `<div class="muted" style="font-size:0.88rem">Andere Ausführungen hast du: ${verwandt.slice(0, 4).map(x => `${x.jahr}${VAR_TEXT(x) ? " (" + esc(VAR_TEXT(x)) + ")" : ""}`).join(", ")}${verwandt.length > 4 ? " …" : ""}</div>` : "";
  feld.hidden = false;
  feld.className = "besitz " + (e ? "hat" : "fehlt");
  feld.innerHTML = `<div class="zeile">${wikiBild(m) ? `<img src="${esc(wikiBild(m))}" alt="Bild aus dem Verzeichnis" crossorigin="anonymous">` : ""}<div>
    ${e ? `<strong class="gross-text">Hast du schon</strong><div>${e.anzahl}× (${[e.verpackt ? e.verpackt + " verpackt" : "", e.lose ? e.lose + " lose" : ""].filter(Boolean).join(", ")}).${modus === "neu" ? " Das wäre ein weiteres Exemplar." : ""}</div>`
        : `<strong class="gross-text">Fehlt dir noch!</strong>`}
    <div class="muted" style="font-size:0.88rem">${auto}</div>${verwandtText}</div></div>`;
}
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
  $("form-neu").reset(); sucheVonHand = false; neuFoto = null; wahl = null; erkennung = null; kandidaten = []; frei = false; speicherId = null;
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
    if (erkennung.status === "ok") {
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
    const neu = { id, ...eintrag, zustand: $("n-zustand").value, anzahl, foto, herkunft: $("n-herkunft").value, bezahlt: betrag($("n-preis").value),
      datum: $("n-datum").value || heute(), notiz: $("n-notiz").value.trim(), erstellt: new Date().toISOString() };
    SAM = await speicher.aendern(PFADE.sammlung, l => l.some(x => x.id === id) ? l : [...l, neu], `Zugang: ${anzahl}× ${eintrag.name}`);
    speicherId = null;
    merkeStand(); alles();
    $("dlg-neu").close(); toast(`Gespeichert: ${eintrag.name}`);
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
  $("e-varianten").checked = OPT.varianten; $("e-sth").checked = OPT.sth; $("e-sonder").checked = OPT.sonder;
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
      IDX = new Index(d); fuelleJahre(); fuelleSerien(); alles();
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
  $("fab-pruefen").hidden = false;
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
