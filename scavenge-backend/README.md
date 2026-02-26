# Scavenge Backend (minimal prototype)

This folder contains a tiny Express prototype intended for quick deployment to Railway for prototyping submission judgement and presigned uploads.

Endpoints
- `GET /health` — health check
- `GET /teams` — in-memory events per team
- `POST /submit` — body: `{ teamId, clueId, mediaUrl }` → returns `{ verdict }` (simulated)
- `POST /presign` — returns a dummy upload URL (for demo)

Local run
```bash
cd scavenge-backend
npm install
npm start
```

Railway
- Create a new project on Railway and connect this repo
- Point Railway to the `scavenge-backend` folder (or root) and set `npm install && npm start` as the build/start
- Railway will detect Node and expose a public URL. Set any environment variables (S3 keys, DB URL) in Railway settings.
