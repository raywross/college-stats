# Auth emails in Quad's look

Supabase Auth sends six emails itself: the sign-up confirmation, the magic link, the password reset, the email change,
the invitation, and the reauthentication code. They used to be Supabase's plain defaults. Since 2026-10-13 (owner),
they carry Quad's mark and colors, and they're sent from **Quad &lt;support@usequad.app&gt;** through Resend's SMTP, so
replies reach the support mailbox.

## Where they live

- `lib/emails/auth-templates.ts`: one layout (the four-tile mark as table cells, the wordmark, a white card, a violet
  pill button with a paste-this-link fallback, a footnote saying why they got it and what to do if they didn't ask) and
  each email's copy. Pure: no secrets.
- `supabase/templates/<name>.html`: the rendered files, committed so a change shows up in review. `npm run verify`
  fails when they don't match the source (`npm run auth-emails -- --check`).
- `scripts/auth-emails.mts`:
  - `npm run auth-emails` writes the files.
  - `npm run auth-emails -- --push <project ref>` sets **only** the `mailer_subjects_*` and
    `mailer_templates_*_content` fields on that project through the Management API (`SUPABASE_ACCESS_TOKEN`), then
    reads them back to check. Every other Auth setting stays as it is.

## Rules

- These are Go templates that Supabase fills in. Only `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`,
  and `{{ .Token }}` are used (a test enforces the list). The link stays `{{ .ConfirmationURL }}`, so the sign-in flow
  (`/auth/confirm`, see [product/accounts.md](product/accounts.md)) is unchanged.
- Email clients drop most CSS and block SVG: tables, inline styles, no images. Bricolage Grotesque loads where the
  client allows web fonts and falls back to the system font elsewhere.
- Copy follows the site's voice: say what the button does, say what happens if they didn't ask for it.
- Supabase's security notices (password changed, email changed, MFA added or removed, sign-in linked) are off on the
  project, so they aren't branded yet. Turning one on means adding it here first.

## Setup (per project)

1. Supabase Auth custom SMTP: `smtp.resend.com`, port 465, user `resend`, the Resend API key, sender
   "Quad", admin email `support@usequad.app` (dev set 2026-10-13).
2. `npm run auth-emails -- --push <ref>` (dev pushed 2026-10-13; prod at the formal release).
