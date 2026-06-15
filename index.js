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

    db.query("CREATE DATABASE IF NOT EXISTS todo_db", (err) => {
        if (err) throw err;
        console.log("Database 'todo_db' pronto.");

        db.query("USE todo_db", (err) => {
            if (err) throw err;

            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS attivita (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    testo VARCHAR(255) NOT NULL,
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `;
            
            db.query(createTableQuery, (err) => {
                if (err) throw err;
                console.log("Tabella 'attivita' pronta all'uso!");
            });
        });
    });
});

// GET 
app.get('/api/attivita', (req, res) => {
    db.query("SELECT * FROM attivita", (err, results) => {
        if (err) return res.status(500).json({ errore: err.message });
        res.json(results);
    });
});

//POST
app.post('/api/attivita', (req, res) => {
    const nuovoTesto = req.body.testo;
    if (!nuovoTesto) return res.status(400).json({ errore: "Il testo non può essere vuoto" });


    db.query("INSERT INTO attivita (testo) VALUES (?)", [nuovoTesto], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        
        db.query("SELECT * FROM attivita", (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});

// PUT
app.put('/api/attivita/:id', (req, res) => {
    const idDaModificare = req.params.id;
    const nuovoTesto = req.body.testo;


    db.query("UPDATE attivita SET testo = ? WHERE id = ?", [nuovoTesto, idDaModificare], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });


        db.query("SELECT * FROM attivita", (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});

// DELETE
app.delete('/api/attivita/:id', (req, res) => {
    const idDaEliminare = req.params.id;

    db.query("DELETE FROM attivita WHERE id = ?", [idDaEliminare], (err, result) => {
        if (err) return res.status(500).json({ errore: err.message });
        
        db.query("SELECT * FROM attivita", (err, results) => {
            if (err) return res.status(500).json({ errore: err.message });
            res.json(results);
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server attivo sulla porta ${PORT}`);
});