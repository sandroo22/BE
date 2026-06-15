const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');

const app = express();
const PORT = 5000;

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

            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS film (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    testo VARCHAR(255) NOT NULL,
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `;
            
            db.query(createTableQuery, (err) => {
                if (err) throw err;
                console.log("Tabella 'film' pronta all'uso!");
            });
        });
    });
});

// GET
app.get('/api/film', (req, res) => {
    db.query("SELECT * FROM film", (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        res.json(results);
    });
});

// POST
app.post('/api/film', (req, res) => {
    const nuovoTitolo = req.body.testo;
    if (!nuovoTitolo) return res.status(400).json({ errore: "Il titolo non può essere vuoto" });

    db.query("INSERT INTO film (testo) VALUES (?)", [nuovoTitolo], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        
        db.query("SELECT * FROM film", (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});

// PUT 
app.put('/api/film/:id', (req, res) => {
    const idDaModificare = req.params.id;
    const nuovoTitolo = req.body.testo;

    db.query("UPDATE film SET testo = ? WHERE id = ?", [nuovoTitolo, idDaModificare], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });

        db.query("SELECT * FROM film", (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});

// DELETE
app.delete('/api/film/:id', (req, res) => {
    const idDaEliminare = req.params.id;

    db.query("DELETE FROM film WHERE id = ?", [idDaEliminare], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        
        db.query("SELECT * FROM film", (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server attivo sulla porta ${PORT}`);
});