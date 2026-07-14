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

// Creazione cartella 'uploads' se non esiste
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

//  Rendi pubblica la cartella 'uploads' (così React può vedere le immagini via URL)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

//  Configura Multer (dove salvare i file e come chiamarli)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        // Aggiunge un timestamp al nome del file per evitare doppioni
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const upload = multer({ storage: storage });
// --------------------------------------


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
                    
                    db.query("SHOW COLUMNS FROM film LIKE 'copertina'", (err, result) => {
                        if (err) throw err;
                        if (result.length === 0) {
                            db.query("ALTER TABLE film ADD COLUMN copertina VARCHAR(1000)", (err) => {
                                if (err) throw err;
                                console.log("Colonna 'copertina' aggiunta con successo!");
                            });
                        }
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

// REGISTRAZIONE
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ errore: "Campi incompleti" });

    try {
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
            const passwordCorretta = await bcrypt.compare(password, utenteUtile.password);
            if (!passwordCorretta) return res.status(400).json({ errore: "Password errata" });

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

// POST (AGGIORNATO PER ACCETTARE FILE)
app.post('/api/film', autenticaToken, upload.single('copertina'), (req, res) => {
    const nuovoTitolo = req.body.testo;
    
    // Controlliamo se è stato inviato un file fisicamente
    let urlImmagine = null;
    if (req.file) {
        // Se c'è il file, creiamo il link diretto per vederlo dal frontend
        urlImmagine = `http://localhost:5000/uploads/${req.file.filename}`;
    } else if (req.body.copertina) {
        // Fallback: se ha incollato un link di internet, manteniamo quello vecchio
        urlImmagine = req.body.copertina;
    }
    
    if (!nuovoTitolo) return res.status(400).json({ errore: "Il titolo non può essere vuoto" });

    db.query("INSERT INTO film (testo, copertina, utente_id) VALUES (?, ?, ?)", [nuovoTitolo, urlImmagine, req.utente.id], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        
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