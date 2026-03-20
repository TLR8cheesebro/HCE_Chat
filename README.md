# Healthcare-Edu Chatbot

## Internal Maintainer README

This document provides an overview of the Healthcare-Edu enrollment chatbot, a Render-hosted Node/Express application with a custom HTML/CSS/JS chat widget. It details the system's functionalities, architecture, and key components to assist future maintainers.

---

# 1. What this project does

The chatbot functions as a course specialist for Healthcare-Edu with the following primary responsibilities:

1. **Collect a required 3-step prescreen:**
   - Language + certificate goals
   - Availability
   - Name / phone / email / marketing consent
2. **Recommend the best course** using the course index spreadsheet.
3. **Pull matching lab schedule options** from Wix CMS and recommend the top 2.
4. **Maintain additional ranked schedule options** in memory for deterministic follow-up questions.
5. **Present payment guidance** from the payment index spreadsheet.
6. Detect "ready to enroll" intent and reveal the enrollment link for the currently recommended course.
7. **Sync chat logs to Wix Inbox** and send prescreen submissions to a Wix automation webhook.

---

# 2. High-level architecture

## Runtime split
There are three systems involved:

### A. Render / Node app
This is the main application and "brain" of the chatbot, responsible for:
- Serving the widget
- Loading Google Drive knowledge base
- Recommendation logic
- Payment logic
- Schedule-state memory
- OpenAI prompt construction
- Wix REST sync for chat logs
- Triggering Wix automation webhook for prescreens.
Main files include:
- `server.js`
- `recommendation.js`
- `schedules.js`
- `wixConnection.js`

### B. Wix backend 
Wix handles:
- Schedule data storage (CMS collections)
- Custom schedule endpoint
- Automations / contact creation / CRM workflows 
- Inbox visibility for staff.
Main file in this repo snapshot: `backend_from_wix.js` (Note: Contains both chatbot-related and unrelated Wix backend functions; not all functions are relevant to this project.)
The beginning of relevant code is commented with chatbot start or something like that.

### C. Google Drive knowledge base 
The chatbot reads documents and spreadsheets via a service account, including:
- Program/course knowledge docs,
- Course index spreadsheet,
- Payment index spreadsheet,
- Optional language/program config docs.
---
# 3. Current file responsibilities
## `server.js`
Main Express server handling startup, middleware, Google Drive KB loading/caching, prescreen webhook forwarding, `/chat` request handling (OpenAI calls), session state management, deterministic follow-up behavior, Wix chat sync helper, and enroll intent detection.
routes include:
details on endpoints like `/health`, `/config`, `/kb-status`, `/prescreen`, `/chat`.
the core of the application.
---
## `widget.html`
the embedded chat UI containing prescreen overlay, header bar, chat log, enroll button area, message input form with controls like `homeBtn`, `changeGoalsBtn`, `enrollBtn`.
elements facilitate user interaction with the chatbot interface.
---
'text continues with detailed descriptions of other files such as styles (`widget.css`), client-side behavior (`widget.js`), recommendation logic (`recommendation.js`), schedule building (`schedules.js`), Wix integration layer (`wixConnection.js`), backend from Wix (`backend_from_wix.js`), knowledge base placeholder (`knowledgebase.js`), package dependencies (`package.json`) and environment variables configuration.

# Important
The current `wixConnection.js` supports REST mode only if the Wix REST env vars are actually set. If they are missing, behavior may fall back or fail depending on the code path.

---

# 4. Google Drive knowledge base contract
The KB folder is recursively walked. The app looks for:

## General docs
Used for prompt grounding and FAQ-like answers.

## Special files by name
These file name patterns matter:
- training programs list
- `chat agent - course index`
- `chat agent - payment index`
- language file(s)

If you rename those, the parser may stop finding them.

---

# 5. Course index spreadsheet contract
The course index is critical. Expected headers include:
- `course_code`
- `course_name`
- `certificates_included`
- `link`
- `priority`
- `pif_discount_available`

## Meaning of `priority`
Lower number = higher preference.
Examples:
- `1` = highest priority
- `999` = lowest priority
Priority is only used as a tiebreaker **after**:
1. perfect match
2. overlap count
3. certificate bundle size
It should **not** override a better match.

## Meaning of `link`
This is the enrollment/payment URL used when the student is ready to enroll. This is now the source of truth for enroll URLs.

---

# 6. Payment index spreadsheet contract
Expected headers currently include:
- `course_code`
- `tuition_price`
- `paidinfull_discountapplicable`
- `paymentplan_applicable`
- `planlength_weeks`
- `frequency`
- `CUSTOM_OVERRIDE` (placeholder / partial behavior)
'this feeds payment guidance only.
'the known rule assumptions in code:
down payment is based on `DOWN_PAYMENT_PERCENT`
payment plan calculations are deterministic
some programs are intentionally not fully handled if considered too complex (such as Clinical Medical Assistant. ESL course are currently unimplemented.)'
does not support markdown inside code blocks, so I kept it simple.
defaults to plain text with line breaks. # Auto-Formatted Document.
use the chatgpt thread  that is trained on making FAQ's in order to facillitate future FAQ builds. 

This document outlines various procedures, checklists, and future plans for the project.

## M1. Maintenance Playbook

### If Recommendation Looks Wrong
Check in this order:
1. `recommendation.js`
2. `certificates_included` values in the course index, The course index is intentionally case-lowered just to avoid any foolishness.
3. Widget goal labels - these should be case lowered always. 
4. Course priorities
5. If they are more deeply incorrect you may need to clear KB cache and rebuild in render to make sure you aren't testing on an old bug

### If Schedule Answers Are Vague or Wrong
Check:
1. Wix schedule source rows
2. Wix schedule endpoint normalization
3. `schedules.js`
4. `scheduleSessionState` logic in `server.js`
5. this generally just requires explicit user input but for the most part it works
6. change the keywords to activate extended schedule are in schedules.js

### If Enroll Button Does Not Appear
Check:
1. Course index `link` column
2. Ready-to-enroll phrase detection in `server.js`
3. Widget `handleChatResponse(...)`
4. Enroll button state in sessionStorage
5. The keywords for this are in server.js around line 230

### If Wix Prescreen Automation Stops Working
Check:
1. `WIX_AUTOMATION_WEBHOOK_URL`
2. `/prescreen` route
3. Automation payload shape
4. Whether `prescreenSent` is suppressing duplicates as expected
5. By design it doesn't follow the user through multiple pages

### If Wix Chat Sync Stops Working
Check:
1. `wixConnection.js`
2. REST credentials
defaults to 
disabled.
3. Contact resolution 
defaults to 
disabled.
4. Conversation creation 
defaults to 
disabled.
5. Send message payload shape 
defaults to 
disabled.

### If Home Button Behaves Wrongly
Check:
1. Iframe detection in `widget.js`
2. Whether the widget is actually iframe-embedded in that environment.
---

## M2. Safe change checklist

**Before editing anything major:**
1. Save copies of:
   - `server.js`
   - `widget.js`
   - `recommendation.js`
   - `schedules.js`
   - `wixConnection.js`
2. If changing spreadsheet headers:
   - update parsers first
   - then update the spreadsheet
   - never do it in the opposite order during a live period
3. If changing widget control IDs:
   - update `widget.js` selectors too
4. If changing Wix schedule collection structure:
   - test full schedule detail follow-ups
   - test alternate schedule requests
   - test initial recommendation
5. If changing recommendation normalization:
   - test:
     - NAT only
     - HHA only
     - NAT + HHA
     - NAT + HHA + MAP
     - Phleb only
     - EKG only
---
# M3. Current launch-readiness notes (umm this is already launched ?)
- recommendation logic is now working as of 03/19/2026 
- connectivity is working and always was :)
- schedule follow-up behavior is implemented
- enrollment link flow exists and works fairly consistently, we do not want interrupting questions
- widget header actions exist and work as intended
That means the project is very close to launch-ready. Most remaining work is polish, QA, and future extensibility. (I already launched this, best data comes from live testing amirite ?)
---
# M4. Future improvements (not required for launch)
- move server-side session state to Redis
- create a proper KB admin/status page
- add analytics and funnel tracking - this is on wix side and not on code side. 
- add a staff-handoff trigger for edge cases - This just needs to give a button to get onto stephanies calendly
- refactor `server.js` into smaller modules once launch pressure is lower - (if I ever have time to prioritze speed)
- add a waiting ellipsis or something while the server thinks about its response. (it has intentional dead air time built in to give people time to read)
# M5. Final advice to future maintainer me 
If this thing breaks, do not panic. Start with this question:
> Is the bug in:
> - data,
> - normalization,
> - deterministic server logic,
> - widget state,
> - or external integration?
Then isolate one layer at a time:
1. widget payload 
2. server route 
3. recommendation / schedule helper 
4. Wix / Google Drive dependency 
This project looks big, but it is still basically:
- one Express server 
- one widget 
- one recommender 
- one scheduler 
- one Wix integration layer 
If you debug it layer-by-layer, it is manageable.
Good luck, future me.

This read me was last updated 03/19/2026 at 8:10 pm


