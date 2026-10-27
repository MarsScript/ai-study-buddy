# AI Study Buddy V2 — Midnight Blue Dashboard

A responsive Cloudflare Pages website with a dark-charcoal and blue study dashboard, Supabase login and data, and server-side Gemini AI generation.

## Deploy the updated version to GitHub

1. Extract this ZIP and open `AI_Study_Buddy_Cloudflare_Upload`.
2. In GitHub `MarsScript/ai-study-buddy`, choose **Add file → Upload files**. Drag the `public` and `functions` folders plus this README into the upload area. **Keep the folder hierarchy**.
3. GitHub may ask you to replace files with matching names; approve replacement and commit to `main`.
4. Cloudflare Pages, which is connected to `main`, should automatically redeploy. Your build output directory stays `public`, framework `None`, build command blank.
5. Refresh https://ai-study-buddy-9cz.pages.dev with Ctrl+Shift+R.

If GitHub's upload UI will not replace the existing files, use github.dev (`.` on the repo page), drag the folders into the Explorer tree, then commit and push the changes. Never upload a parent folder that adds an extra nested directory level.

## Environment settings (unchanged)

Keep these **Production** variables in Cloudflare Pages:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase publishable key (already configured)
- `GEMINI_API_KEY`: Encrypted **Secret** (never commit it)
- `GEMINI_MODEL`: The model currently working in your free-tier project

**Do not** add secrets to `public/app.js`. The existing Cloudflare Pages Function in `functions/api/ai.js` is preserved.

## V2 highlights

- Responsive charcoal/navy sidebar and dashboard, including new favicon
- Notes library (save, open, delete) and dashboard stats
- AI study-guide Markdown formatting with safe text rendering
- Flashcard flip study mode and shuffle/navigation
- Interactive one-question-at-a-time quiz, real scoring, saved quiz history
- Dark pricing section with $3.99/month Premium **coming soon** — payments NOT enabled

## Known scope / launch safety

- Notes currently save as **new copies**, not edits to existing rows.
- Dashboard stats load up to 100 records per type, so they are not lifetime totals for heavy users.
- No subscription billing, Premium gating, AI per-user rate limits or anti-abuse quotas yet. **Do not publicly launch paid subscriptions** until secure PayPal integration and server-side usage controls are in place.
- Supabase email confirmations and site URLs remain configured in your Supabase project.
- Gemini Free Tier has quotas and data-handling conditions. Avoid uploading sensitive/confidential notes.
- Flashcard questions and answers are stored securely only if Supabase RLS policies remain enabled and tested.
