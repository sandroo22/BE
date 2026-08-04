const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const JWT_SECRET = "Catania10!"; 

app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const upload = multer({ storage: storage });

const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: 'root',     
    password: ''     
});

// --- NUOVA CONNESSIONE CON AUTO-CREAZIONE TABELLE ---
db.connect((err) => {
    if (err) {
        console.error("Errore di connessione a MySQL:", err);
        return;
    }
    console.log("Connesso al server MySQL!");

    db.query("CREATE DATABASE IF NOT EXISTS film_db", (err) => {
        if (err) throw err;
        db.query("USE film_db", (err) => {
            if (err) throw err;
            
            const queryUtenti = `CREATE TABLE IF NOT EXISTS utenti (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL
            )`;
            
            const queryListe = `CREATE TABLE IF NOT EXISTS liste (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(255) NOT NULL,
                utente_id INT NOT NULL,
                is_default BOOLEAN DEFAULT FALSE,
                FOREIGN KEY (utente_id) REFERENCES utenti(id) ON DELETE CASCADE
            )`;
            
            const queryFilm = `CREATE TABLE IF NOT EXISTS film (
                id INT AUTO_INCREMENT PRIMARY KEY,
                testo VARCHAR(255) NOT NULL,
                copertina VARCHAR(255),
                visto BOOLEAN DEFAULT FALSE,
                rating INT DEFAULT 0,
                utente_id INT NOT NULL,
                lista_id INT,
                FOREIGN KEY (utente_id) REFERENCES utenti(id) ON DELETE CASCADE,
                FOREIGN KEY (lista_id) REFERENCES liste(id) ON DELETE SET NULL
            )`;

            const queryAttori = `CREATE TABLE IF NOT EXISTS attori (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome_cognome VARCHAR(255) NOT NULL,
                ruolo VARCHAR(255),
                film_id INT NOT NULL,
                FOREIGN KEY (film_id) REFERENCES film(id) ON DELETE CASCADE
            )`;

            const queryTags = `CREATE TABLE IF NOT EXISTS tags (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(50) UNIQUE NOT NULL,
                colore VARCHAR(20) DEFAULT '#3b82f6'
            )`;

            const queryFilmTags = `CREATE TABLE IF NOT EXISTS film_tags (
                film_id INT NOT NULL,
                tag_id INT NOT NULL,
                PRIMARY KEY (film_id, tag_id),
                FOREIGN KEY (film_id) REFERENCES film(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )`;

            // Eseguiamo le query in sequenza per rispettare le dipendenze delle chiavi esterne
            db.query(queryUtenti, () => {
                db.query(queryListe, () => {
                    db.query(queryFilm, () => {
                        db.query(queryAttori, () => {
                            db.query(queryTags, () => {
                                db.query(queryFilmTags, () => {
                                    console.log("Tabelle verificate/create con successo!");
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});
// ----------------------------------------------------

const autenticaToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) return res.status(401).json({ errore: "Accesso negato, token mancante" });

    jwt.verify(token, JWT_SECRET, (err, utenteDecodificato) => {
        if (err) return res.status(403).json({ errore: "Token non valido o scaduto" });
        req.utente = utenteDecodificato; 
        next();
    });
};

// --- ROTTE UTENTI ---
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ errore: "Campi incompleti" });
    try {
        const salt = await bcrypt.genSalt(10);
        const passwordCriptata = await bcrypt.hash(password, salt);
        
        db.query("INSERT INTO utenti (email, password) VALUES (?, ?)", [email, passwordCriptata], async (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ errore: "Questa email esiste già!" });
                return res.status(500).json({ errore: err.message });
            }
            
            // CREIAMO LA LISTA DI DEFAULT PER IL NUOVO UTENTE
            const nuovoUtenteId = result.insertId;
            await db.promise().query(
                "INSERT INTO liste (nome, utente_id, is_default) VALUES (?, ?, TRUE)", 
                ["Generale", nuovoUtenteId]
            );

            res.json({ messaggio: "Utente registrato con successo!" });
        });
    } catch (errore) {
        res.status(500).json({ errore: "Errore nel server" });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.query("SELECT * FROM utenti WHERE email = ?", [email], async (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        if (results.length === 0) return res.status(400).json({ errore: "Utente non trovato" });

        const utenteUtile = results[0];
        try {
            const passwordCorretta = await bcrypt.compare(password, utenteUtile.password);
            if (!passwordCorretta) return res.status(400).json({ errore: "Password errata" });

            // --- CONTROLLO RETROCOMPATIBILITÀ (Crea lista default ai vecchi utenti) ---
            const [liste] = await db.promise().query("SELECT id FROM liste WHERE utente_id = ? AND is_default = TRUE", [utenteUtile.id]);
            let defaultListId;
            if (liste.length === 0) {
                const [nuovaLista] = await db.promise().query("INSERT INTO liste (nome, utente_id, is_default) VALUES (?, ?, TRUE)", ["Generale", utenteUtile.id]);
                defaultListId = nuovaLista.insertId;
            } else {
                defaultListId = liste[0].id;
            }
            // Aggiorna i vecchi film senza cartella inserendoli in Generale
            await db.promise().query("UPDATE film SET lista_id = ? WHERE utente_id = ? AND lista_id IS NULL", [defaultListId, utenteUtile.id]);
            // --------------------------------------------------------------------------

            const token = jwt.sign({ id: utenteUtile.id, email: utenteUtile.email }, JWT_SECRET, { expiresIn: '365d' });
            return res.json({ token });
        } catch (erroreProcesso) {
            return res.status(500).json({ errore: "Errore interno del server" });
        }
    });
});

// --- ROTTE LISTE ---
app.get('/api/liste', autenticaToken, (req, res) => {
    db.query("SELECT * FROM liste WHERE utente_id = ?", [req.utente.id], (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        res.json(results);
    });
});

app.post('/api/liste', autenticaToken, (req, res) => {
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ errore: "Il nome della lista è obbligatorio" });
    db.query("INSERT INTO liste (nome, utente_id, is_default) VALUES (?, ?, FALSE)", [nome, req.utente.id], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        res.status(201).json({ message: "Lista creata", id: result.insertId });
    });
});

app.put('/api/liste/:id', autenticaToken, async (req, res) => {
    const { nome } = req.body;
    const listaId = req.params.id;
    try {
        const [lista] = await db.promise().query("SELECT is_default FROM liste WHERE id = ? AND utente_id = ?", [listaId, req.utente.id]);
        if (lista.length === 0) return res.status(404).json({ errore: "Lista non trovata" });
        if (lista[0].is_default) return res.status(403).json({ errore: "Non puoi rinominare la lista Generale" });

        await db.promise().query("UPDATE liste SET nome = ? WHERE id = ? AND utente_id = ?", [nome, listaId, req.utente.id]);
        res.json({ message: "Lista rinominata con successo" });
    } catch (err) {
        res.status(500).json({ errore: err.message });
    }
});

app.delete('/api/liste/:id', autenticaToken, async (req, res) => {
    const listaId = req.params.id;
    try {
        const [lista] = await db.promise().query("SELECT is_default FROM liste WHERE id = ? AND utente_id = ?", [listaId, req.utente.id]);
        if (lista.length === 0) return res.status(404).json({ errore: "Lista non trovata" });
        if (lista[0].is_default) return res.status(403).json({ errore: "Non puoi eliminare la lista Generale" });

        const [defaultList] = await db.promise().query("SELECT id FROM liste WHERE utente_id = ? AND is_default = TRUE", [req.utente.id]);
        
        // Travasiamo i film nella lista generale
        await db.promise().query("UPDATE film SET lista_id = ? WHERE lista_id = ? AND utente_id = ?", [defaultList[0].id, listaId, req.utente.id]);
        // Eliminiamo la lista vuota
        await db.promise().query("DELETE FROM liste WHERE id = ? AND utente_id = ?", [listaId, req.utente.id]);

        res.json({ message: "Lista eliminata e film spostati in Generale" });
    } catch (err) {
        res.status(500).json({ errore: err.message });
    }
});

// --- ROTTE FILM ---
app.get('/api/film', autenticaToken, (req, res) => {
    db.query("SELECT * FROM film WHERE utente_id = ?", [req.utente.id], (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        res.json(results);
    });
});

app.post('/api/film', autenticaToken, upload.single('copertina'), async (req, res) => {
    const nuovoTitolo = req.body.testo;
    let urlImmagine = null;
    let listaIdTarget = req.body.lista_id; 

    if (req.file) urlImmagine = `http://localhost:5000/uploads/${req.file.filename}`;
    else if (req.body.copertina) urlImmagine = req.body.copertina;
    
    if (!nuovoTitolo) return res.status(400).json({ errore: "Il titolo non può essere vuoto" });

    try {
        // Se non viene specificata una lista, lo mettiamo nella lista Generale
        if (!listaIdTarget || listaIdTarget === 'null' || listaIdTarget === 'undefined') {
            const [defaultList] = await db.promise().query("SELECT id FROM liste WHERE utente_id = ? AND is_default = TRUE", [req.utente.id]);
            listaIdTarget = defaultList[0].id;
        }

        await db.promise().query(
            "INSERT INTO film (testo, copertina, utente_id, lista_id) VALUES (?, ?, ?, ?)", 
            [nuovoTitolo, urlImmagine, req.utente.id, listaIdTarget]
        );

        const [results] = await db.promise().query("SELECT * FROM film WHERE utente_id = ?", [req.utente.id]);
        res.json(results);
    } catch (err) {
        res.status(500).json({ errore: err.message });
    }
});

app.put('/api/film/:id', autenticaToken, (req, res) => {
    const idDaModificare = req.params.id;
    const { testo, lista_id } = req.body; 

    let query = "UPDATE film SET testo = ?";
    let queryParams = [testo];

    if (lista_id) {
        query += ", lista_id = ?";
        queryParams.push(lista_id);
    }

    query += " WHERE id = ? AND utente_id = ?";
    queryParams.push(idDaModificare, req.utente.id);

    db.query(query, queryParams, (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        db.query("SELECT * FROM film WHERE utente_id = ?", [req.utente.id], (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});

app.patch('/api/film/:id/visto', autenticaToken, (req, res) => {
    const idDaModificare = req.params.id;
    const nuovoStato = req.body.visto; 
    db.query("UPDATE film SET visto = ? WHERE id = ? AND utente_id = ?", [nuovoStato, idDaModificare, req.utente.id], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        db.query("SELECT * FROM film WHERE utente_id = ?", [req.utente.id], (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});

app.patch('/api/film/:id/rating', autenticaToken, (req, res) => {
    const idDaModificare = req.params.id;
    const nuovoVoto = req.body.rating; 
    db.query("UPDATE film SET rating = ? WHERE id = ? AND utente_id = ?", [nuovoVoto, idDaModificare, req.utente.id], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        db.query("SELECT * FROM film WHERE utente_id = ?", [req.utente.id], (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});

app.delete('/api/film/:id', autenticaToken, (req, res) => {
    const idDaEliminare = req.params.id;
    db.query("DELETE FROM film WHERE id = ? AND utente_id = ?", [idDaEliminare, req.utente.id], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        db.query("SELECT * FROM film WHERE utente_id = ?", [req.utente.id], (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});


// --- ROTTE ATTORI ---
app.get('/api/film/:filmId/attori', autenticaToken, (req, res) => {
    const filmId = req.params.filmId;
    db.query("SELECT * FROM film WHERE id = ? AND utente_id = ?", [filmId, req.utente.id], (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        if (results.length === 0) return res.status(403).json({ errore: "Accesso negato" });
        db.query("SELECT * FROM attori WHERE film_id = ?", [filmId], (err, attori) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(attori);
        });
    });
});

app.post('/api/film/:filmId/attori', autenticaToken, (req, res) => {
    const filmId = req.params.filmId;
    const { nome_cognome, ruolo } = req.body; 
    db.query("SELECT * FROM film WHERE id = ? AND utente_id = ?", [filmId, req.utente.id], (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        if (results.length === 0) return res.status(403).json({ errore: "Accesso negato" });
        db.query("INSERT INTO attori (nome_cognome, ruolo, film_id) VALUES (?, ?, ?)", [nome_cognome, ruolo || null, filmId], (err, result) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.status(201).json({ message: "Attore salvato con successo" });
        });
    });
});


// --- ROTTE TAG ---
app.get('/api/film/:id/tags', autenticaToken, async (req, res) => {
    const filmId = req.params.id;
    try {
        const [checkFilm] = await db.promise().query("SELECT id FROM film WHERE id = ? AND utente_id = ?", [filmId, req.utente.id]);
        if (checkFilm.length === 0) return res.status(403).json({ error: "Accesso negato al film" });

        const [tags] = await db.promise().query(
            `SELECT t.id, t.nome, t.colore 
             FROM tags t
             JOIN film_tags ft ON t.id = ft.tag_id
             WHERE ft.film_id = ?`, 
            [filmId]
        );
        res.json(tags);
    } catch (err) {
        console.error("Errore recupero tag:", err);
        res.status(500).json({ error: "Errore interno del server" });
    }
});

app.post('/api/film/:id/tags', autenticaToken, async (req, res) => {
    const filmId = req.params.id;
    const { nome_tag, colore } = req.body; 

    if (!nome_tag) {
        return res.status(400).json({ error: "Il nome del tag è obbligatorio" });
    }

    try {
        const [checkFilm] = await db.promise().query("SELECT id FROM film WHERE id = ? AND utente_id = ?", [filmId, req.utente.id]);
        if (checkFilm.length === 0) return res.status(403).json({ error: "Accesso negato al film" });

        const [tagEsistente] = await db.promise().query(
            "SELECT id FROM tags WHERE nome = ?", [nome_tag]
        );

        let tagId;

        if (tagEsistente.length > 0) {
            tagId = tagEsistente[0].id;
        } else {
            const coloreTag = colore || '#3b82f6'; 
            const [nuovoTag] = await db.promise().query(
                "INSERT INTO tags (nome, colore) VALUES (?, ?)", 
                [nome_tag, coloreTag]
            );
            tagId = nuovoTag.insertId;
        }

        await db.promise().query(
            "INSERT IGNORE INTO film_tags (film_id, tag_id) VALUES (?, ?)",
            [filmId, tagId]
        );

        res.status(201).json({ message: "Tag salvato e associato con successo!", tag_id: tagId });
    } catch (err) {
        console.error("Errore salvataggio tag:", err);
        res.status(500).json({ error: "Errore interno del server" });
    }
});

app.delete('/api/film/:filmId/tags/:tagId', autenticaToken, async (req, res) => {
    const filmId = req.params.filmId;
    const tagId = req.params.tagId;

    try {
        const [checkFilm] = await db.promise().query("SELECT id FROM film WHERE id = ? AND utente_id = ?", [filmId, req.utente.id]);
        if (checkFilm.length === 0) return res.status(403).json({ error: "Accesso negato al film" });

        await db.promise().query(
            "DELETE FROM film_tags WHERE film_id = ? AND tag_id = ?",
            [filmId, tagId]
        );

        res.json({ message: "Tag rimosso dal film con successo!" });
    } catch (err) {
        console.error("Errore rimozione tag:", err);
        res.status(500).json({ error: "Errore interno del server" });
    }
});

// --- EXPORT JSON ---
app.get('/api/export', autenticaToken, async (req, res) => {
    try {
        // 1. Prendiamo tutte le liste dell'utente loggato
        const [liste] = await db.promise().query("SELECT nome, is_default FROM liste WHERE utente_id = ?", [req.utente.id]);
        // 2. Prendiamo tutti i film e associamo il NOME della loro lista
        const [film] = await db.promise().query(`
            SELECT f.testo, f.copertina, f.visto, f.rating, l.nome as lista_nome
            FROM film f
            LEFT JOIN liste l ON f.lista_id = l.id
            WHERE f.utente_id = ?
        `, [req.utente.id]);
        
        // Inviamo il pacchetto JSON completo
        res.json({ liste, film });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Errore durante l'esportazione." });
    }
});

// --- IMPORT JSON ---
app.post('/api/import', autenticaToken, async (req, res) => {
    const { liste, film } = req.body;
    if (!liste || !film) return res.status(400).json({ error: "Formato JSON non valido." });

    try {
        // Inizia la transazione (così se c'è un errore, annulla tutto senza rompere il DB)
        await db.promise().beginTransaction();

        // 1. Elimina i film e le liste attuali dell'UTENTE LOGGATO (tranne la lista Generale di default)
        await db.promise().query("DELETE FROM film WHERE utente_id = ?", [req.utente.id]);
        await db.promise().query("DELETE FROM liste WHERE utente_id = ? AND is_default = FALSE", [req.utente.id]);

        // 2. Ricrea le liste dal JSON
        for (const l of liste) {
            if (!l.is_default) {
                await db.promise().query("INSERT IGNORE INTO liste (nome, utente_id, is_default) VALUES (?, ?, FALSE)", [l.nome, req.utente.id]);
            }
        }

        // 3. Riprendiamo i nuovi ID delle liste appena create (per mapparli correttamente)
        const [listeAttuali] = await db.promise().query("SELECT id, nome, is_default FROM liste WHERE utente_id = ?", [req.utente.id]);
        const mappaListe = {};
        let defaultListId = null;
        listeAttuali.forEach(l => {
            mappaListe[l.nome] = l.id;
            if (l.is_default) defaultListId = l.id;
        });

        // 4. Inseriamo tutti i film, riassegnandoli alla lista corretta
        for (const f of film) {
            const lista_id = mappaListe[f.lista_nome] || defaultListId;
            await db.promise().query(
                "INSERT INTO film (testo, copertina, visto, rating, utente_id, lista_id) VALUES (?, ?, ?, ?, ?, ?)",
                [f.testo, f.copertina || null, f.visto || false, f.rating || 0, req.utente.id, lista_id]
            );
        }

        // Se tutto è andato bene, conferma i cambiamenti!
        await db.promise().commit();
        res.json({ message: "Importazione completata!" });
    } catch (err) {
        // In caso di errore, rollback annulla tutte le modifiche fatte finora!
        await db.promise().rollback();
        console.error(err);
        res.status(500).json({ error: "Errore durante l'importazione." });
    }
});

app.listen(PORT, () => {
    console.log(`Server attivo sulla porta ${PORT}`);
});