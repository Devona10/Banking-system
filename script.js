let currentUser = null;

// Helper: Update balance and transactions on screen
function updateUI(balance, transactions) {
  document.getElementById("balance").innerText = `Balance: ₹${balance}`;
  const historyDiv = document.getElementById("transaction-history");
  historyDiv.innerHTML = "";

  transactions.forEach(txn => {
    const item = document.createElement("div");
    item.className = "txn-item";
    item.innerText = `${txn.type.toUpperCase()} ₹${txn.amount} - ${txn.status.toUpperCase()} @ ${new Date(txn.created_at).toLocaleString()}`;
    historyDiv.appendChild(item);
  });
}

// ✅ Signup
async function signup() {
  const username = document.getElementById("signup-username").value;
  const password = document.getElementById("signup-password").value;

  const res = await fetch("https://banking-system-omp7.onrender.com/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json();
  if (data.error) {
    alert(data.error);
  } else {
    alert("Signup successful! You can now login.");
  }
}

// ✅ Login
async function login() {
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;

  const res = await fetch("https://banking-system-omp7.onrender.com/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json();
  if (data.error) {
    alert(data.error);
  } else {
    currentUser = username;
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("banking-section").style.display = "block";
    document.getElementById("welcome-msg").innerText = `Welcome, ${username}!`;
    fetchTransactions();
  }
}

// ✅ Logout
function logout() {
  currentUser = null;
  document.getElementById("auth-section").style.display = "block";
  document.getElementById("banking-section").style.display = "none";
}

// ✅ Fetch Transactions
async function fetchTransactions() {
  if (!currentUser) return;
  const res = await fetch(`https://banking-system-omp7.onrender.com/transactions/${currentUser}`);
  const data = await res.json();
  if (data.error) {
    alert(data.error);
  } else {
    updateUI(data.balance, data.transactions);
  }
}

// ✅ Add Transaction
async function addTransaction() {
  const amount = document.getElementById("amount").value;
  const type = document.getElementById("type").value;

  if (!amount || Number(amount) <= 0) {
    alert("Enter a valid amount.");
    return;
  }

  const res = await fetch("https://banking-system-omp7.onrender.com/transaction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: currentUser, amount, type }),
  });

  const data = await res.json();
  if (data.error) {
    alert(data.error); // 🔴 This includes "Insufficient balance"
  } else {
    updateUI(data.balance, data.transactions);
    document.getElementById("amount").value = "";
  }
}

// ✅ Undo Transaction
async function undoTransaction() {
  const res = await fetch(`https://banking-system-omp7.onrender.com/undo/${currentUser}`, {
    method: "POST",
  });

  const data = await res.json();
  if (data.error) {
    alert(data.error);
  } else {
    updateUI(data.balance, data.transactions);
  }
}

// ✅ Redo Transaction
async function redoTransaction() {
  const res = await fetch(`https://banking-system-omp7.onrender.com/redo/${currentUser}`, {
    method: "POST",
  });

  const data = await res.json();
  if (data.error) {
    alert(data.error);
  } else {
    updateUI(data.balance, data.transactions);
  }
}
