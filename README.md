# Splashboard

Describe a mood or upload a photo — Splashboard finds matching images from Unsplash and shows you the camera settings used to take them.

---

## What you need before starting

- [Node.js](https://nodejs.org/) (v18 or later)
- A free **Unsplash API key** → [create one here](https://unsplash.com/developers) (takes ~2 minutes)
- A free **Gemini API key** → [get one here](https://aistudio.google.com/app/apikey) (used by the backend to understand your prompts)

---

## Setup (step by step)

### 1. Install dependencies

Open a terminal in this folder and run:

```bash
npm install
npm run backend:install
```

### 2. Set up the frontend environment

Create a file called `.env.local` in the root of this project and paste in the following:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
NEXT_PUBLIC_UNSPLASH_ACCESS_KEY=your_unsplash_key_here
```

Replace `your_unsplash_key_here` with the Access Key from your Unsplash app.

### 3. Set up the backend environment

```bash
cp backend/.env.example backend/.env
```

Then open `backend/.env` and set your Gemini API key:

```bash
GEMINI_API_KEY=your_gemini_key_here
```

### 4. Run the app

You need two terminal windows — one for the backend, one for the frontend.

**Terminal 1 — start the backend:**
```bash
npm run backend:dev
```

**Terminal 2 — start the frontend:**
```bash
npm run dev
```

The app opens at **http://localhost:3000/splashboard**.

---

## How it works

1. You type a mood description or upload a photo
2. The backend sends it to Gemini, which extracts visual descriptors (mood, lighting, color, framing, etc.)
3. The frontend runs Unsplash searches using those descriptors
4. Results appear as a mood board or a grid with camera details

---

## Usage limits

By default, the app allows **4 free AI analyses per month** (shared across everyone using the same backend). After your first use, a panel will appear in the app showing how many you have left.

To remove the limit, set `MONTHLY_ACTION_LIMIT=0` in `backend/.env`.

To increase the limit, set e.g. `MONTHLY_ACTION_LIMIT=20`.

---

## Tech stack

- **Next.js 16** (App Router, static export)
- **Express.js** backend with Gemini AI integration
- **Unsplash API** for image search and EXIF data
- **Tailwind CSS v4**

---

## Unsplash attribution

All photos are attributed to their photographers with links back to Unsplash, as required by their guidelines. Images are served directly from the Unsplash CDN — nothing is stored or proxied.
