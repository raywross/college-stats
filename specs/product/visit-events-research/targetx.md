<!-- Research archive (specs/product/visit-events-research/README.md). Source: a sonnet research agent, 2026-10-15; four colleges reproduced. Kept verbatim apart from
     local paths; the raw pages and responses it cites were working files outside the repository and were not kept,
     except the fixtures under tests/fixtures/visit-events/. Decisions it led to are in specs/product/visit-events.md. -->

# How TargetX publishes admissions events (research, 2026-10-15)

Read-only research against public pages: GET only, one request a second per host, a browser user agent
(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36`),
no forms submitted, no sign-in. All saved pages and scripts are under `research/targetx/`. Everything below is a
fact about what a public GET or POST returned, except where marked "inference."

## 1. Coverage: which flavour each of the 151 TargetX/Salesforce colleges uses

`non-slate-vendors.json` lists 151 colleges (not 149; the file has grown since the brief's starting count) whose
`vendors[0]` is `"TargetX / Salesforce"`. `research/targetx/classify2.py` fetched each one's visit page (one request
a second) and classified the TargetX/Salesforce links found on it; `research/targetx/classify2-results.jsonl` is the
raw per-college result (unit_id, name, url, http code, flavour, up to 12 matched links). Re-running the regex against
the saved link lists (`research/targetx/targetx-colleges.json` has the input list) gives this breakdown:

| Flavour | Count | What it is |
|---|---:|---|
| **TargetX_Eventsb legacy events site** (`/events#/calendar`, `/events#/esr?eid=...`, or the same app under another site name) | **~67** | Visualforce + Angular 1.5 app; data via Visualforce Remoting (`apexremote`). Reproducible — see §2. |
| **ERx_Events ("EventListing") site** | **7** | A different TargetX/Salesforce product (Enrollment Rx events, built on the standard `Campaign` object) whose listing page embeds the full event list as JSON directly in the HTML. Reproducible, and simpler than the above — see §3. |
| **Lightning/Experience Cloud site** (`<client>.my.site.com/<App>/s/<page>`, e.g. EMEvents, applicantportal) | **10** | LWR (Lightning Web Runtime) community. No listing data is server-rendered; see §4 for why this one was not reproduced. |
| **"Summit Events" package** (`summitevents`, `SummitEventsRegister`) | **2** | A third-party ISV event module (not TargetX's own), seen at Crown College and George Mason University. Out of scope; not investigated further. |
| **Portal/application only** (TX_SiteLogin, applicantportal, TargetX_Portal, `.secure.force.com`) | 35 | The college's TargetX link is only its applicant portal/login — no events. |
| **Form/RFI only** (`/form`, `/rfi`, `/inquiry`, `ERx_Forms`) | 7 | Only a request-info form, no events. |
| **Chat widget only** (`ESW...` embedded service widget) | 8 | Only a Salesforce chat widget script. |
| **Other TargetX-flavoured link, unclassified** | 10 | A TargetX-looking link that didn't match any pattern above (grab-bag; mostly closer inspection would fold these into "portal only" or "form only"). |
| **No TargetX/Salesforce link found on this visit page** | 5 | Visit page fetch found no TargetX/Salesforce link at all (the vendor tag from the earlier probe may be stale, or the link is on a page the visit page doesn't link directly). |

Five examples of the legacy events flavour: Belmont Abbey College, Baptist Health Sciences University, Beacon
College, Buena Vista University, California State University-Chico.
Five examples of the ERx_Events/EventListing flavour: Mid-America Christian University, Spring Arbor University,
University of Alaska Anchorage, University of Wyoming, University of Wisconsin-Superior.
Five examples of the Lightning flavour: AdventHealth University, Arcadia University, Oral Roberts University,
University of Maine at Augusta, University of Southern Maine.

**Inference**: roughly two-thirds of the 151 (the legacy + ERx_Events flavours, ~74 colleges) publish events in a form
a script can read without a browser. The Lightning flavour (~10, ~7%) could not be reproduced with curl alone (§4).
The rest (~67, ~44%) link TargetX only for applying, a chat widget, or an RFI form — no events to read at all.

## 2. Protocol: TargetX_Eventsb legacy events site (the common case, ~67 colleges)

### Discovery
The visit page links `https://<org>.my.salesforce-sites.com/<sitename>#/calendar` (sitename is usually `events`, but
is whatever the org named its Visualforce site — Saint Francis University's is `events` with a doubled slash,
`//events/...`, from a template bug on their end, harmless once normalized). The fragment (`#/calendar`, `#/list`,
`#/esr?eid=...`) is a client-side Angular route and is never sent to the server; a bare `GET
https://<org>.my.salesforce-sites.com/<sitename>` returns the same page.

### Finding the call descriptor
The page's HTML embeds, inline, the Visualforce Remoting descriptor:
```
Visualforce.remoting.Manager.add(new $VFRM.RemotingProviderImpl({
  "vf": {"vid": "<VID>", ...},
  "actions": {
    "TargetX_Eventsb.eventsRemote": {
      "ms": [
        {"name": "initialize", "len": 1, "ns": "TargetX_Eventsb", "ver": 62.0, "csrf": "<CSRF>", "authorization": "<JWT>"},
        {"name": "getFutureEvents", "len": 4, "ns": "TargetX_Eventsb", "ver": 62.0, "csrf": "<CSRF>", "authorization": "<JWT>"},
        ... (getFeaturedEvents, getMyEvents, getRecEvents, register, login, etc. — write/auth methods, not needed)
      ]
    }
  },
  "service": "events/apexremote"
}));
```
Every method listed gets its own one-time `csrf` string and `authorization` JWT (decodes to `{"iat": <issued-ms>,
"exp": 0}` — no expiry claimed, but treat as page-session-scoped: fetch the page fresh each sync run rather than
caching tokens). `vid` is per-page-load, shared by every method.

### The two calls needed
Both are `POST https://<org>.my.salesforce-sites.com/<sitename>/apexremote`, `Content-Type: application/json`, and
**must** carry `Referer` and `Origin` set to the site's own origin (`https://<org>.my.salesforce-sites.com`) — a
request without them gets back
`{"statusCode":402,...,"message":"Unable to determine from which page the request originated"}`. No cookies are
needed; the call succeeds from a fresh process with no prior session (confirmed: `research/targetx/resp-belmontabbey-initialize.json`
was produced by a curl process that never touched the site before).

1. **`initialize`** — `{"action":"TargetX_Eventsb.eventsRemote","method":"initialize","data":[{}],"type":"rpc","tid":1,"ctx":{"csrf":...,"vid":...,"ns":"TargetX_Eventsb","ver":62.0,"authorization":...}}`.
   Returns the org's config (`cs`), notably `Search_Days__c` (how many days forward the org searches, e.g. 90),
   `Use_Location_Lookup__c` (whether venue comes from a related Location object or a plain text field),
   `SingleEventRegistrationURL__c` (the base booking URL, e.g. `.../events/targetx_eventsb__events#/esr`),
   `Org_Time_Zone__c`, `Num_Featured_Events__c`. Saved: `research/targetx/req-initialize.json` (template; the actual
   csrf/authorization must come from that page's own descriptor) → `research/targetx/resp-belmontabbey-initialize.json`.
2. **`getFutureEvents`** — `data: [params, locLookup, eid, invited]` where `params` is normally `{}` (the live app
   passes the page's own query string here — `?type=`, `?category=`, `?location=`, `?keyword=` filter server-side,
   but passing `{}` returns everything in the search window), `locLookup` is the `Use_Location_Lookup__c` boolean from
   step 1, `eid` is `''` (only used to flag the single event a `?eid=` detail page is viewing — see below), `invited`
   is `[]`. Returns every future event the org is willing to show publicly, no further request needed for detail.
   Saved: `research/targetx/req-belmontabbey-getFutureEvents.json` → `research/targetx/resp-belmontabbey-getFutureEvents.json`
   (58 events), and the same pair for Baptist Health Sciences University
   (`research/targetx/resp-baptist-events.json`, 9 events, `Use_Location_Lookup__c = false`) and Beacon College
   (`research/targetx/resp-beacon-events.json` / `-resolved.json`, 26 events, `Use_Location_Lookup__c = true` and
   actually populated).

**There is no paging and no separate detail call.** The "single event registration" page (`#/esr?eid=<id>`) calls the
exact same `getFutureEvents`, with the viewed id passed as `eid`; the Angular client just filters the one list for
the matching `Id` prefix (confirmed by reading `shared.event-data.service.js`, which does
`event.oe.Id.lastIndexOf($rootScope.eid, 0) === 0`). So one `getFutureEvents` call per college per sync gives the
whole window (listing + detail together), bounded by the org's own `Search_Days__c`/`Maximum_Returned_Events__c`
settings (not caller-controlled).

### Response field names (`result[i].oe`)
Confirmed from the three fixtures above, cross-checked against the app's own Angular templates
(`research/targetx/-event-list-list.html`, which binds these exact field names) and `shared.event-data.service.js`
(`getAddressInfo`, which assembles the display string from them):

| Field | Notes |
|---|---|
| `Id` | Salesforce record id (18-char), **lower-cased it is the Slate-style "slateId" analogue**; the booking URL is `<SingleEventRegistrationURL__c>?eid=<Id>`. |
| `Name` | Title. |
| `TargetX_Eventsb__Start_Date_Time__c`, `…End_Date_Time__c` | Epoch **milliseconds, UTC instant** — unambiguous, no text parsing needed (unlike Slate). |
| `TargetX_Eventsb__Time_Zone__c` | IANA zone name directly, e.g. `"America/New_York"` — also unlike Slate, no offset-string parsing needed. |
| `TargetX_Eventsb__type__c` | Free text the org defines (seen: "Campus Tour", "College Fair"; the probe URL for Belmont Abbey's calendar also references a "Special Event" type) — needs the same kind-classifying heuristic the Slate reader already has. |
| `TargetX_Eventsb__Description__c` | Plain text (not HTML) in these three fixtures. |
| `TargetX_Eventsb__Slots_Available__c` | String: a number, or `"Unlimited"`. |
| `TargetX_Eventsb__unlimited_attendees__c` | Bool, redundant with the above. |
| `TargetX_Eventsb__Waiting_List__c` | Bool — events with no open seats but a waitlist. |
| `TargetX_Eventsb__Cancelled__c` | Bool. |
| `TargetX_Eventsb__Registration_Deadline__c` | Epoch ms. |
| `TargetX_Eventsb__Registration_Open_Date__c` | Epoch ms, present only on events that aren't open for registration yet (seen once). |
| `TargetX_Eventsb__Allowed_Guests__c` | Int, present when non-zero. |
| `TargetX_Eventsb__Location_Lookup__c` / `…Location_Lookup__r` | **Only present when `Use_Location_Lookup__c` is true on the org** (and only on events that actually have a location set — both Belmont Abbey's 58 events and Baptist Health's 9 events had it null/absent; Beacon College's did not use the lookup field itself but did populate it: `{"TargetX_Base__City__c":"Leesburg","TargetX_Base__State__c":"FL","TargetX_Base__Street__c":"105 E. Main Street","TargetX_Base__Postal_Code__c":"34748","Id":"..."}`). The inner field namespace (`TargetX_Base__` here, `TargetX_SRMb__` in the app's own template source) **varies by org/package version** — read by suffix (`…City__c`, `…State__c`, `…Street__c`, `…Postal_Code__c`, `…Country__c`, `…Campus__c`, `…Building__c`, `…Room__c`), not by the full prefixed name. |
| `TargetX_Eventsb__Location__c` | Plain text venue, used instead of the lookup when `Use_Location_Lookup__c` is false (also null on all 9 Baptist Health events in this fixture — likely just not filled in for that org's public tour listing). |
| `TargetX_Eventsb__Map_URL__c` | A plain URL (seen pointing at the college's own "directions and parking" page, not a geocoded map) when present. |
| `TargetX_Eventsb__More_Information_URL__c` | Extra link, when present. |
| `TargetX_Eventsb__Event_Cost__c`, `…Invite_Only__c`, `…Allow_Invoicing__c`, `…Custom_Field_N_Required__c` | Registration-form mechanics, not needed for a read-only calendar. |
| **No field never appears when its value is null** — Salesforce's JSON serialization drops null fields entirely, so absence of a field (e.g. no `Location_Lookup__r` key at all) means null, not "field doesn't exist on this org." A reader must treat every field as optional. |

Top level (sibling of `oe`): `tzOffset`/`tzAbbr`/`endTzOffset`/`endTzAbbr` (redundant with the IANA zone + epoch ms),
`children` (sub-events, e.g. per-session breakout events under one umbrella — empty in all three fixtures), `poster`
(an image URL, seen once).

### A quirk worth flagging
One response (Beacon College's) came back in Salesforce's **reference-compressed JSON** form (`{"s": N, "v": ...}` /
`{"r": N}` instead of the plain nested object) — the other two did not. This is controlled by a flag on the request
(`ref` in the response envelope: `true` vs `false`) that this research did not isolate the cause of (inference: likely
an org/API-version difference, not something the caller sets). **A reader must detect and resolve both shapes.** The
resolver is short: walk the tree, `{"s": id, "v": value}` registers `value`'s resolved form (an array or object, kept
empty until filled) at `id` and recurses into it, `{"r": id}` returns the already-resolved value at `id`, anything
else recurses field-by-field. Reference python implementation used for this research: see the `resolve()` function
inlined in the session (not saved as a separate file since it's ~15 lines); it mirrors `VFExt3.util.resolveRefs` found
in `research/targetx/VFRemote.js` (search for `__resolveRefs`).

## 3. Protocol: ERx_Events "EventListing" site (~7 colleges)

A different TargetX/Salesforce product (package namespace `ERx_Events`, built on the standard Salesforce `Campaign`
object, not a custom `TargetX_Eventsb__Org_Event__c`). Visit pages link
`https://<org>.my.salesforce-sites.com/EventListing` (or another site name hosting the same `ERx_Events` Visualforce
page). **The entire event list is server-rendered into the page itself** — no remoting call is needed at all for a
read-only sync:
```html
<script>
  var a = '[{\"attributes\":{\"type\":\"Campaign\",...},\"Id\":\"701Q...\",\"ERx_Events__StartDateTime__c\":\"2027-02-24T17:00:00.000+0000\",...}]';
  ...
</script>
```
`a` is a JS single-quoted string holding the JSON array with its own quotes backslash-escaped for the JS layer (and,
in rich-text description fields, occasional stray un-escaped characters from double-encoded HTML entities — a
tolerant unescaper that drops an unrecognized backslash-escape rather than failing is needed; see
`research/targetx/parse_macu.py`). A `GET` of the visit-linked page is therefore the entire read: fetch
`https://<org>.my.salesforce-sites.com/EventListing`, regex out `var a = '(\[.*?\])';`, unescape, parse.
There is a second remoting method (`ERx_Events.CampusListingController.getListingEvent`, confirmed present in the
descriptor) that the page's own "load more" / date-filter widget calls to refetch a different date range — not
reproduced since the embedded `var a` already gives the full current listing; worth revisiting if a college's window
turns out to be short.

Fixture: `research/targetx/macu-eventlisting.html` (Mid-America Christian University) →
`research/targetx/macu-listing-events.json` (9 events, parsed).

### Response field names (each array element)
| Field | Notes |
|---|---|
| `Id` | Salesforce Campaign id. |
| `Name` | Title. |
| `ERx_Events__StartDateTime__c` | ISO-8601 with an explicit UTC offset, e.g. `"2027-02-24T17:00:00.000+0000"` — always `+0000` in the fixture (Salesforce serializes datetimes in UTC). |
| `StartDate` / `EndDate` | Plain `YYYY-MM-DD`, redundant with the above. |
| `ERx_Events__Event_Time__c` | A **pre-formatted display string**, e.g. `"05:00PM - 03:30PM"` — note the end time here is earlier than the start time textually (likely a data-entry quirk at this one college, not a format rule); do not parse this for the authoritative time, use `StartDateTime__c`/`EndDateTime__c` (an `…EndDateTime__c` field is implied by the app's own JS variable names, `tempendDateEvent`/`endDateEvent`, but was not populated in this fixture — the app falls back to `EndDate` plus the display string). |
| `ERx_Events__Campaign_Time_Zone__c` | A display string, e.g. `"(GMT-06:00) Central Standard Time (America/Chicago)"` — the IANA zone is the parenthesized suffix; a reader should extract it with a regex rather than trust the whole string. |
| `ERx_Events__Location__c` | Plain text venue (e.g. `"Fozard Hall"`) — **no separate street/city/state/ZIP fields were found for this flavour**; it is free text only. |
| `ERx_Events__Event_URL__c` | The booking URL, given directly (no construction needed), e.g. `".../EventListing/apex/ERx_Forms__PageMaker?pageId=...&eventId=<Id>"`. |
| `ERx_Events__Event_Description__c` | HTML. |
| `ERx_Events__OnlineGuestEnabled__c` | Bool — the online/virtual flag. |
| `ERx_Events__Ongoing_Event__c` | Bool. |
| `ERx_Events__Private__c`, `…Unlisted__c` | Visibility flags — likely should be excluded from a public listing even though they appeared in this public page's own embedded data (inference: the page may show them to a logged-in viewer differently than an anonymous one; this fetch was anonymous and they still appeared, so treat as informational, not a hard filter signal, unless a false/true split is observed across more colleges). |
| `ERx_Events__Maximum_Registrations__c`, `…Total_Event_Registrations__c`, `…Total_Waitlisted_Registrations__c`, `…Maximum_Waitlist_Registrations__c` | Availability math: open when `Total_Event_Registrations__c < Maximum_Registrations__c` (or `Maximum_Registrations__c` is 0/absent for unlimited — not observed in this fixture, all 9 had a cap), full-but-waitlistable when at cap and `Total_Waitlisted_Registrations__c < Maximum_Waitlist_Registrations__c`, else full/closed. |
| `ERx_Events__RSVP_Date__c` | Registration deadline, plain date. |
| `ERx_Events__Closed_Event_Message__c` | Text shown once closed — its presence being non-empty is not itself a closed signal (it was present on an open-looking event in the fixture; inference: it's just the configured message template, always populated). |
| `Type` | Here a Salesforce **Campaign** record type label (seen: `"Other"`), not a free-text category — classify from `Name`/`Event_Description__c` text the same way as the legacy flavour's `type__c`. |

## 4. Lightning/Experience Cloud sites (~10 colleges): not reproduced, and why

Example: `https://arcadiau.my.site.com/EMEvents/s/campus-tour` (Arcadia University), also AdventHealth University's
`applicantportal`, Oral Roberts University's `appreg`/`community`, University of Maine's `UMAEvents`/`USMEvents`.
These are **Lightning Web Runtime (LWR)** Experience Cloud sites — the modern successor to the classic Aura/Visualforce
communities the brief anticipated. The initial HTML (`research/targetx/arcadia-campus-tour.html`, 194KB) contains:
- No server-rendered event data of any kind (confirmed: no event titles, dates, or any recognizable payload anywhere
  in the raw HTML).
- An `aura.context`/`fwuid` descriptor and a reference to a generic framework bundle
  (`/EMEvents/s/sfsites/l/<url-encoded-config>/app.js`) — fetched (5.7MB) and searched for any trace of an
  events-specific Apex controller name, `@AuraEnabled` method, or `TargetX`/`eventsRemote`-style string: **none
  found**. This bundle is the shared LWR framework/runtime, not the page's own component code.
- The page's actual component code (an LWC bundle specific to whatever "campus tour" component the org built) is
  fetched by the browser at run time from a content-hash-keyed path that isn't present in the static HTML or the
  framework bundle — discovering it requires either executing the page's JS (to observe which additional script URLs
  and `POST /EMEvents/s/sfsites/aura` calls it makes) or finding Salesforce's standard UI API endpoints the component
  might use (`/services/data/v.../connect/communities/.../...`), which was not attempted here since it would mean
  guessing at Apex class/method names rather than reading them off the wire.

**This flavour needs a headless browser (or equivalent JS execution) to discover its actual data call; it cannot be
reproduced by curl alone from the static page.** Given it's an estimated 10/151 (~7%) of TargetX colleges, the
recommendation (inference) is to treat it the same way the Slate reader treats an undiscoverable host: record it,
leave it unread, and not block the rest of the sync on it.

## 5. Proposed reader contract (Slate reader's terms)

Two flavours are worth building (the legacy VF site and the ERx_Events SSR site); the Lightning flavour is a known
gap to record, not read.

```ts
// discoverTargetxSite(visitUrl): like discoverSlateHost — fetch the visit page, collect salesforce-sites.com /
// my.site.com / force.com links, classify by the patterns in §1-2, return { host, siteName, flavour, foundOn }
// or null. flavour: "eventsb_vf" | "erx_events_ssr" | "lightning_unreadable" | null.

// listTargetxEvents(site, http):
//   eventsb_vf:    POST .../${siteName}/apexremote twice (initialize, then getFutureEvents with data:[{}, cs.Use_Location_Lookup__c, '', []]),
//                  with Referer/Origin set to the site's own origin, csrf/vid/authorization taken fresh from that
//                  page's RemotingProviderImpl descriptor (re-fetch the page each run; do not cache tokens across runs).
//                  Resolve the response if it's in {s,v}/{r} reference form (detect via top-level "ref": true).
//   erx_events_ssr: GET the EventListing page, regex out `var a = '(\[.*?\])';`, unescape one JS-string layer
//                  (\" -> ", \' -> ', \\ -> \, drop any other backslash), JSON.parse.

// targetxEventDetail(...): not a separate call for either flavour — the listing call already returns every field;
// a detail page's ?eid=<id> is just a client-side filter of the same list.
```

Mapping to the stored row (`VisitEventRow`, `lib/visit-events/types.ts`):

| Stored column | `eventsb_vf` source | `erx_events_ssr` source |
|---|---|---|
| `title` | `Name` | `Name` |
| `starts_at` / `ends_at` | `Start_Date_Time__c` / `End_Date_Time__c` (epoch ms → ISO) | `StartDateTime__c` (epoch/ISO UTC); end time only as a display string — **gap**, see below |
| `timezone` | `Time_Zone__c` (already IANA) | regex out of `Campaign_Time_Zone__c`'s parenthesized suffix |
| `all_day` | inference: false unless start/end share the same clock time at midnight (not observed) | same |
| `online` | **gap**: no explicit per-event online flag found in these fixtures (Slate-style online detection doesn't map directly; would need `type__c`/`Event_Keywords__c` text heuristics) | `OnlineGuestEnabled__c` |
| `venue`/`address`/`city`/`state`/`zip` | `Location_Lookup__r.*City/State/Street/Postal_Code__c` (suffix match) when `Use_Location_Lookup__c`, else `Location__c` as venue text only (no structured address) | `Location__c` as venue text only — **no structured address fields exist in this flavour at all** |
| `lat`/`lng` | **gap**: no geocoded coordinates found (unlike Slate's static-map fallback); only a `Map_URL__c` link to an external page, not geocodable without fetching and parsing that page | **gap**: not present |
| `availability` | derive from `Slots_Available__c` (number or "Unlimited") + `unlimited_attendees__c` + `Waiting_List__c` + `Cancelled__c` | derive from `Total_Event_Registrations__c` vs `Maximum_Registrations__c` (+ waitlist fields) |
| `book_url` | `<SingleEventRegistrationURL__c from initialize>?eid=<Id>` | `Event_URL__c` directly |
| `source_url` | the site's base page URL | the EventListing page URL |
| `description` | `Description__c` (plain text in fixtures) | `Event_Description__c` (HTML — needs stripping, same as the Slate reader already does) |
| `kind` | classify `type__c` free text (seen: "Campus Tour", "College Fair"; probe also showed a "Special Event" category) the same way the Slate reader classifies its categories | classify `Type`/`Name`/description text (seen only "Other" as the Campaign record-type label) |

**What is missing, by flavour:**
- `eventsb_vf`: no coordinates at all (no static map to fall back on, unlike Slate); no per-event online flag; venue
  structure depends entirely on whether the org turned on `Use_Location_Lookup__c` *and* bothered to fill it in — in
  2 of 3 fixtures it was configured but empty.
- `erx_events_ssr`: no structured address at all, ever (venue is always free text); end time is unreliable (only a
  display string, `StartDateTime__c`'s companion end field wasn't populated in the one fixture pulled).
- Both: no ZIP in the `erx_events_ssr` flavour under any configuration.

## 6. Risks

- **Tokens are page-session JWTs with `exp: 0`** (no claimed expiry) but are clearly meant to be minted per page load
  (unique `iat`, unique per-method `csrf`); this research did not test how long a token keeps working after the page
  that minted it is no longer "current" — **recommend**: always fetch the page and extract fresh `vid`/`csrf`/
  `authorization` in the same run that calls `apexremote`, never cache them across syncs.
- **Referer/Origin enforcement**: the `apexremote` endpoint hard-fails (402) without a matching `Referer`/`Origin` —
  confirmed, not inferred. A sync job must set these explicitly (most HTTP clients don't send `Referer` by default
  for a bare POST the way a browser does for an XHR from a loaded page).
- **Per-org differences confirmed in just 3 fixtures**: namespace of the location lookup object varies
  (`TargetX_Base__` vs `TargetX_SRMb__` — read by field suffix, not full name); whether locations are populated at
  all varies; response reference-compression (`{s,v}`/`{r}`) appeared in one of three responses with no isolated
  cause — **assume any org could return either shape**.
- **Rate limits**: not tested beyond the ~1-second-per-host cadence used throughout this research; Salesforce
  Experience Cloud sites commonly have Shield/WAF rate limiting on anonymous traffic that a faster sync could trip —
  recommend keeping the Slate reader's existing per-host pacing.
- **Nothing here needed a login** — every call reproduced was against an anonymous/guest community page; the
  `register`/`login` remoting methods exist in the same descriptor but were never called.
- **Coverage numbers are from link-pattern classification of visit pages only**, not from confirming each college's
  endpoint actually answers (only 3 `eventsb_vf` orgs and 1 `erx_events_ssr` org were actually called) — the ~67/~7
  split should be treated as a good estimate, not a verified count; a real build should smoke-test a sample before
  committing to either flavour's parser.
- **ERx_Events embedded JSON is hand-escaped by the college's own Visualforce page**, not machine-generated JSON —
  the unescaper in `parse_macu.py` had to tolerate at least one case of mismatched escaping (a `\&#39;` sequence from
  double-encoded rich text); a production parser should fail soft (drop that one event, keep the rest) rather than
  aborting the whole page on a parse error from one bad field.

## Files

- `research/targetx.md` — this report.
- `research/targetx/targetx-colleges.json` — the 151 TargetX-vendor colleges from `non-slate-vendors.json`.
- `research/targetx/classify2.py`, `classify2-results.jsonl`, `classify2.log` — the coverage classification run (and
  its log).
- Legacy `TargetX_Eventsb` (VF remoting) fixtures: `belmontabbey-events.html`, `req-belmontabbey-getFutureEvents.json`
  / `resp-belmontabbey-getFutureEvents.json` / `resp-belmontabbey-initialize.json`; `baptisthealers-events.html`,
  `baptist-desc.json`, `req-baptist-*.json` / `resp-baptist-*.json`; `beacon-events.html`, `beacon-desc.json`,
  `req-beacon-*.json` / `resp-beacon-events.json` (raw, reference-compressed) / `resp-beacon-events-resolved.json`
  (resolved). Supporting app source pulled for the protocol write-up: `VFRemote.js`, `index.run.js`,
  `shared.data-methods.service.js`, `shared.event-data.service.js`, `calendar.controller.js`,
  `event-detail.controller.js`, `filters.controller.js`, `list-view.controller.js`, `container.controller.js`,
  `search.controller.js`, `templates.js`, `index.config.js`, `sp-events-detail.html`, `-event-list-list.html`,
  `-event-list-grid.html`, `-filter.html`.
- `ERx_Events` (SSR) fixture: `macu-eventlisting.html`, `macu-listing-events.json` (parsed), `parse_macu.py` (the
  unescaper/parser used), `macu-custom.js`, `req-macu-listing.json` (the remoting call descriptor, not called).
- Lightning flavour investigation: `arcadia-campus-tour.html` (the framework bundle fetched during that
  investigation, 5.7MB, was discarded after confirming it held no app-specific code).
