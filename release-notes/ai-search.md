---
title: Showing up in ChatGPT and the other assistants
pr: 239
date: 2026-11-09
kind: plans
summary: The search plan now says how Quad gets cited when people ask an assistant about a college, and puts Quad's assistant connector where families can find it.
---

## What's new

Nothing on the site changes today. The [search plan](/roadmap/seo) gains a section on assistants: ChatGPT, Perplexity,
Claude, Gemini, and Google's AI answers.

- **Every data page will open with one plain sentence** that states its main fact with the year and the source, such
  as a college's admit rate, so an assistant that reads the page can quote it and cite Quad.
- **Quad's connector will be on the landing pages.** Quad already works inside ChatGPT, Claude, and Gemini; add it,
  and your assistant answers college questions with Quad's numbers and citations. The pages for parents, students, and
  counselors will say so and link to the steps.
- **Bing gets the sitemap on day one**, since ChatGPT's search reads Bing's index.

## Behind the scenes

- `specs/product/marketing/seo.md` "Assistants and AI search": how an assistant chooses what to cite, the answer
  line as a third template per data page type (with a Steward audit check and a test), an Assistants referrer group
  from a fixed list of domains, the connector block with a `connect_opened` event, and why `llms.txt` waits.
- The plan's "Layered in later" table gains the connector as a campaign message with its trigger; the measurement,
  console, and assistants specs point at the section.
