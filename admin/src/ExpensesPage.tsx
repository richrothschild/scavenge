import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const STORAGE_KEY = "boyz_expenses_v1";

type ExpenseEntry = {
  id: string;
  paidBy: string;
  category: "Food" | "Hotel" | "Golf" | "Other";
  description: string;
  amount: number;
};

type Person = {
  name: string;
  prePaid: number;
};

type ExpensesData = {
  people: Person[];
  expenses: ExpenseEntry[];
};

const DEFAULT_PEOPLE: Person[] = [
  { name: "Marty", prePaid: 300 },
  { name: "Dave", prePaid: 300 },
  { name: "Mark", prePaid: 300 },
  { name: "Rick", prePaid: 300 },
  { name: "RichR", prePaid: 300 },
  { name: "Al Z", prePaid: 300 },
  { name: "Carl", prePaid: 300 },
  { name: "Tom", prePaid: 300 },
  { name: "RichW", prePaid: 300 },
  { name: "JeffB", prePaid: 0 },
  { name: "Doug", prePaid: 300 },
  { name: "Lars", prePaid: 0 },
  { name: "Bruce", prePaid: 0 },
  { name: "John", prePaid: 0 },
  { name: "Al W", prePaid: 300 },
  { name: "Bill", prePaid: 0 },
  { name: "Dan", prePaid: 0 },
];

const CATEGORIES = ["Food", "Hotel", "Golf", "Other"] as const;

function loadData(): ExpensesData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { people: DEFAULT_PEOPLE, expenses: [] };
}

function saveData(data: ExpensesData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtExact(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ExpensesPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ExpensesData>(loadData);
  const [tab, setTab] = useState<"summary" | "expenses" | "people">("summary");

  // Add expense form
  const [paidBy, setPaidBy] = useState("");
  const [category, setCategory] = useState<ExpenseEntry["category"]>("Food");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [addError, setAddError] = useState("");

  // Add person form
  const [newName, setNewName] = useState("");
  const [newPrePaid, setNewPrePaid] = useState("");

  // Edit prepaid inline
  const [editingPrePaid, setEditingPrePaid] = useState<string | null>(null);
  const [editPrePaidVal, setEditPrePaidVal] = useState("");

  useEffect(() => {
    saveData(data);
  }, [data]);

  const totalExpenses = data.expenses.reduce((s, e) => s + e.amount, 0);
  const count = data.people.length;
  const costPerPerson = count > 0 ? totalExpenses / count : 0;

  function addExpense() {
    setAddError("");
    if (!paidBy) { setAddError("Select who paid."); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setAddError("Enter a valid amount."); return; }
    if (!description.trim()) { setAddError("Enter a description."); return; }
    const entry: ExpenseEntry = {
      id: Date.now().toString(),
      paidBy,
      category,
      description: description.trim(),
      amount: amt,
    };
    setData(d => ({ ...d, expenses: [...d.expenses, entry] }));
    setDescription("");
    setAmount("");
    setAddError("");
  }

  function removeExpense(id: string) {
    setData(d => ({ ...d, expenses: d.expenses.filter(e => e.id !== id) }));
  }

  function addPerson() {
    if (!newName.trim()) return;
    const pp = parseFloat(newPrePaid) || 0;
    setData(d => ({ ...d, people: [...d.people, { name: newName.trim(), prePaid: pp }] }));
    setNewName("");
    setNewPrePaid("");
  }

  function removePerson(name: string) {
    setData(d => ({ ...d, people: d.people.filter(p => p.name !== name) }));
  }

  function startEditPrePaid(name: string, current: number) {
    setEditingPrePaid(name);
    setEditPrePaidVal(current.toString());
  }

  function savePrePaid(name: string) {
    const val = parseFloat(editPrePaidVal);
    if (!isNaN(val) && val >= 0) {
      setData(d => ({
        ...d,
        people: d.people.map(p => p.name === name ? { ...p, prePaid: val } : p),
      }));
    }
    setEditingPrePaid(null);
  }

  function resetAll() {
    if (confirm("Reset all expenses and people to defaults?")) {
      setData({ people: DEFAULT_PEOPLE, expenses: [] });
    }
  }

  // Summary: per-person breakdown
  const summary = data.people.map(person => {
    const paid = data.expenses.filter(e => e.paidBy === person.name).reduce((s, e) => s + e.amount, 0);
    const owes = costPerPerson - person.prePaid - paid;
    return { ...person, totalPaid: paid + person.prePaid, owes };
  });

  // Category totals
  const catTotals = CATEGORIES.map(cat => ({
    cat,
    total: data.expenses.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0),
  })).filter(c => c.total > 0);

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>Expenses</h1>
        <span className="pub-header-sub">Boyz Weekend 2026</span>
      </header>

      {/* Persistent stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", padding: "0.75rem 1.25rem 0", textAlign: "center" }}>
        <div style={{ background: "#1e293b", borderRadius: "8px", padding: "0.5rem 0.25rem" }}>
          <div style={{ fontSize: "0.65rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em" }}>People</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#f1f5f9" }}>{count}</div>
        </div>
        <div style={{ background: "#1e293b", borderRadius: "8px", padding: "0.5rem 0.25rem" }}>
          <div style={{ fontSize: "0.65rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em" }}>Per Person</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#f1f5f9" }}>{fmtExact(costPerPerson)}</div>
        </div>
        <div style={{ background: "#1e293b", borderRadius: "8px", padding: "0.5rem 0.25rem" }}>
          <div style={{ fontSize: "0.65rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em" }}>Total</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#f1f5f9" }}>{fmt(totalExpenses)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", padding: "0.75rem 1.25rem 0" }}>
        {(["summary", "expenses", "people"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "0.4rem 1rem",
              borderRadius: "6px",
              border: "1px solid #334155",
              background: tab === t ? "#3b82f6" : "#1e293b",
              color: tab === t ? "#fff" : "#94a3b8",
              cursor: "pointer",
              fontWeight: tab === t ? 700 : 400,
              fontSize: "0.85rem",
              textTransform: "capitalize",
            }}
          >
            {t === "summary" ? "Summary" : t === "expenses" ? "Expenses" : "People"}
          </button>
        ))}
      </div>

      <div style={{ padding: "1rem 1.25rem" }}>

        {/* ── SUMMARY TAB ── */}
        {tab === "summary" && (
          <>
            {/* Totals banner */}
            <div className="gn-card" style={{ borderLeftColor: "#3b82f6", marginBottom: "1.25rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", textAlign: "center" }}>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em" }}>Total Expenses</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f1f5f9" }}>{fmt(totalExpenses)}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em" }}>People</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f1f5f9" }}>{count}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em" }}>Per Person</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f1f5f9" }}>{fmtExact(costPerPerson)}</div>
                </div>
              </div>

              {catTotals.length > 0 && (
                <div style={{ borderTop: "1px solid #334155", paddingTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.5rem 1.5rem" }}>
                  {catTotals.map(c => (
                    <span key={c.cat} style={{ fontSize: "0.82rem", color: "#94a3b8" }}>
                      <span style={{ color: "#64748b" }}>{c.cat}:</span> {fmt(c.total)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Per-person table */}
            <div className="gn-card" style={{ borderLeftColor: "#334155", padding: "0", overflow: "hidden" }}>
              <div style={{ padding: "0.75rem 1rem 0.5rem", borderBottom: "1px solid #334155" }}>
                <p className="gn-card-title" style={{ fontSize: "0.9rem" }}>Who Owes What</p>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
                  <thead>
                    <tr style={{ background: "#0f172a" }}>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Pre-Paid</th>
                      <th style={thStyle}>Expenses Paid</th>
                      <th style={thStyle}>Owes / Owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((p, i) => {
                      const oweColor = p.owes < 0 ? "#4ade80" : p.owes === 0 ? "#94a3b8" : "#fbbf24";
                      const oweLabel = p.owes < 0 ? `← ${fmtExact(Math.abs(p.owes))}` : p.owes === 0 ? "Settled" : fmtExact(p.owes);
                      return (
                        <tr key={p.name} style={{ background: i % 2 === 0 ? "#1e293b" : "#162032" }}>
                          <td style={tdStyle}>{p.name}</td>
                          <td style={tdStyle}>{fmt(p.prePaid)}</td>
                          <td style={tdStyle}>{p.totalPaid - p.prePaid > 0 ? fmt(p.totalPaid - p.prePaid) : "—"}</td>
                          <td style={{ ...tdStyle, color: oweColor, fontWeight: 700 }}>{oweLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "0.5rem 1rem", borderTop: "1px solid #334155", fontSize: "0.72rem", color: "#475569" }}>
                Green = owed money back · Yellow = still owes · Arrow = reimbursement amount
              </div>
            </div>
          </>
        )}

        {/* ── EXPENSES TAB ── */}
        {tab === "expenses" && (
          <>
            {/* Add expense form */}
            <div className="gn-card" style={{ borderLeftColor: "#22d3ee", marginBottom: "1.25rem" }}>
              <p className="gn-card-title" style={{ fontSize: "0.9rem" }}>Add Expense</p>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <select
                  value={paidBy}
                  onChange={e => setPaidBy(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Who paid?</option>
                  {data.people.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                  <select value={category} onChange={e => setCategory(e.target.value as ExpenseEntry["category"])} style={inputStyle}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input
                    type="number"
                    placeholder="Amount ($)"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    style={inputStyle}
                    min="0"
                    step="0.01"
                  />
                </div>

                <input
                  type="text"
                  placeholder="Description"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addExpense()}
                  style={inputStyle}
                />

                {addError && <p style={{ color: "#f87171", fontSize: "0.8rem", margin: 0 }}>{addError}</p>}

                <button onClick={addExpense} style={btnPrimary}>Add Expense</button>
              </div>
            </div>

            {/* Expense list */}
            {data.expenses.length === 0 ? (
              <p style={{ color: "#475569", fontSize: "0.85rem", textAlign: "center", marginTop: "2rem" }}>No expenses yet.</p>
            ) : (
              <div className="gn-card" style={{ borderLeftColor: "#334155", padding: 0, overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr style={{ background: "#0f172a" }}>
                        <th style={thStyle}>Paid By</th>
                        <th style={thStyle}>Category</th>
                        <th style={thStyle}>Description</th>
                        <th style={thStyle}>Amount</th>
                        <th style={thStyle}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.expenses.map((e, i) => (
                        <tr key={e.id} style={{ background: i % 2 === 0 ? "#1e293b" : "#162032" }}>
                          <td style={tdStyle}>{e.paidBy}</td>
                          <td style={{ ...tdStyle, color: "#94a3b8" }}>{e.category}</td>
                          <td style={tdStyle}>{e.description}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: "#fbbf24" }}>{fmtExact(e.amount)}</td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            <button
                              onClick={() => removeExpense(e.id)}
                              style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.9rem" }}
                              title="Remove"
                            >✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "#0f172a", borderTop: "2px solid #334155" }}>
                        <td colSpan={3} style={{ ...tdStyle, color: "#64748b", fontWeight: 700 }}>Total</td>
                        <td style={{ ...tdStyle, fontWeight: 800, color: "#f1f5f9" }}>{fmtExact(totalExpenses)}</td>
                        <td style={tdStyle}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── PEOPLE TAB ── */}
        {tab === "people" && (
          <>
            {/* Add person form */}
            <div className="gn-card" style={{ borderLeftColor: "#a78bfa", marginBottom: "1.25rem" }}>
              <p className="gn-card-title" style={{ fontSize: "0.9rem" }}>Add Person</p>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: "0.6rem", alignItems: "end" }}>
                <input
                  type="text"
                  placeholder="Name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addPerson()}
                  style={inputStyle}
                />
                <input
                  type="number"
                  placeholder="Pre-paid ($)"
                  value={newPrePaid}
                  onChange={e => setNewPrePaid(e.target.value)}
                  style={inputStyle}
                  min="0"
                />
                <button onClick={addPerson} style={{ ...btnPrimary, margin: 0 }}>Add</button>
              </div>
            </div>

            {/* People list */}
            <div className="gn-card" style={{ borderLeftColor: "#334155", padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "0.75rem 1rem 0.5rem", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p className="gn-card-title" style={{ fontSize: "0.9rem" }}>{count} People · Total Pre-Paid: {fmt(data.people.reduce((s, p) => s + p.prePaid, 0))}</p>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
                <thead>
                  <tr style={{ background: "#0f172a" }}>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Pre-Paid</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p, i) => (
                    <tr key={p.name} style={{ background: i % 2 === 0 ? "#1e293b" : "#162032" }}>
                      <td style={tdStyle}>{p.name}</td>
                      <td style={tdStyle}>
                        {editingPrePaid === p.name ? (
                          <input
                            type="number"
                            value={editPrePaidVal}
                            onChange={e => setEditPrePaidVal(e.target.value)}
                            onBlur={() => savePrePaid(p.name)}
                            onKeyDown={e => e.key === "Enter" && savePrePaid(p.name)}
                            style={{ ...inputStyle, width: "80px", padding: "0.2rem 0.4rem" }}
                            autoFocus
                          />
                        ) : (
                          <span
                            onClick={() => startEditPrePaid(p.name, p.prePaid)}
                            style={{ cursor: "pointer", color: "#94a3b8", textDecoration: "underline dotted" }}
                            title="Click to edit"
                          >{fmt(p.prePaid)}</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <button
                          onClick={() => removePerson(p.name)}
                          style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.9rem" }}
                          title="Remove"
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={resetAll} style={{ ...btnPrimary, background: "#7f1d1d", marginTop: "1.5rem", fontSize: "0.8rem" }}>
              Reset All Data
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  textAlign: "left",
  fontSize: "0.72rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#475569",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  color: "#cbd5e1",
  borderTop: "1px solid #0f172a",
};

const inputStyle: React.CSSProperties = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: "6px",
  color: "#e2e8f0",
  padding: "0.45rem 0.7rem",
  fontSize: "0.85rem",
  width: "100%",
  boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  background: "#3b82f6",
  border: "none",
  borderRadius: "6px",
  color: "#fff",
  padding: "0.5rem 1.2rem",
  fontWeight: 700,
  fontSize: "0.9rem",
  cursor: "pointer",
  marginTop: "0.25rem",
};
