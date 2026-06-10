const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

let listaAttivita = [
    { id: 1, testo: "andare a fare la spesa", createdAt: new Date(), updatedAt: new Date() },
    { id: 2, testo: "comprare il latte", createdAt: new Date(), updatedAt: new Date() },
    { id: 3, testo: "comprare il pane", createdAt: new Date(), updatedAt: new Date() }
];

app.get('/api/attivita', (req, res) => {
    res.json(listaAttivita);
});

app.post('/api/attivita', (req, res) => {
    const nuovoTesto = req.body.testo;
    if (!nuovoTesto) return res.status(400).json({ errore: "Il testo non può essere vuoto" });

    const nuovaAttivita = {
        id: Date.now(),
        testo: nuovoTesto,
        createdAt: new Date(),
        updatedAt: new Date()  
    };

    listaAttivita.push(nuovaAttivita);
    res.json(listaAttivita);
});

app.put('/api/attivita/:id', (req, res) => {
    const idDaModificare = parseInt(req.params.id);
    const nuovoTesto = req.body.testo;

    const index = listaAttivita.findIndex(attivita => attivita.id === idDaModificare);

    if (index === -1) {
        return res.status(404).json({ errore: "Attività non trovata" });
    }

    listaAttivita[index].testo = nuovoTesto; 
    
    // Questo aggiorna solo updatedAt, lasciando createdAt intatto
    listaAttivita[index].updatedAt = new Date(); 

    res.json(listaAttivita);
});

app.delete('/api/attivita/:id', (req, res) => {
    const idDaEliminare = parseInt(req.params.id);

    listaAttivita = listaAttivita.filter(attivita => attivita.id !== idDaEliminare);

    res.json(listaAttivita);
});

app.listen(PORT, () => {
    console.log(`Server attivo sulla porta ${PORT}`);
});