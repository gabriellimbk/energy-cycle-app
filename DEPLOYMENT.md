# Energy Cycle App Deployment Notes

## What is included

- Frontend source in `src/`
- Vercel serverless API in `api/`
- Shared server logic in `server/`
- Vite and Vercel config
- `package.json` and lockfile
- `.env.example`

## What was intentionally excluded

- `node_modules/`
- `dist/`
- local logs
- `.env`
- `.env.local`

## GitHub upload checklist

1. Create a new GitHub repository.
2. Copy the contents of this folder into that repository.
3. Verify that no secret file is present before pushing.
4. Commit and push.

Suggested commands:

```powershell
git init
git add .
git commit -m "Initial upload of Energy Cycle App"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## Required environment variables

- `GEMINI_API_KEY`

## Vercel setup

1. Import the GitHub repository into Vercel.
2. Framework preset can remain auto-detected.
3. Add `GEMINI_API_KEY` in Project Settings -> Environment Variables.
4. Deploy.

## Current implementation boundary

- Gemini feedback is implemented.
- Supabase is not wired into the app yet.
- Canvas LMS access restriction is not wired into the app yet.

When you want the next phase, the likely work is:

1. Add Supabase schema and client setup.
2. Add Canvas launch or redirect validation.
3. Restrict app access to trusted LMS-originated sessions only.
