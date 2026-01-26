
---

## API Endpoints

### `GET /health`
Basic health check and KB load status.

### `GET /config`
Returns:
- Available languages
- Available training programs
- Knowledge base source (default or Google Drive)

Used by the widget to dynamically populate the pre-chat screen.

### `POST /chat`
Accepts:
```json
{
  "message": "User question",
  "language": "en",
  "programsSelected": ["CNA", "Phlebotomy"]
}


---

## Current Project Status Below


### What Is Fully Working

- **Backend API**
  - Express server is stable and cleanly structured :contentReference[oaicite:0]{index=0}
  - Knowledge base loads correctly (default or Google Drive)
  - Caching prevents repeated Drive reads
  - Course recommendation logic is implemented and deterministic
  - AI prompt construction is disciplined and guarded

- **Frontend Widget**
  - iframe-safe layout (no viewport bugs) :contentReference[oaicite:1]{index=1}
  - Pre-chat gating works (language + program selection required)
  - Session state persists across refresh
  - Backend-driven config means **non-technical staff can update programs**
  - Clean request payload sent to `/chat` :contentReference[oaicite:2]{index=2}

- **Integration**
  - `/config` → drives UI
  - `/chat` → grounded AI responses
  - Render deployment already wired and live

### What Is Partially Complete

- **Knowledge relevance**
  - Uses keyword scoring and chunking (simple but effective)
  - Not vector embeddings yet — which is fine at this scale

- **Error handling**
  - Safe fallbacks exist
  - Logging is dev-friendly, not ops-grade yet

### What Is *Not* Done (But Also Not Broken)

- No admin UI for KB validation (Drive is the “UI”)
- No analytics or conversation logging
- No rate limiting
- No authentication (public-facing by design)


