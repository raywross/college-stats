---
title: "The admin To do list can be worked by an assistant in the owner's browser"
pr: 233
date: 2026-11-09
kind: feature
summary: The admin console's To do list of documents a machine couldn't fetch now has a view an assistant in the owner's own browser can work, a page per row, an address check when a document is marked Found, Found rows that reach the next data run, and a list of hosts the owner has a login on.
---

## What's new

Nothing changes on the site for students, parents, or counselors. This release is about how Quad's own data gets
collected when a college's website won't let a machine read it.

**The To do list, worked from a browser.** The admin console keeps a list of documents its crawlers couldn't get: a
Common Data Set on a site that blocks robots, a class profile behind a bot check, a file nobody has located yet. Until
now the owner worked that list by hand. It now has an **assistant view**: one batch of the rows an assistant in the
owner's own browser may take, with a playbook it follows, and every button recording that the assistant pressed it.
Rows that need a person stay with a person: a site whose terms forbid automated access, and any login the owner
hasn't said they have.

**Found means something now.** Marking a document Found used to be a note to a person. The address is now checked
once at the moment it is saved, so the console can say what answered there (a PDF, a web page, a site that refuses
machines), and the next data run of that college starts from the address and closes the row once it has the document.

**One page per row.** Each row has its own screen with everything on it: what to find, where to look, why a machine
couldn't, every attempt so far, and the actions.

**Logins.** The owner can list the hosts they have an account on, with whether documents from behind that login may
be used on the site. No password is stored anywhere in Quad: the login stays in the owner's browser. A row behind a
login on a listed host can then be worked from that browser.

## Behind the scenes

- The playbook is one text in `lib/steward/work-todo-skill.ts`: the repository's `.claude/skills/work-todo/SKILL.md`
  is generated from it (Claude Code in the repository loads that by itself), and the console serves the same text as a
  skill zip at `/admin/steward/todo/work-todo.zip` for the Claude app's Upload a skill.
- A Found row joins the owner's list for discovery step 0 (`lib/steward/todo-run.ts`); the run marks it done in its
  own change set once the document is archived. The crawlers' rules are unchanged: no blocked host is fetched by a
  machine, no user agent changes.
- The address check (`lib/admin/todo-probe.ts`) fetches as the run would, reads the first 4 KB only, and never a
  private address.
- Logins are `steward.logins` documents written through the console's audited path; no migration was needed.
- The design, the owner's decisions, and what is left (the file route for hosts that block crawlers, the citation
  form for documents from behind a login) are in `specs/product/todo-browser-agent.md`.
