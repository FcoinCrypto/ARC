const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const port = 3000;

const app = express();
app.use(bodyParser.json());

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'wallet_arc',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Endpoint pour créer un compte utilisateur
app.post('/users', async (req, res) => {
  const { name, email, password } = req.body;

  // Vérifier si l'utilisateur existe déjà
  const [rows, fields] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (rows.length > 0) {
    return res.status(400).json({ error: 'Cet email est déjà utilisé' });
  }

  // Générer une clé de portefeuille aléatoire
  const wallet_key = crypto.randomBytes(16).toString('hex');

  // Insérer les informations de l'utilisateur dans la table "users"
  const [result, _] = await pool.query('INSERT INTO users (name, email, password, balance, wallet_key, currency_symbol) VALUES (?, ?, ?, ?, ?, ?)', [name, email, password, 0, wallet_key, 'ARC']);

  res.status(201).json({ message: 'Utilisateur créé avec succès', user_id: result.insertId });
});

// Endpoint pour authentifier un utilisateur
app.post('/users/login', async (req, res) => {
  const { email, password } = req.body;

  // Vérifier si l'utilisateur existe
  const [rows, fields] = await pool.query('SELECT id FROM users WHERE email = ? AND password = ?', [email, password]);
  if (rows.length == 0) {
    return res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect' });
  }

  // Authentification réussie
  res.status(200).json({ message: 'Authentification réussie', user_id: rows[0].id });
});

// Endpoint pour ajouter des fonds à un compte
app.post('/users/:id/deposit', async (req, res) => {
  const { amount } = req.body;
  const user_id = req.params.id;

  // Vérifier si l'utilisateur existe
  const [rows, fields] = await pool.query('SELECT id, balance FROM users WHERE id = ?', [user_id]);
  if (rows.length == 0) {
    return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }

  const user = rows[0];
  const new_balance = user.balance + amount;
  await pool.query('UPDATE users SET balance = ? WHERE id = ?', [new_balance, user_id]);
  await pool.query('INSERT INTO transactions (sender_id, receiver_id, amount, status) VALUES (?, ?, ?, ?)', [user_id, user_id, amount, 'success']);

  res.status(200).json({ message: 'Fonds ajoutés avec succès', new_balance: new_balance });
});


// Endpoint pour transférer des fonds entre utilisateurs
app.post('/users/:id/transfer', async (req, res) => {
  const { amount, recipient_id } = req.body;
  const sender_id = req.params.id;
  
  // Vérifier si l'utilisateur existe
  const [sender_rows, sender_fields] = await pool.query('SELECT id, balance FROM users WHERE id = ?', [sender_id]);
  if (sender_rows.length == 0) {
  return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }
  
  // Vérifier si le destinataire existe
  const [recipient_rows, recipient_fields] = await pool.query('SELECT id FROM users WHERE id = ?', [recipient_id]);
  if (recipient_rows.length == 0) {
  return res.status(404).json({ error: 'Destinataire non trouvé' });
  }
  
  // Vérifier si l'utilisateur a suffisamment de fonds
  const sender = sender_rows[0];
  if (sender.balance < amount) {
  return res.status(400).json({ error: 'Solde insuffisant' });
  }
  
  // Transférer les fonds de l'utilisateur au destinataire
  const recipient = recipient_rows[0];
  const sender_new_balance = sender.balance - amount;
  const recipient_new_balance = recipient.balance + amount;
  await pool.query('UPDATE users SET balance = ? WHERE id = ?', [sender_new_balance, sender_id]);
  await pool.query('UPDATE users SET balance = ? WHERE id = ?', [recipient_new_balance, recipient_id]);
  
  // Créer une nouvelle transaction dans la table "transactions"
  await pool.query('INSERT INTO transactions (sender_id, receiver_id, amount, status) VALUES (?, ?, ?, "success")', [sender_id, recipient_id, amount]);
  
  res.status(200).json({ message: 'Fonds transférés avec succès', sender_new_balance: sender_new_balance });
  });
  
  // Endpoint pour récupérer l'historique des transactions d'un utilisateur
  app.get('/users/:id/transactions', async (req, res) => {
  const user_id = req.params.id;
  
  // Vérifier si l'utilisateur existe
  const [rows, fields] = await pool.query('SELECT id FROM users WHERE id = ?', [user_id]);
  if (rows.length == 0) {
  return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }
  
  // Récupérer l'historique des transactions de l'utilisateur
  const [transactions, _] = await pool.query('SELECT * FROM transactions WHERE sender_id = ? OR receiver_id = ? ORDER BY created_at DESC', [user_id, user_id]);
  
  res.status(200).json({ transactions: transactions });
  });
  
  // Endpoint pour vérifier le solde d'un compte
  app.get('/users/:id/balance', async (req, res) => {
  const user_id = req.params.id;
  
  // Vérifier si l'utilisateur existe
  const [rows, fields] = await pool.query('SELECT id, balance FROM users WHERE id = ?', [user_id]);
  if (rows.length == 0) {
  return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }
  
  const user = rows[0];
  res.status(200).json({ balance: user.balance });
  });

  // Endpoint pour modifier les informations d'un utilisateur
app.put('/users/:id', async (req, res) => {
  const user_id = req.params.id;
  const { name, email, password } = req.body;

  // Vérifier si l'utilisateur existe
  const [rows, fields] = await pool.query('SELECT id FROM users WHERE id = ?', [user_id]);
  if (rows.length == 0) {
    return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }

  // Mettre à jour les informations de l'utilisateur
  const updateValues = {};
  if (name) {
    updateValues.name = name;
  }
  if (email) {
    updateValues.email = email;
  }
  if (password) {
    updateValues.password = password;
  }

  await pool.query('UPDATE users SET ? WHERE id = ?', [updateValues, user_id]);

  res.status(200).json({ message: 'Informations utilisateur modifiées avec succès' });
});


app.listen(port, () => {
  console.log(`Serveur API démarré sur le port ${port}`);
});



