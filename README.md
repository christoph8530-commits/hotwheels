# Hot-Wheels-Sammlung (Web-App)

Persönliche Handy-App für eine Hot-Wheels-Sammlung: Sammlung, Serien-Fortschritt, Fehlliste und Autos per Foto prüfen.

- **Keine Sammlungsdaten in diesem Repo.** Die Sammlung liegt in einem privaten Repo; die App liest und schreibt sie über die GitHub-API mit einem Zugangsschlüssel, der nur im Browser des Geräts gespeichert wird.
- **Erkennung:** Gemini (eigener API-Schlüssel, ebenfalls nur auf dem Gerät) liest Name, Toy-Nr. und Sammler-Nr.; die App ordnet das Auto im Verzeichnis zu und vergleicht bei Mehrdeutigkeit mit den Wiki-Bildern.
- **Modelldaten und Bilder:** [Hot Wheels Wiki](https://hotwheels.fandom.com) (Inhalte unter CC BY-SA). `daten/modell-index.json` ist aus den Jahreslisten des Wikis erzeugt.

Dieses Repo wird aus dem Ordner `webapp/` des privaten Repos veröffentlicht; Änderungen dort machen, nicht hier.
