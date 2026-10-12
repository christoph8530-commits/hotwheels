// Modellverzeichnis und Erkennung: Gemini liest Name, Toy-Nr. und Sammler-Nr. vom Foto,
// die App ordnet das Auto im Verzeichnis zu. Ist es nicht eindeutig, vergleicht Gemini das Foto
// mit den Wiki-Bildern der Kandidaten (zweite Anfrage).
export const MODELL = "gemini-flash-lite-latest";   // Alias: rückt automatisch auf die neueste Version nach
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
  ist_auto: { type: "BOOLEAN" },
  verpackt: { type: "BOOLEAN", description: "true, wenn das Auto noch in der Blisterverpackung auf der Karte steckt" },
  name: { type: "STRING", description: "Modellname wie auf Karte oder Unterboden, z. B. '69 Dodge Charger" },
  toy: { type: "STRING", description: "Toy-Nummer, meist 3 Buchstaben + 2 Ziffern wie HYW18; leer, wenn nicht lesbar" },
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
Schreib nur, was du wirklich siehst; unlesbare Felder leer lassen. Erfinde keine Toy-Nummer.`;

const SCHEMA_WAHL = { type: "OBJECT", properties: {
  wahl: { type: "INTEGER", description: "Nummer des passenden Vergleichsbilds, 0 wenn keines passt" },
  sicher: { type: "BOOLEAN" } }, required: ["wahl", "sicher"] };

const aehnlich = (a, b) => {   // Anteil gemeinsamer Wörter
  const x = new Set(norm(a).split(" ").filter(Boolean)), y = new Set(norm(b).split(" ").filter(Boolean));
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
  const punkte = new Map();
  const plus = (m, p) => punkte.set(m.id, (punkte.get(m.id) || 0) + p);
  const toy = normToy(hinweis && istToy(norm(hinweis).replace(/ /g, "")) ? hinweis : r?.toy);
  if (toy.length >= 4) {
    for (const m of index.nachToy.get(toy) || []) plus(m, 100);
    if (!punkte.size) for (const [t, l] of index.nachToy) if (abstand(t, toy) === 1) for (const m of l) plus(m, 45);
  }
  const name = r?.name || (hinweis && !toy ? hinweis : "");
  const nr = (String(r?.sammlernr || "").match(/^\s*(\d{1,3})\s*\//) || [])[1]?.padStart(3, "0");
  const snr = parseInt((String(r?.serie_nr || "").match(/^\s*(\d+)\s*\//) || [])[1], 10);
  const farbWoerter = norm(r?.farbe).split(" ").filter(w => w.length > 2);
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
  return [...punkte].map(([id, p]) => ({ m: index.modell(id), p })).sort((a, b) => b.p - a.p || b.m.jahr - a.m.jahr);
}

// Ganze Erkennung. Ergebnis: {antwort, tipp: [ids], status: "ok"|"pruefen", anfragen}
export async function bestimme(foto, index, schluessel, fortschritt = () => {}, hinweis = "") {
  fortschritt("Gemini liest das Auto …");
  const bild = await alsTeil(foto);
  const r = await gemini(schluessel, [{ text: AUFTRAG_LESEN }, bild], SCHEMA_LESEN);
  let anfragen = 1;
  if (r && r.ist_auto === false) return { antwort: r, tipp: [], status: "pruefen", anfragen };
  let liste = zuordnen(r, index, hinweis);
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
