const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// simple in-memory store for demo / prototyping
const teams = {};

app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.get('/teams', (req, res) => {
  res.json({ teams });
});

// Simulate submission judgement
app.post('/submit', (req, res) => {
  const { teamId, clueId, mediaUrl } = req.body || {};
  if (!teamId || !clueId) return res.status(400).json({ error: 'teamId and clueId required' });
  const verdict = Math.random() > 0.2 ? 'PASS' : 'NEEDS_REVIEW';
  // record event (in-memory)
  teams[teamId] = teams[teamId] || { events: [] };
  teams[teamId].events.unshift({ id: uuidv4(), ts: Date.now(), clueId, verdict, mediaUrl });
  res.json({ verdict, message: 'Simulated judgement' });
});

// Return a dummy presigned URL (for demo only)
app.post('/presign', (req, res) => {
  const id = uuidv4();
  const url = `${req.protocol}://${req.get('host')}/upload-placeholder/${id}`;
  res.json({ uploadUrl: url, key: `uploads/${id}` });
});

// simple file placeholder route so presign looks usable in demo
app.post('/upload-placeholder/:id', (req, res) => {
  // In a real app you'd stream to S3 or similar. Here we just acknowledge.
  res.json({ ok: true, id: req.params.id });
});

app.listen(PORT, () => console.log(`Scavenge backend listening on ${PORT}`));
