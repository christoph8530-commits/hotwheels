// Modellverzeichnis und Erkennung: Gemini liest Name, Toy-Nr. und Sammler-Nr. vom Foto,
// die App ordnet das Auto im Verzeichnis zu. Ist es nicht eindeutig, vergleicht Gemini das Foto
// mit den Wiki-Bildern der Kandidaten (zweite Anfrage).
export const MODELL = "gemini-flash-lite-latest";   // Alias: rückt automatisch auf die neueste Version nach
export const MODELL_STARK = "gemini-flash-latest";  // für kleine Schrift (Code auf der Rückseite), nur wenn nötig
export const haken = { gemini: null };              // zum Testen: Gemini-Aufruf ersetzen
const BILDER = "https://static.wikia.nocookie.net/hotwheels/images/";

// Suchtext: klein, ohne Akzente und Apostrophe – „'69 Dodge Charger“ → „69 dodge charger“
export const norm = s => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/['’`´"]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const normToy = s => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const istToy = w => /^[a-z]{1,3}\d{2,5}$|^[a-z0-9]{5}$/.test(w) && /\d/.test(w) && /[a-z]/.test(w);

// Bild aus dem Wiki: Pfad „b9/Datei.jpg“ (MD5-Ordner) → Adresse in der gewünschten Breite
export function bildUrl(pfad, breite = 240) {
  if (!pfad) return null;
  const i = pfad.indexOf("/"), h = pfad.slice(0, i), datei = pfad.slice(i + 1);
  return `${BILDER}${h[0]}/${h}/${encodeURIComponent(datei)}/revision/latest/scale-to-width-down/${breite}`;
}

export class Index {
  constructor(d) {
    this.stand = d.stand; this.quelle = d.quelle; this.serien = d.serien; this.modelle = d.modelle;
    this.jahre = Object.keys(d.jahre).map(Number).sort((a, b) => a - b);
    this.nachId = new Map(); this.nachToy = new Map(); this.nachModell = new Map();
    this.jeSerie = d.serien.map(() => []);
    const serienText = d.serien.map(s => norm(s.name));
    for (const m of d.modelle) {
      m.n = norm(m.name);
      // Suchtext einmal vorbereiten: Name, Serie, Toy-Nr., Farbe, Variante, Händler
      m.t = `${m.n} ${serienText[m.s]} ${(m.toy || "").toLowerCase()} ${norm(m.farbe)} ${norm(m.vtext)} ${norm(m.exkl)}`;
      this.nachId.set(m.id, m);
      if (m.toy) { if (!this.nachToy.has(m.toy)) this.nachToy.set(m.toy, []); this.nachToy.get(m.toy).push(m); }
      const k = m.k ?? m.n;   // alle Ausführungen desselben Modells (Modellseite im Wiki)
      if (!this.nachModell.has(k)) this.nachModell.set(k, []); this.nachModell.get(k).push(m);
      this.jeSerie[m.s].push(m);
    }
    for (const l of this.jeSerie) l.sort((a, b) => (a.snr || 0) - (b.snr || 0) || a.nr.localeCompare(b.nr) || (a.var || 1) - (b.var || 1));
    // Serien eines Jahres in der Reihenfolge der Sammler-Nummern
    this.serienJahr = new Map();
    this.serien.forEach((s, i) => { s.i = i; s.ab = Math.min(...this.jeSerie[i].map(m => parseInt(m.nr, 10) || 999));
      if (!this.serienJahr.has(s.jahr)) this.serienJahr.set(s.jahr, []); this.serienJahr.get(s.jahr).push(s); });
    this.jahre = [...this.serienJahr.keys()].sort((a, b) => a - b);   // auch Jahre nur mit Sonderserien
    for (const l of this.serienJahr.values()) l.sort((a, b) => a.ab - b.ab || a.name.localeCompare(b.name));
  }
  modell(id) { return this.nachId.get(id); }
  ausfuehrungen(m) { return this.nachModell.get(m.k ?? m.n) || [m]; }
  serie(m) { return this.serien[m.s]; }
  // Freie Suche: Name, Serie, Toy-Nr. („HYW18“), Jahr („2025“), Sammler-Nr. („123“ oder „123/250“)
  suche(text, max = 200) {
    const woerter = norm(String(text).replace(/(\d+)\s*\/\s*\d+/, "$1")).split(" ").filter(Boolean);
    if (!woerter.length) return [];
    let jahr = null, nr = null; const rest = [], toys = [];
    for (const w of woerter) {
      if (/^(19|20)\d\d$/.test(w) && !jahr) jahr = Number(w);
      else if (/^\d{1,3}$/.test(w) && !nr) nr = w;   // Sammler-Nr. oder Zahl im Namen („69 Charger“)
      else if (istToy(w) && this.nachToy.has(w.toUpperCase())) toys.push(w.toUpperCase());
      else rest.push(w);
    }
    if (toys.length) return toys.flatMap(t => this.nachToy.get(t)).slice(0, max);
    const nr3 = nr?.padStart(3, "0"), imNamen = new RegExp(`(^| )${nr}( |$)`);
    const out = [];
    for (const m of this.modelle) {
      if (jahr && m.jahr !== jahr) continue;
      if (nr && m.nr !== nr3 && !imNamen.test(m.n)) continue;
      if (rest.length && !rest.every(w => m.t.includes(w))) continue;
      out.push(m);
    }
    // Treffer im Namen vor Treffern nur in Serie oder Farbe; Mainline vor Sonderserien; neuere Jahre zuerst
    const imName = m => rest.every(w => m.n.includes(w)) ? 0 : 1;
    const nrZuerst = m => nr && m.nr === nr3 && jahr ? 0 : 1;   // „2025 4“ meint die Sammler-Nr. 4
    out.sort((a, b) => nrZuerst(a) - nrZuerst(b) || imName(a) - imName(b) || b.jahr - a.jahr || (a.x || 0) - (b.x || 0) || a.nr.localeCompare(b.nr) || (a.var || 1) - (b.var || 1));
    return out.slice(0, max);
  }
}

// ---------- Gemini ----------
export class GeminiFehler extends Error {
  constructor(code, text) { super(text); this.code = code; }
}
export async function gemini(schluessel, teile, schema, modell = MODELL) {
  if (haken.gemini) return haken.gemini(teile, schema);
  let antwort;
  try {
    antwort = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modell}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": schluessel, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: teile }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 } }) });
  } catch (e) { throw new GeminiFehler("offline", "Keine Verbindung zu Gemini."); }
  if (!antwort.ok) {
    const text = await antwort.text().catch(() => "");
    if (antwort.status === 429) throw new GeminiFehler(/PerDay|quota/i.test(text) ? "kontingent" : "zu_schnell", text);
    if (antwort.status === 400 && /API key/i.test(text)) throw new GeminiFehler("schluessel", text);
    if (antwort.status === 403) throw new GeminiFehler("schluessel", text);
    throw new GeminiFehler(antwort.status >= 500 ? "ueberlastet" : "fehler", text);
  }
  const d = await antwort.json();
  const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiFehler("leer", "Gemini hat nicht geantwortet.");
  return JSON.parse(text);
}

async function alsTeil(blob, max = 1024) {
  const bild = await createImageBitmap(blob).catch(() => null);
  if (!bild) return null;
  const f = Math.min(1, max / Math.max(bild.width, bild.height));
  const c = new OffscreenCanvas(Math.round(bild.width * f), Math.round(bild.height * f));
  c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
  const b = await c.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { inline_data: { mime_type: "image/jpeg", data: btoa(s) } };
}

const SCHEMA_LESEN = { type: "OBJECT", properties: {
  ist_auto: { type: "BOOLEAN", description: "true, wenn ein Hot-Wheels-Auto oder seine Verpackung (auch nur die Rückseite) zu sehen ist" },
  verpackt: { type: "BOOLEAN", description: "true, wenn das Auto noch in der Blisterverpackung auf der Karte steckt" },
  name: { type: "STRING", description: "Modellname wie auf Karte oder Unterboden, z. B. '69 Dodge Charger" },
  toy: { type: "STRING", description: "Toy-Nummer, meist 3 Buchstaben + 2 Ziffern wie HYW18. NICHT die Sortimentsnummer (steht bei „Asst.“ oder senkrecht am Kartenrand, z. B. HBL96). Auf der Kartenrückseite steht sie als Code wie JKX57-ND710 (G1) 21A – dann den ganzen Code. Leer, wenn nicht lesbar" },
  sammlernr: { type: "STRING", description: "Sammler-Nummer wie 123/250; leer, wenn nicht sichtbar" },
  serie: { type: "STRING", description: "Serienname auf der Karte, z. B. HW Dream Garage" },
  serie_nr: { type: "STRING", description: "Platz in der Serie wie 2/5" },
  jahr: { type: "INTEGER", nullable: true, description: "Erscheinungsjahr nur, wenn auf der Karte klar erkennbar; nicht das Jahr vom Unterboden" },
  farbe: { type: "STRING", description: "Hauptfarbe auf Englisch, wie in Katalogen üblich, z. B. white, metalflake blue, spectraflame red" },
  treasure_hunt: { type: "BOOLEAN", description: "kleines Flammen-Logo im Kreis auf der Karte oder am Auto" },
  super_treasure_hunt: { type: "BOOLEAN", description: "TH-Logo, Spectraflame-Lack und Real-Riders-Gummireifen" },
}, required: ["ist_auto", "verpackt", "name"] };

const AUFTRAG_LESEN = `Auf dem Foto ist ein Hot-Wheels-Auto, entweder verpackt auf der Karte oder ausgepackt.
Lies alles ab, was das Modell bestimmt: Modellname, Toy-Nummer (steht klein auf der Karte, z. B. HYW18), Sammler-Nummer (z. B. 123/250),
Serienname und Platz in der Serie (z. B. HW Dream Garage 2/5). Bei einem ausgepackten Auto steht der Name meist auf dem Unterboden.
Achtung: Die Sortimentsnummer (z. B. „Asst. HBL96“ oder senkrecht am Rand der Vorderseite) ist NICHT die Toy-Nummer.
Das Foto kann gedreht sein. Bei Car Culture und Packungen stehen die Modellnamen oft senkrecht neben dem Blister (z. B. „2018 TOYOTA 4RUNNER“).
Sind mehrere Autos in der Packung: alle Namen mit „ + “ getrennt angeben, z. B. „2018 Toyota 4Runner + Subaru Crosstrek“.
Ist die Rückseite der Karte fotografiert: Dort steht ein Code wie „JKX57-ND710 (G1) 21A“ (oft oben beim Aufhängeloch) – das ist die Toy-Nummer.
Auf der Rückseite sind oft mehrere Autos der Serie abgebildet; den Namen dann leer lassen, der Code genügt.
Bei einem Multipack (mehrere Autos in einer Packung): den Packungsnamen als Serie, z. B. „Hot Wheels RacerVerse Disney“.
Schreib nur, was du wirklich siehst; unlesbare Felder leer lassen. Erfinde keine Toy-Nummer.`;

const SCHEMA_WAHL = { type: "OBJECT", properties: {
  wahl: { type: "INTEGER", description: "Nummer des passenden Vergleichsbilds, 0 wenn keines passt" },
  sicher: { type: "BOOLEAN" } }, required: ["wahl", "sicher"] };

const jahrKurz = w => w.replace(/^(19|20)(\d\d)$/, "$2");   // „2018 Toyota 4Runner“ = „'18 Toyota 4Runner“
const aehnlich = (a, b) => {   // Anteil gemeinsamer Wörter
  const x = new Set(norm(a).split(" ").filter(Boolean).map(jahrKurz)), y = new Set(norm(b).split(" ").filter(Boolean).map(jahrKurz));
  if (!x.size || !y.size) return 0;
  let g = 0; for (const w of x) if (y.has(w)) g++;
  return g / Math.max(x.size, y.size);
};
const abstand = (a, b) => {    // Levenshtein für kurze Toy-Nummern
  if (Math.abs(a.length - b.length) > 1) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

// Antwort von Gemini → Kandidaten mit Punkten (höchste zuerst)
export function zuordnen(r, index, hinweis = "") {
  const punkte = new Map(), nachbarn = [];
  const plus = (m, p) => punkte.set(m.id, (punkte.get(m.id) || 0) + p);
  const toy = normToy(hinweis && istToy(norm(hinweis).replace(/ /g, "")) ? hinweis : r?.toy);
  if (toy.length >= 4) {
    const t = nachToyNr(toy, index);   // inkl. Korrektur von O/0, I/1 …
    for (const m of t.genau) plus(m, 100);
    for (const m of t.aehnlich) nachbarn.push(m);   // erst nach dem Namensvergleich werten
  }
  // bei Packungen liefert Gemini „Name 1 + Name 2“ – verglichen wird mit dem ersten, die Packung ergänzt die App
  const name = (r?.name || (hinweis && !toy ? hinweis : "")).split(/\s+\+\s+/)[0];
  const nr = (String(r?.sammlernr || "").match(/^\s*(\d{1,3})\s*\//) || [])[1]?.padStart(3, "0");
  const snr = parseInt((String(r?.serie_nr || "").match(/^\s*(\d+)\s*\//) || [])[1], 10);
  const farbWoerter = norm(r?.farbe).split(" ").filter(w => w.length > 2);
  // Nummern mit einem abweichenden Zeichen zählen nur, wenn der Name nicht widerspricht
  // (sonst landet eine Sortimentsnummer wie HBL96 bei einem fremden Auto)
  for (const m of nachbarn) if (!name || aehnlich(name, m.name) >= 0.5) plus(m, 45);
  // Serie bzw. Packung: Gemini liest bei Multipacks oft nur den Packungsnamen („Hot Wheels RacerVerse Disney“)
  let serienTreffer = [], besteAehnl = 0;
  for (const text of [r?.serie, r?.name].filter(t => t && norm(t).split(" ").length >= 2))
    index.serien.forEach((s, i) => {
      // „Hammer Drop“ = „Car Culture: Hammer Drop“: auch den Teil nach dem Doppelpunkt vergleichen
      const ohnePack = s.name.replace(/\s*\d+-Pack$/i, "");
      const a = Math.max(aehnlich(text, ohnePack), aehnlich(text, ohnePack.split(":").pop()));
      if (a < 0.6 || a < besteAehnl) return;
      if (a > besteAehnl) { besteAehnl = a; serienTreffer = []; }
      serienTreffer.push(i);   // nur die am besten passenden Serien
    });
  if (serienTreffer.length && serienTreffer.length <= 40)
    for (const i of serienTreffer) for (const m of index.jeSerie[i])
      plus(m, 30 + (r?.jahr && m.jahr === r.jahr ? 10 : 0) + (snr && m.snr === snr ? 25 : 0));   // Serie + Platz (2/5) passt
  const nameCache = new Map();   // Ähnlichkeit je Modellname nur einmal rechnen
  for (const m of index.modelle) {
    if (!nameCache.has(m.n)) nameCache.set(m.n, name ? aehnlich(name, m.name) : 0);
    const nameA = nameCache.get(m.n);
    if (nameA < 0.5 && !punkte.has(m.id)) continue;
    plus(m, Math.round(nameA * 40));
    if (nr && m.nr === nr) plus(m, 20);
    if (r?.serie && aehnlich(r.serie, index.serien[m.s].name) >= 0.5) plus(m, 15);
    if (snr && m.snr === snr) plus(m, 8);
    if (r?.jahr && m.jahr === r.jahr) plus(m, 10);
    const marken = m.marken || [];
    if (r?.super_treasure_hunt && marken.includes("STH")) plus(m, 15);
    else if (r?.treasure_hunt && marken.includes("TH")) plus(m, 10);
    if (!r?.super_treasure_hunt && marken.includes("STH")) plus(m, -10);
    if (farbWoerter.length && m.farbe && farbWoerter.some(w => norm(m.farbe).includes(w))) plus(m, 8);
  }
  // bei Gleichstand neuere zuerst – im Laden findet man meist aktuelle Autos
  // Packung mit mehreren Namen: die Ausführung gewinnt, deren Packungspartner (gleiche Toy-Nr. und Serie) die übrigen Namen trägt
  const weitereNamen = String(r?.name || "").split(/\s+\+\s+/).slice(1).filter(Boolean);
  if (weitereNamen.length) for (const id of punkte.keys()) {
    const m = index.modell(id), partner = m.toy ? (index.nachToy.get(m.toy) || []).filter(x => x.s === m.s && x.id !== m.id) : [];
    if (partner.some(x => weitereNamen.some(n => aehnlich(n, x.name) >= 0.5))) plus(m, 60);
  }
  return [...punkte].map(([id, p]) => ({ m: index.modell(id), p })).sort((a, b) => b.p - a.p || b.m.jahr - a.m.jahr);
}

// Rückseite der Karte: Dort steht unten klein der Code „JKX60-ND710 (G1) 21A“ – der Teil vor dem Bindestrich
// ist die Toy-Nr. und bestimmt die Ausführung (inkl. Farbe) fast immer eindeutig.
const SCHEMA_RUECKSEITE = { type: "OBJECT", properties: {
  code: { type: "STRING", description: "der ganze Code, z. B. JKX60-ND710 (G1) 21A; leer, wenn nicht lesbar" },
  toy: { type: "STRING", description: "nur der Teil vor dem Bindestrich, z. B. JKX60" },
}, required: ["code", "toy"] };
const AUFTRAG_RUECKSEITE = `Das ist die Rückseite einer Hot-Wheels-Verpackung. Irgendwo darauf steht ein Code wie „JKX60-ND710 (G1) 21A“
(manchmal auch nur „JKX60“). Er steht oft oben neben dem Aufhängeloch, manchmal unten rechts – auch SENKRECHT gedruckt am Rand –
und die Toy-Nummer steht oft zusätzlich einzeln über dem Barcode (z. B. „HRV77“). Lies diesen Code genau ab. Die Toy-Nummer ist der Teil vor dem Bindestrich: meist 3 Buchstaben und 2 Ziffern.
Achte auf Verwechslungen wie 0/O, 1/I, 5/S, 8/B. Nichts erfinden – unlesbar heisst leer.
Nicht verwechseln mit der Sortimentsnummer „Asst. HBL96“ (ohne Bindestrich-Zusatz) oder Zahlen wie 684173-A.`;

// Kandidaten zu einer gelesenen Toy-Nr.: genau, sonst mit einem abweichenden Zeichen (Lesefehler)
const ZU_BUCHSTABE = { 0: "O", 1: "I", 5: "S", 8: "B", 2: "Z", 6: "G" };
const ZU_ZIFFER = { O: "0", D: "0", Q: "0", I: "1", L: "1", S: "5", B: "8", Z: "2", G: "6" };
// übliche Verwechslungen: vorne Buchstaben, hinten Ziffern (O/0, I/1, S/5, B/8, Z/2, G/6)
const korrigiert = t => [...t.slice(0, 3)].map(c => ZU_BUCHSTABE[c] || c).join("") + [...t.slice(3)].map(c => ZU_ZIFFER[c] || c).join("");

// Kandidaten zu einem gelesenen Code. Gesucht wird jede 5-stellige Folge, die eine bekannte Toy-Nr. ist –
// egal ob Gemini „JKX59“, „JKX59-D710 (G1)“ oder „JKX59D710“ liefert. Sonst: ein abweichendes Zeichen (Lesefehler).
export function nachToyNr(text, index) {
  const roh = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const vorn = String(text || "").toUpperCase().split(/[-–\s(]/)[0].replace(/[^A-Z0-9]/g, "");
  if (roh.length < 4) return { toy: roh, genau: [], aehnlich: [] };
  for (const kandidat of [vorn, roh]) {
    if (index.nachToy.has(kandidat)) return { toy: kandidat, genau: index.nachToy.get(kandidat), aehnlich: [] };
  }
  for (let i = 0; i + 5 <= roh.length; i++) {
    const t = roh.slice(i, i + 5);
    if (index.nachToy.has(t)) return { toy: t, genau: index.nachToy.get(t), aehnlich: [] };
    const k = korrigiert(t);   // nur vermutet – die App bittet dann ums Prüfen
    if (index.nachToy.has(k)) return { toy: k, genau: index.nachToy.get(k), aehnlich: [], korrigiert: t };
  }
  const ziel = vorn.length >= 4 && vorn.length <= 6 ? vorn : roh.slice(0, 5);
  const aehnlich = [...index.nachToy].filter(([t]) => abstand(t, ziel) === 1).flatMap(([, l]) => l);
  return { toy: ziel, genau: [], aehnlich };
}
export async function rueckseite(foto, index, schluessel) {
  const bild = await alsTeil(foto, 3072);   // gross lassen: der Code ist sehr klein gedruckt
  // Versuche nacheinander, bis die Toy-Nr. eindeutig ist: Rückseiten-Auftrag, allgemeiner Auftrag (liest senkrechte
  // Codes oft besser), dann das stärkere Modell. Überlastung bei einem Versuch ist kein Abbruch.
  const versuche = [
    [AUFTRAG_RUECKSEITE, SCHEMA_RUECKSEITE, MODELL],
    [AUFTRAG_LESEN, SCHEMA_LESEN, MODELL],
    [AUFTRAG_RUECKSEITE, SCHEMA_RUECKSEITE, MODELL_STARK],
  ];
  let best = { genau: [], aehnlich: [], toy: "" }, code = "", fehler = null;
  for (const [auftrag, schema, modell] of versuche) {
    try {
      const r = await gemini(schluessel, [{ text: auftrag }, bild], schema, modell);
      const t = nachToyNr(`${r.toy || ""} ${r.code || ""}`, index);
      if (t.genau.length || (!best.genau.length && !best.aehnlich.length && t.aehnlich.length)) { best = t; code = [r.code, r.toy].filter(Boolean)[0] || ""; }
      if (!code) code = [r.code, r.toy].filter(Boolean)[0] || "";
      if (best.genau.length) break;
    } catch (e) {
      if (e.code === "kontingent" || e.code === "offline" || e.code === "schluessel") throw e;
      fehler = e;
    }
  }
  if (!best.genau.length && !best.aehnlich.length && !code && fehler) throw fehler;
  return { ...best, code };
}

// Ganze Erkennung. Ergebnis: {antwort, tipp: [ids], status: "ok"|"pruefen", anfragen}
export async function bestimme(foto, index, schluessel, fortschritt = () => {}, hinweis = "") {
  fortschritt("Gemini liest das Auto …");
  const bild = await alsTeil(foto);
  let r = await gemini(schluessel, [{ text: AUFTRAG_LESEN }, bild], SCHEMA_LESEN);
  let anfragen = 1;
  let liste = r?.ist_auto === false ? [] : zuordnen(r, index, hinweis);
  if (!liste.length || liste[0].p < 40) {   // nichts Brauchbares gelesen: einmal mit dem stärkeren Modell
    fortschritt("Lese genauer nach …");
    try {
      const r2 = await gemini(schluessel, [{ text: AUFTRAG_LESEN }, bild], SCHEMA_LESEN, MODELL_STARK); anfragen++;
      const l2 = r2?.ist_auto === false ? [] : zuordnen(r2, index, hinweis);
      if ((l2[0]?.p || 0) > (liste[0]?.p || 0) || r?.ist_auto === false) { r = r2; liste = l2; }
    } catch (e) { if (e.code === "kontingent" || e.code === "offline") throw e; }
  }
  if (r && r.ist_auto === false) return { antwort: r, tipp: [], status: "pruefen", anfragen };
  const oben = liste[0]?.p || 0, zweit = liste[1]?.p || 0;
  let status = oben >= 100 && (liste.filter(x => x.p >= 100).length === 1 || oben - zweit >= 20) ? "ok"
             : oben >= 60 && oben - zweit >= 25 ? "ok" : "pruefen";
  // Nicht eindeutig: Gemini vergleicht das Foto mit den Wiki-Bildern der besten Kandidaten
  const mitBild = liste.filter(x => x.m.bild && x.p >= oben - 40).slice(0, 6);
  if (status === "pruefen" && mitBild.length >= 2) {
    fortschritt("Vergleiche mit den Bildern aus dem Verzeichnis …");
    const refs = await Promise.all(mitBild.map(x => fetch(bildUrl(x.m.bild, 300)).then(a => a.ok ? a.blob() : null).then(b => b && alsTeil(b, 300)).catch(() => null)));
    const teile = [{ text: `Bild 0 ist ein Foto eines Hot-Wheels-Autos. Die Bilder 1 bis ${mitBild.length} stammen aus einem Katalog. ` +
      "Welches Katalogbild zeigt genau dieses Modell in derselben Farbe und Bemalung? Antworte mit der Nummer, 0 wenn keines passt." }, bild];
    refs.forEach((t, i) => { if (t) teile.push({ text: `Bild ${i + 1}:` }, t); });
    try {
      const w = await gemini(schluessel, teile, SCHEMA_WAHL); anfragen++;
      const x = mitBild[w.wahl - 1];
      if (x && refs[w.wahl - 1]) {
        liste = [x, ...liste.filter(y => y !== x)];
        if (w.sicher) status = "ok";
      }
    } catch (e) { if (e.code === "kontingent") throw e; }
  }
  return { antwort: r, tipp: liste.slice(0, 9).map(x => x.m.id), status, anfragen };
}
