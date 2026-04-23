# Energy Cycle App

This folder is the GitHub-ready package for the Chemistry Energy Cycle app. It uses a Vite React frontend and a Vercel serverless API route so the Gemini key stays on the server.

## Current platform status

- GitHub: ready for upload
- Vercel: ready for deployment
- Gemini API: implemented through `GEMINI_API_KEY`
- Supabase: not integrated yet
- Canvas LMS access restriction: not integrated yet

## Local development

Prerequisites:
- Node.js 20+
- A Gemini API key

Setup:

1. Install dependencies:
   `npm install`
2. Open the local Gemini config file:
   [local-config/gemini.env.local](</c:/dev/Project Chemistry - Energy Cycle/Energy Cycle App/local-config/gemini.env.local>)
3. Add your Gemini key and optional model override there
4. Start the app:
   `npm run dev`
5. Open:
   `http://localhost:3000`

`npm run dev` starts:
- the Vite frontend on port `3000`
- the local API on port `3001`

## Vercel deployment

1. Create a new GitHub repository.
2. Upload the contents of this folder to that repository.
3. Import the repository into Vercel.
4. In Vercel project settings, add:
   `GEMINI_API_KEY`
5. Deploy.

The frontend submits to `/api/check-student-work`, and Vercel executes the Gemini call inside the serverless function.

## Notes for later phases

- Supabase can be added later for persistence, auth, or LMS-linked records.
- Canvas-only access can be enforced later by validating LMS launch data and the expected `canvas.user.loginId`.
- Those integrations are intentionally not included in this upload package yet.

## Reference

See `DEPLOYMENT.md` for the upload checklist and platform setup notes.
