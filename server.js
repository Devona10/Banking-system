const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

// PostgreSQL pool
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'banking_node',
  password: 'derickdevo',
  port: 5432,
});

// ----------------- Linked List Implementation -------------------

class TransactionNode {
  constructor(id, amount, type, status, created_at) {
    this.id = id;
    this.amount = Number(amount);
    this.type = type;
    this.status = status;
    this.created_at = created_at;
    this.prev = null;
    this.next = null;
  }
}

class TransactionList {
  constructor() {
    this.head = null;
    this.tail = null;
    this.current = null;
  }

  insert(txn) {
    const node = new TransactionNode(txn.id, txn.amount, txn.type, txn.status, txn.created_at);
    if (!this.head) {
      this.head = this.tail = this.current = node;
    } else {
      node.prev = this.tail;
      this.tail.next = node;
      this.tail = node;
      this.current = node;
    }
  }

  undo() {
    while (this.current && this.current.status !== 'active') {
      this.current = this.current.prev;
    }

    if (this.current) {
      const txn = this.current;
      this.current = this.current.prev;
      return txn;
    }

    return null;
  }

  redo() {
    if (!this.current) {
      this.current = this.head;
    } else {
      this.current = this.current.next;
    }

    while (this.current && this.current.status !== 'undone') {
      this.current = this.current.next;
    }

    if (this.current) {
      return this.current;
    }

    return null;
  }

  reset() {
    this.head = this.tail = this.current = null;
  }
}

const userSessions = {}; // Store transaction list per user session

async function getUserData(userId, username) {
  const txns = await pool.query(
    'SELECT id, amount, type, status, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );

  const transactions = txns.rows;

  // Init or reset session
  if (!userSessions[username]) {
    userSessions[username] = new TransactionList();
  } else {
    userSessions[username].reset();
  }

  let balance = 0;

  transactions.forEach(txn => {
    if (txn.status === 'active') {
      if (txn.type === 'deposit') balance += Number(txn.amount);
      else if (txn.type === 'withdraw') balance -= Number(txn.amount);
    }

    userSessions[username].insert(txn);
  });

  return { balance, transactions };
}

// ----------------- Routes -------------------

app.get('/', (req, res) => {
  res.send('✅ Banking backend with doubly linked list is running!');
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: 'Username and password required' });

  try {
    const existing = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (existing.rowCount > 0) return res.json({ error: 'Username already exists' });

    await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
    res.json({ message: 'Registration successful' });
  } catch (err) {
    res.json({ error: 'Registration failed', details: err.message });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: 'Username and password required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
    if (result.rowCount === 0) return res.json({ error: 'Invalid credentials' });

    res.json({ message: 'Login successful' });
  } catch (err) {
    res.json({ error: 'Login failed', details: err.message });
  }
});

app.post('/transaction', async (req, res) => {
  const { username, amount, type } = req.body;

  if (!username || !amount || !type) {
    return res.json({ error: 'Missing transaction details' });
  }

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rowCount === 0) return res.status(404).json({ error: 'User not found' });

    const userId = userResult.rows[0].id;

    // Get current balance before inserting withdrawal
    const { balance } = await getUserData(userId, username);

    if (type === 'withdraw' && Number(amount) > balance) {
      return res.json({ error: 'Insufficient balance' });
    }

    await pool.query(
      'INSERT INTO transactions (user_id, amount, type, status, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [userId, amount, type, 'active']
    );

    const data = await getUserData(userId, username);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Transaction failed', details: err.message });
  }
});

app.post('/undo/:username', async (req, res) => {
  const { username } = req.params;
  const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (userResult.rowCount === 0) return res.status(404).json({ error: 'User not found' });

  const userId = userResult.rows[0].id;
  const session = userSessions[username];

  const txn = session?.undo();
  if (!txn) return res.json({ error: 'No active transaction to undo' });

  await pool.query('UPDATE transactions SET status = $1 WHERE id = $2', ['undone', txn.id]);

  const data = await getUserData(userId, username);
  res.json(data);
});

app.post('/redo/:username', async (req, res) => {
  const { username } = req.params;
  const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (userResult.rowCount === 0) return res.status(404).json({ error: 'User not found' });

  const userId = userResult.rows[0].id;
  const session = userSessions[username];

  const txn = session?.redo();
  if (!txn) return res.json({ error: 'No undone transaction to redo' });

  await pool.query('UPDATE transactions SET status = $1 WHERE id = $2', ['active', txn.id]);

  const data = await getUserData(userId, username);
  res.json(data);
});

app.get('/transactions/:username', async (req, res) => {
  const { username } = req.params;
  const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (userResult.rowCount === 0) return res.status(404).json({ error: 'User not found' });

  const userId = userResult.rows[0].id;
  const data = await getUserData(userId, username);
  res.json(data);
});

app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
