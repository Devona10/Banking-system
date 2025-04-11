const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

// PostgreSQL connection pool
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'banking',
  password: 'your_password', // Replace with your actual password
  port: 5432,
});

// In-memory linked list tracker for undo/redo per user session
const sessions = {};

function createSession(username) {
  if (!sessions[username]) {
    sessions[username] = {
      head: null,
      tail: null,
      current: null,
    };
  }
}

// Node structure
function createNode(transaction) {
  return {
    transaction,
    prev: null,
    next: null,
  };
}

// Load transactions from DB into memory
async function loadTransactions(username) {
  const user = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (user.rowCount === 0) return;

  const userId = user.rows[0].id;
  const transactions = await pool.query(
    'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );

  const session = { head: null, tail: null, current: null };
  let prev = null;
  transactions.rows.forEach(tx => {
    const node = createNode(tx);
    if (!session.head) session.head = node;
    if (prev) {
      prev.next = node;
      node.prev = prev;
    }
    prev = node;
  });
  session.tail = prev;
  session.current = session.tail;
  sessions[username] = session;
}

function getBalance(session) {
  let sum = 0;
  let node = session.head;
  while (node && node !== session.current.next) {
    if (node.transaction.status !== 'done') {
      node = node.next;
      continue;
    }
    sum += node.transaction.type === 'deposit' ? Number(node.transaction.amount) : -Number(node.transaction.amount);
    node = node.next;
  }
  return sum;
}

function getTransactionsList(session) {
  const result = [];
  let node = session.head;
  while (node && node !== session.current.next) {
    if (node.transaction.status === 'done') {
      result.push(node.transaction);
    }
    node = node.next;
  }
  return result;
}

// Routes

app.get('/', (req, res) => {
  res.send('Banking backend is running!');
});

app.get('/register', async (req, res) => {
  const { username, password } = req.query;
  if (!username || !password) return res.json({ error: 'Username and password required' });

  try {
    const existing = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (existing.rowCount > 0) return res.json({ error: 'Username already exists' });

    await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
    res.json({ message: 'Registration successful' });
} catch (err) {
    console.error("Registration error:", err);  // <-- better log
    res.json({ error: 'Registration failed', details: err.message });
  }
  
});

app.get('/login', async (req, res) => {
  const { username, password } = req.query;
  if (!username || !password) return res.json({ error: 'Username and password required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
    if (result.rowCount === 0) return res.json({ error: 'Invalid credentials' });

    await loadTransactions(username);
    const session = sessions[username];
    const balance = getBalance(session);
    const transactions = getTransactionsList(session);
    res.json({ balance, transactions });
  } catch (err) {
    console.error(err);
    res.json({ error: 'Login failed' });
  }
});

app.get('/transaction', async (req, res) => {
  const { username, password, type, amount } = req.query;
  if (!username || !password || !type || !amount) return res.json({ error: 'Missing parameters' });

  try {
    const user = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
    if (user.rowCount === 0) return res.json({ error: 'Invalid credentials' });

    const userId = user.rows[0].id;
    const tx = await pool.query(
      'INSERT INTO transactions (user_id, type, amount, status, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [userId, type, amount, 'done']
    );

    createSession(username);
    const node = createNode(tx.rows[0]);
    const session = sessions[username];

    if (!session.head) {
      session.head = session.tail = session.current = node;
    } else {
      session.current.next = node;
      node.prev = session.current;
      session.current = node;
      session.tail = node;
    }

    const balance = getBalance(session);
    const transactions = getTransactionsList(session);
    res.json({ balance, transactions });
  } catch (err) {
    console.error(err);
    res.json({ error: 'Transaction failed' });
  }
});

app.get('/undo', async (req, res) => {
  const { username, password } = req.query;
  if (!username || !password) return res.json({ error: 'Missing credentials' });

  const user = await pool.query('SELECT id FROM users WHERE username = $1 AND password = $2', [username, password]);
  if (user.rowCount === 0) return res.json({ error: 'Invalid credentials' });

  const session = sessions[username];
  if (session?.current) {
    const id = session.current.transaction.id;
    await pool.query('UPDATE transactions SET status = $1 WHERE id = $2', ['undone', id]);
    session.current = session.current.prev;
  }

  const balance = getBalance(session);
  const transactions = getTransactionsList(session);
  res.json({ balance, transactions });
});

app.get('/redo', async (req, res) => {
  const { username, password } = req.query;
  if (!username || !password) return res.json({ error: 'Missing credentials' });

  const user = await pool.query('SELECT id FROM users WHERE username = $1 AND password = $2', [username, password]);
  if (user.rowCount === 0) return res.json({ error: 'Invalid credentials' });

  const session = sessions[username];
  if (session?.current?.next) {
    session.current = session.current.next;
    const id = session.current.transaction.id;
    await pool.query('UPDATE transactions SET status = $1 WHERE id = $2', ['done', id]);
  }

  const balance = getBalance(session);
  const transactions = getTransactionsList(session);
  res.json({ balance, transactions });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
