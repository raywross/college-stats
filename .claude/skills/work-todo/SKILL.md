---
name: work-todo
description: How to work Quad's admin To do list (documents a machine couldn't fetch) from the owner's own browser with Claude in Chrome. Use when the owner asks to work, clear, or go through the To do list, the To do tab, or the documents to fetch by hand.
---

# Working the To do list in the owner's browser

The To do list (`/admin/steward/todo`) names documents Quad's crawlers could not get: a Common Data Set on a host that
blocks robots, a class profile behind a bot check, a file nobody has located yet. You work it in the owner's Chrome,
signed in to the console as the admin, a row at a time, and record what you found with the row's own buttons. The
design and the owner's decisions are in `specs/product/todo-browser-agent.md`; this file is the procedure.

## Where
- Open `/admin/steward/todo?assistant=1`, the **assistant view**: one batch of up to 30 open rows you may work,
  highest reach first, with terms rows and logins on unlisted hosts already left out. Every button on that view records
  that the assistant pressed it. Work only from that view, or from a row's own page opened from it (its address ends
  in `?assistant=1`).
- Work the batch from the top. Stop after the batch and report (below); the owner reloads for the next one.

## Each row
1. **Read the row**: the kind (Common Data Set, class profile, campus page, high school profile), the edition it
   names, why a machine couldn't, and the attempts so far. The row's own page (its subject links it) has it all on
   one screen.
2. **Open the landing page** in a new tab. Look for the document of **that kind and that edition**: institutional
   research, admissions, "facts", "data", "Common Data Set", "class profile" pages; a site search for "Common Data
   Set"; a Google Drive or Box folder's file list. A newer edition than the one named is fine to record; an older one
   is not the document.
3. **Open the document** and read its cover: the title and the years. A PDF viewer page in Chrome is the document
   open; the address bar then shows the file's own address.
4. **Record**, with the row's buttons:
   - **Found**, with the document's address (the file's own, not a viewer page's when you can see one) and a note
     starting `Assistant:` with the edition you read on the cover. The console checks the address once and tells you
     what answered: a PDF (good), a web page (find the file's own link and press Found again), a host that refuses
     machines (the address is still worth recording; the file will come by hand), nothing there.
   - **No document published**, with where you looked in the note, when the site plainly has no such document.
   - **Nothing**, when unsure: leave the row open and say why in your report.
   - Never press **Done**: that is the owner's word for a document that arrived.

## Rules
- Only public links, and only what the page itself links. No sign-in anywhere, and no CAPTCHA or "prove you are a
  person" step of any kind: when one appears, close the tab, leave the row, and say so in the report. A Cloudflare
  "checking your browser" page that passes on its own is fine to wait through.
- A row behind a login appears in the assistant view only when the owner listed the host. Open it; if the session is
  live, work it like any other row. If a sign-in form appears, stop and ask the owner to sign in in that tab, then
  continue. Never type a password, and never press "I have a login here": only a person lists a login.
- A page that says the document is for counselors, members, or staff: do not record it as Found; leave the row and
  name the page in the report.
- robots.txt does not bind you (the owner's decision, 2026-11-08): you open what the page links, as the owner would.
- Never change what a row already says without a reason in the note.
- Do not wander: the task is the rows in the batch, not the site around them.

## Report
At the end of the batch, a short list:
- rows marked Found, by kind, with the console's answer for each (a PDF, a web page, refused, nothing there);
- rows marked No document published;
- rows left open and why (a CAPTCHA, a sign-in, a members-only page, unsure which file);
- hosts behind a login you met, so the owner can list the ones they have accounts for;
- anything that looked like a policy question (new terms, a login where there was none).
