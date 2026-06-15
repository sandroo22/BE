const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const JWT_SECRET = "Catania10!"; 

app.use(cors());
app.use(express.json());

// Connessione a MySQL
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

            db.query("DROP TABLE IF EXISTS film", (err) => {
    if (err) console.error(err);
    console.log("Vecchia tabella eliminata!");
});

            // tabella utenti 
            const createUtentiTable = `
                CREATE TABLE IF NOT EXISTS utenti (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL UNIQUE,
                    password VARCHAR(255) NOT NULL
                )
            `;
            db.query(createUtentiTable, (err) => {
                if (err) throw err;
                console.log("Tabella 'utenti' pronta.");
            
            // tabella film
                const createFilmTable = `
                    CREATE TABLE IF NOT EXISTS film (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        testo VARCHAR(255) NOT NULL,
                        utente_id INT NOT NULL,
                        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        FOREIGN KEY (utente_id) REFERENCES utenti(id) ON DELETE CASCADE
                    )
                `;
                db.query(createFilmTable, (err) => {
                    if (err) throw err;
                    console.log("Tabella 'film' pronta.");
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

// REGISTRAZIONE
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ errore: "Campi incompleti" });

    try {
        // Criptia la password prima di salvarla
        const salt = await bcrypt.genSalt(10);
        const passwordCriptata = await bcrypt.hash(password, salt);

        db.query("INSERT INTO utenti (username, password) VALUES (?, ?)", [username, passwordCriptata], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ errore: "Questo username esiste già!" });
                return res.status(500).json({ errore: err.message });
            }
            res.json({ messaggio: "Utente registrato con successo!" });
        });
    } catch (errore) {
        res.status(500).json({ errore: "Errore nel server" });
    }
});

// LOGIN
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    db.query("SELECT * FROM utenti WHERE username = ?", [username], async (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        if (results.length === 0) return res.status(400).json({ errore: "Utente non trovato" });

        const utenteUtile = results[0];

        try {
            // Confronta la password inserita con quella criptata nel DB
            const passwordCorretta = await bcrypt.compare(password, utenteUtile.password);
            if (!passwordCorretta) return res.status(400).json({ errore: "Password errata" });

            // Genera il Token JWT inserendo l'ID dell'utente al suo interno
            const token = jwt.sign({ id: utenteUtile.id, username: utenteUtile.username }, JWT_SECRET, { expiresIn: '24h' });
            
            return res.json({ token });
        } catch (erroreProcesso) {
            console.error("Errore nel processo di login:", erroreProcesso);
            return res.status(500).json({ errore: "Errore interno del server durante l'autenticazione" });
        }
    });
});

// GET
app.get('/api/film', autenticaToken, (req, res) => {
    db.query("SELECT * FROM film WHERE utente_id = ?", [req.utente.id], (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        res.json(results);
    });
});

// POST 
app.post('/api/film', autenticaToken, (req, res) => {
    const nuovoTitolo = req.body.testo;
    if (!nuovoTitolo) return res.status(400).json({ errore: "Il titolo non può essere vuoto" });

    db.query("INSERT INTO film (testo, utente_id) VALUES (?, ?)", [nuovoTitolo, req.utente.id], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        
        // Ritorna la lista aggiornata solo dei film di questo utente
        db.query("SELECT * FROM film WHERE utente_id = ?", [req.utente.id], (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});

// PUT
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

// DELETE
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

app.listen(PORT, () => {
    console.log(`Server attivo sulla porta ${PORT}`);
});