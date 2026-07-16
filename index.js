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
    host: 'localhost',
    user: 'root',     
    password: ''     
});

db.connect((err) => {
    if (err) {
        console.error("Errore di connessione a MySQL:", err);
        return;
    }
    console.log("Connesso al server MySQL!");

    db.query("CREATE DATABASE IF NOT EXISTS film_db", (err) => {
        if (err) throw err;
        console.log("Database 'film_db' pronto.");

        db.query("USE film_db", (err) => {
            if (err) throw err;

            const createUtentiTable = `
                CREATE TABLE IF NOT EXISTS utenti (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    email VARCHAR(255) NOT NULL UNIQUE,
                    password VARCHAR(255) NOT NULL
                )
            `;
            db.query(createUtentiTable, (err) => {
                if (err) throw err;
                
                db.query("SHOW COLUMNS FROM utenti LIKE 'username'", (err, result) => {
                    if (err) throw err;
                    if (result.length > 0) {
                        db.query("ALTER TABLE utenti CHANGE username email VARCHAR(255) NOT NULL UNIQUE", (err) => {
                            if (err) throw err;
                        });
                    }
                });
            
                const createFilmTable = `
                    CREATE TABLE IF NOT EXISTS film (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        testo VARCHAR(255) NOT NULL,
                        copertina VARCHAR(1000),
                        visto BOOLEAN DEFAULT FALSE,
                        utente_id INT NOT NULL,
                        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        FOREIGN KEY (utente_id) REFERENCES utenti(id) ON DELETE CASCADE
                    )
                `;
                db.query(createFilmTable, (err) => {
                    if (err) throw err;
                    
                    db.query("SHOW COLUMNS FROM film LIKE 'copertina'", (err, result) => {
                        if (err) throw err;
                        if (result.length === 0) {
                            db.query("ALTER TABLE film ADD COLUMN copertina VARCHAR(1000)", (err) => {});
                        }
                    });

                    db.query("SHOW COLUMNS FROM film LIKE 'visto'", (err, result) => {
                        if (err) throw err;
                        if (result.length === 0) {
                            db.query("ALTER TABLE film ADD COLUMN visto BOOLEAN DEFAULT FALSE", (err) => {});
                        }
                    });

                    // NUOVO: Creazione tabella ATTORI (1-a-Molti col film)
                    const createAttoriTable = `
                        CREATE TABLE IF NOT EXISTS attori (
                            id INT AUTO_INCREMENT PRIMARY KEY,
                            nome_cognome VARCHAR(255) NOT NULL,
                            film_id INT NOT NULL,
                            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (film_id) REFERENCES film(id) ON DELETE CASCADE
                        )
                    `;
                    db.query(createAttoriTable, (err) => {
                        if (err) throw err;
                        console.log("Tabella 'attori' pronta.");
                    });
                });
            });
        });
    });
});

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

app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ errore: "Campi incompleti" });

    try {
        const salt = await bcrypt.genSalt(10);
        const passwordCriptata = await bcrypt.hash(password, salt);

        db.query("INSERT INTO utenti (email, password) VALUES (?, ?)", [email, passwordCriptata], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ errore: "Questa email esiste già!" });
                return res.status(500).json({ errore: err.message });
            }
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

            const token = jwt.sign({ id: utenteUtile.id, email: utenteUtile.email }, JWT_SECRET, { expiresIn: '24h' });
            return res.json({ token });
        } catch (erroreProcesso) {
            return res.status(500).json({ errore: "Errore interno del server" });
        }
    });
});

app.get('/api/film', autenticaToken, (req, res) => {
    db.query("SELECT * FROM film WHERE utente_id = ?", [req.utente.id], (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        res.json(results);
    });
});

app.post('/api/film', autenticaToken, upload.single('copertina'), (req, res) => {
    const nuovoTitolo = req.body.testo;
    let urlImmagine = null;
    if (req.file) urlImmagine = `http://localhost:5000/uploads/${req.file.filename}`;
    else if (req.body.copertina) urlImmagine = req.body.copertina;
    
    if (!nuovoTitolo) return res.status(400).json({ errore: "Il titolo non può essere vuoto" });

    db.query("INSERT INTO film (testo, copertina, utente_id) VALUES (?, ?, ?)", [nuovoTitolo, urlImmagine, req.utente.id], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        db.query("SELECT * FROM film WHERE utente_id = ?", [req.utente.id], (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});

app.put('/api/film/:id', autenticaToken, (req, res) => {
    const idDaModificare = req.params.id;
    const nuovoTitolo = req.body.testo;
    db.query("UPDATE film SET testo = ? WHERE id = ? AND utente_id = ?", [nuovoTitolo, idDaModificare, req.utente.id], (err, result) => {
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

// --- NUOVE ROTTE PER GLI ATTORI ---

// 1. Ottieni gli attori di un film specifico
app.get('/api/film/:filmId/attori', autenticaToken, (req, res) => {
    const filmId = req.params.filmId;
    
    // Controlliamo che il film appartenga davvero all'utente loggato (Sicurezza!)
    db.query("SELECT * FROM film WHERE id = ? AND utente_id = ?", [filmId, req.utente.id], (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        if (results.length === 0) return res.status(403).json({ errore: "Accesso negato a questo film" });

        db.query("SELECT * FROM attori WHERE film_id = ?", [filmId], (err, attori) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(attori);
        });
    });
});

// 2. Aggiungi un nuovo attore a un film
app.post('/api/film/:filmId/attori', autenticaToken, (req, res) => {
    const filmId = req.params.filmId;
    const { nome_cognome } = req.body;

    if (!nome_cognome) return res.status(400).json({ errore: "Il nome dell'attore è obbligatorio" });

    db.query("SELECT * FROM film WHERE id = ? AND utente_id = ?", [filmId, req.utente.id], (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        if (results.length === 0) return res.status(403).json({ errore: "Accesso negato" });

        db.query("INSERT INTO attori (nome_cognome, film_id) VALUES (?, ?)", [nome_cognome, filmId], (err, result) => {
            if (err) return res.status(500).json({ errore: err.message });
            
            // Restituisci la lista aggiornata degli attori
            db.query("SELECT * FROM attori WHERE film_id = ?", [filmId], (err, attori) => {
                if (err) return res.status(500).json({ errore: err.message });
                res.json(attori);
            });
        });
    });
});

// 3. Elimina un attore (bonus per un lavoro ben fatto)
app.delete('/api/attori/:id', autenticaToken, (req, res) => {
    const attoreId = req.params.id;

    const query = `
        DELETE attori FROM attori 
        JOIN film ON attori.film_id = film.id 
        WHERE attori.id = ? AND film.utente_id = ?
    `;
    
    db.query(query, [attoreId, req.utente.id], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        res.json({ messaggio: "Attore eliminato con successo" });
    });
});

app.listen(PORT, () => {
    console.log(`Server attivo sulla porta ${PORT}`);
});