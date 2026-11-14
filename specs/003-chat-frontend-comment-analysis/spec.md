# Feature Specification: Chat Flow in the Dashboard: Conversations, Per-Client Chat Workflows, Client Data and Classified Comments

**Feature Branch**: `003-chat-frontend-comment-analysis`
**Created**: 2026-11-14
**Status**: Draft
**Input**: User description: "دلوقتي انا عاوز تربط فلو الشات بالفرونت اند وكمان في حاجات جديده اتضافت ان بنجمع الكومنتات والتصنيف بتاعها عشان نرجع نعملها تحليل ونشوف هل الموديل شغال صح ولا لا"

*(In English: connect the chat flow to the frontend. Also, new things were added: we now collect
comments together with their classification, so that we can come back, analyse them, and check
whether the model is working correctly.)*

**Follow-up input (clarify session 2026-11-14)**: "دلوقتي احنا هنثبت ال baseurl ونخلي لكل كلاينت ال endpoint ده الورك فلو الخاص بالشات بتاع الكلاينت ده وكمان عاوز ااكد ان نخلي في الفرونت انه يحط الداتا بتاعت الشات والسيرفس والاوفرز وكل معلومات الكلاينت"

*(In English: now we will fix the base URL, and give each client its own endpoint that is that
client's chat workflow. Also, make sure the frontend is where the chat data, services, offers and
all of the client's information are entered.)*

## Clarifications

### Session 2026-11-14

- Q: How long does a paused assistant stay paused? → A: The administrator chooses when pausing:
  until resumed, 1 hour, 24 hours, or 7 days. A timed pause ends by itself (FR-009, FR-013).
- Q: Can administrators filter classified comments by how the label was decided? → A: Yes. The
  Comments list has a decision-basis filter (rules, AI model, safe fallback, unknown), and the
  download applies it like the other filters (FR-017, FR-023).
- Q: Is there a maximum size for a comments download? → A: No maximum. The file contains every
  matching comment, and a download that cannot be completed is reported, never delivered as a
  partial file (FR-024).
- Q: How does an administrator find one customer's conversation? → A: A search box for the
  customer identifier, with an exact match, combined with the other filters. Searching inside
  message text is not part of this version (FR-002).
- Q: Are comment downloads recorded for accountability? → A: Yes. Each download is recorded with
  who made it, when, the filters used, the number of rows and whether it completed, without the
  comment text. No screen shows these records in this version (FR-030).
- Q: Who sets each client's chat workflow endpoint? → A: An administrator enters a short path for
  each client in the client's form. It is added to one fixed base address that is set once in the
  platform's configuration and is never changed from the dashboard (FR-031, FR-032).
- Q: What happens to a client's private messages when it has no endpoint? → A: There is no shared
  fallback address. An administrator must explicitly mark each client as subscribed to the chat
  service, which needs an endpoint. Only subscribed clients have private messages handed to a
  workflow (FR-033, FR-043 to FR-046).
- Q: What happens to existing clients at release? → A: A hard cut. Every client that exists at
  release starts as not subscribed, and administrators subscribe each one after the release.
  Until a client is subscribed, it gets no automatic chat replies (FR-047).
- Q: How fast do saved changes reach the chat workflow? → A: At once. The first private message
  handled after a save carries the saved client details, business information, services and
  offers (FR-048).
- Q: Are private messages of a client that is not subscribed stored? → A: No. They are ignored:
  not handed to a workflow, not answered and not stored. A "dropped" event is logged without the
  message text (FR-044).
- Q: How long are customer messages and classified comments kept? → A: For a period set in the
  platform's configuration, 12 months by default. A daily run deletes what is older (FR-049,
  FR-050).
- Q: Are edits to services, offers and business information recorded in the administrator
  activity record? → A: No, not in this version. The last save wins (see Assumptions).
- Q: What happens when a commenter replies to a private message the platform sent them, and the
  client is not subscribed to the chat service? → A: The reply is ignored like any other private
  message of an unsubscribed client (FR-044). The dashboard shows no warning.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse customer conversations (Priority: P1)

Customers write to a client's Facebook page or Instagram account, and the platform's assistant
answers them. Today those conversations are recorded, but the only way to read them is through
database or API tools. In the dashboard, an administrator opens **Conversations**, sees the
customers who wrote to the client's accounts, opens one, and reads what the customer wrote and
what was sent back.

**Why this priority**: This is the "chat flow" the dashboard is missing. It is useful on its own:
an administrator can check what the assistant is telling customers without leaving the dashboard.

**Independent Test**: For a client with a conversation that has three recorded exchanges, open
Conversations in the dashboard. Check that the conversation is listed with a preview of its latest
exchange, and that opening it shows the three exchanges in the order they happened.

**Acceptance Scenarios**:

1. **Given** a client with 3 conversations, **When** the administrator opens Conversations,
   **Then** they see 3 entries, the one with the most recent activity first. Each entry shows the
   platform, the client account that received the messages, how the customer is identified, the
   time of the last activity, and the start of the latest customer message and of the reply it
   received.
2. **Given** a conversation with 30 recorded exchanges, **When** the administrator opens it,
   **Then** they read the latest 20 exchanges from oldest to newest, each with the customer's
   message, the reply that was sent, and the time. They can load the 10 earlier exchanges.
3. **Given** a customer sent three messages in quick succession and the assistant answered them
   together, **When** the administrator opens the conversation, **Then** the three messages appear
   as one exchange, each on its own line, followed by the single reply.
4. **Given** more conversations than fit on one page, **When** the administrator reaches the end
   of the page, **Then** they can load the next page without losing their place.
5. **Given** conversations on both Facebook and Instagram, **When** the administrator filters by
   platform, **Then** only conversations on that platform are listed. The administrator can also
   filter by client.
6. **Given** a conversation in which the customer wrote but no reply could be sent, **When** the
   administrator looks at the list, **Then** the conversation is listed, and opening it says that
   no exchange has been recorded yet.
7. **Given** a conversation written in Arabic, **When** the administrator opens it, **Then** the
   text reads right to left and keeps its line breaks.
8. **Given** a customer who wrote to both of a client's accounts, **When** the administrator
   enters that customer's identifier in the search box, **Then** only that customer's
   conversations are listed, one per account. The search matches the whole identifier, ignores
   spaces before and after it, and works together with the other filters.
9. **Given** an identifier that no conversation has, **When** the administrator searches for it,
   **Then** the list says that no conversation was found for that identifier.

---

### User Story 2 - Pause the assistant for one conversation (Priority: P2)

Sometimes the assistant should stop answering one customer, for example when a staff member wants
to handle that customer personally outside the dashboard, or when the assistant keeps getting the
conversation wrong. In an open conversation, an administrator turns the assistant off for that
conversation. The administrator chooses how long: until they turn it back on, or for 1 hour, 24 hours or 7
days, after which the assistant starts answering again by itself. Other conversations and the
comment handling are not affected.

**Why this priority**: Once administrators can read conversations, the first thing they need when
a conversation goes wrong is a way to stop it. It depends on User Story 1 to find and open the
conversation. Sending a manual reply from the dashboard is not part of this version.

**Independent Test**: In a test conversation, pause the assistant and send three customer
messages. Check that no reply is sent, that the three messages appear marked as not answered, and
that after resuming, the next customer message gets a reply.

**Acceptance Scenarios**:

1. **Given** an open conversation in which the assistant is active, **When** the administrator
   pauses the assistant and chooses a duration (until resumed, 1 hour, 24 hours or 7 days),
   **Then** the conversation shows "Assistant paused" with the time the pause ends (or "until
   resumed"), and the same marker appears on its entry in the list.
2. **Given** a paused conversation, **When** the customer sends a new message, **Then** no
   automatic reply is sent, and the message appears in the conversation marked as not answered by
   the assistant.
3. **Given** a paused conversation with 2 unanswered messages, **When** the administrator resumes
   the assistant and the customer then sends a new message, **Then** the assistant answers the new
   message only. The 2 earlier messages stay marked as not answered.
4. **Given** one administrator paused a conversation, **When** another administrator opens it,
   **Then** they see that it is paused, who paused it, and when.
5. **Given** the assistant is paused in one conversation, **When** the same customer writes to
   another of the client's accounts, or another customer writes, **Then** those conversations are
   answered as usual.
6. **Given** conversations in which some are paused, **When** the administrator turns on "only
   paused conversations", **Then** only the paused ones are listed.
7. **Given** a user with the client role, **When** they try to pause or resume a conversation,
   **Then** the request is refused and the conversation does not change.
8. **Given** a conversation paused for 1 hour, **When** the hour passes, **Then** the assistant is
   active again without anyone acting, and the customer's next message is answered. Messages
   received during the hour stay marked as not answered.
9. **Given** a conversation paused for 24 hours, **When** an administrator resumes it after 2
   hours, **Then** the assistant is active again at once, and the original end time no longer
   applies.

---

### User Story 3 - Review every classified comment (Priority: P3)

When a customer comments on a client's post, the platform decides what kind of comment it is
(engagement, inquiry, complaint, spam, insult, or unsure) and acts on it. The platform now keeps
each comment together with its label and the reason for it. In the dashboard, an administrator
opens **Comments** and sees every classified comment, and can narrow the list by label, decision
basis, platform, client and date.

**Why this priority**: This makes the newly collected data visible. It lets the team look at real
comments and labels, and spot wrong labels by eye, before any formal analysis. It does not depend
on User Stories 1 and 2.

**Independent Test**: Process one comment of each of the six kinds for a test client. Open
Comments and check that all six appear with the right label. Filter by one label and check that
only comments with that label remain.

**Acceptance Scenarios**:

1. **Given** classified comments of every label, **When** the administrator opens Comments,
   **Then** they see the newest first. Each entry shows the comment text, its label, how the label
   was decided, the platform, the client, and the time it was classified.
2. **Given** 40 complaints and 200 other comments, **When** the administrator filters by
   "Complaint", **Then** only the 40 complaints are listed, and the list shows a total of 40.
3. **Given** a date range, **When** the administrator applies it, **Then** only comments
   classified inside the range are listed, and an end date earlier than the start date is
   rejected with a clear message.
4. **Given** a comment with no text (for example a sticker or a GIF), **When** it is listed,
   **Then** it shows "No text" and its label.
5. **Given** a comment of several thousand characters, **When** it is listed, **Then** the list
   shows its beginning, and the administrator can expand it to read all of it.
6. **Given** a new customer comment arrives on a client's post, **When** the platform has
   classified it and the administrator refreshes the list, **Then** the comment appears at the top.
7. **Given** no comment has been classified yet, **When** the administrator opens Comments,
   **Then** they see an explanation instead of an empty table.

---

### User Story 4 - Collect comments so the model can be judged later (Priority: P4)

The team wants to analyse the collected comments later and decide whether the classifier is
working correctly. For that, the collected data must be complete, must not mix up different kinds
of decisions, and must be easy to take out of the dashboard. The analysis itself, including
judging each label, happens outside the dashboard in this version.

**Why this priority**: The analysis happens later. This story makes sure that when the team is
ready, the data is trustworthy and nothing has to be reconstructed. It builds on User Story 3.

**Independent Test**: Run a reply on a post with 5 unreplied comments, and send one comment that
the classifier cannot decide while the AI model is unavailable. Check that all 6 comments are
recorded once, that each says how its label was decided, and that the downloaded file for the
period contains exactly those comments.

**Acceptance Scenarios**:

1. **Given** a reply run on a post with 5 unreplied comments, **When** the run finishes, **Then**
   those 5 comments are in the classified list, each exactly once, the same as comments that
   arrived live.
2. **Given** a comment whose label came from the built-in rules, **When** it is listed, **Then**
   its decision basis is "rules", together with which rule matched.
3. **Given** a comment whose label came from the AI model, **When** it is listed, **Then** its
   decision basis is "AI model", together with which model gave the label.
4. **Given** the AI model is unavailable and the comment is labelled spam as a safe default,
   **When** it is listed, **Then** its decision basis is "safe fallback", so it can be told apart
   from comments the classifier really judged to be spam, and it can be listed on its own with the
   decision-basis filter.
5. **Given** the same comment is delivered twice, or is classified again, **When** the list is
   viewed, **Then** there is one entry for it, showing the latest label and reason.
6. **Given** a filtered Comments list (for example "Complaint", last 30 days), **When** the
   administrator downloads it, **Then** the file has one row per matching comment with the same
   fields as the list, and the number of rows equals the list's total.
7. **Given** a comment can be answered but its classification cannot be stored, **When** the
   comment arrives, **Then** the customer still gets the normal handling, and operators can see
   from the logs that storing failed.
8. **Given** a user with the client role, **When** they try to download the comments, **Then**
   the request is refused.
9. **Given** comments decided by the rules, by the AI model, by the safe fallback, and comments
   from before this feature whose basis is unknown, **When** the administrator filters by "AI
   model", **Then** only the comments decided by the AI model are listed, the total counts only
   them, and a download made with that filter contains only them.
10. **Given** a filter that matches 100,000 comments, **When** the administrator downloads them,
    **Then** the file contains all 100,000, and messages and comments from customers keep being
    answered at their usual speed while the file is prepared.
11. **Given** an administrator downloads comments with some filters, **When** the download
    finishes, **Then** a record exists with that administrator, the time, the filters, the number
    of rows and "completed", and the record contains no comment text.

---

### User Story 5 - Give each client its own chat workflow (Priority: P5)

Today every client's private messages are handed to the same chat workflow address. In this
version the platform has one fixed base address for the automation tool, set once in the
platform's configuration and never changed from the dashboard. Each client has its own chat
workflow endpoint: a short path that an administrator enters in the client's form. An administrator also marks each client as subscribed to the chat service. Only a
subscribed client's private messages go to the workflow at the base address followed by that
path, so each client's chat can be built, changed or stopped on its own, and a client that has
not subscribed gets no automatic chat replies.

**Why this priority**: Separate workflows let each business have its own chat logic, and one fixed
base address replaces an address that has to be typed correctly in many places. It works on its
own: set the endpoint of one client and only that client's messages move.

**Independent Test**: Give two test clients different endpoints and subscribe both, send one
private message to each
client's account, and check that each message reached only its own client's workflow, carrying
only that client's information.

**Acceptance Scenarios**:

1. **Given** a client that is subscribed to the chat service and whose endpoint is "chat-acme",
   **When** a customer sends a private message to that client's account, **Then** the message is
   handed to the workflow at the base address followed by "chat-acme", and to no other workflow.
2. **Given** two subscribed clients with different endpoints that receive messages at the same
   time, **When** both are handled, **Then** each message goes to its own client's workflow and
   carries only its own client's information.
3. **Given** the client form, **When** the administrator enters an endpoint that is not a plain
   path segment (for example a full web address, text with spaces, a slash, or ".."), **Then** the
   form rejects it with a message on that field and nothing is saved.
4. **Given** an endpoint already used by another client, **When** the administrator saves it,
   **Then** the conflict is reported on that field and nothing is saved.
5. **Given** a client with an endpoint, **When** the administrator changes it and saves, **Then**
   private messages handled after the save go to the new endpoint, and the change is recorded
   like any other edit of the client.
6. **Given** a user with the client role, **When** they try to read or change a client's
   endpoint or subscription, **Then** the request is refused.
7. **Given** a client that has not subscribed to the chat service, **When** a customer sends a
   private message to its account, **Then** the message is not handed to any workflow, no
   automatic chat reply is sent, and nothing is stored: no conversation appears in Conversations.
8. **Given** a client with no endpoint, **When** the administrator tries to mark it as subscribed,
   **Then** the form rejects it with a message on the endpoint field and nothing is saved.
9. **Given** a subscribed client, **When** the administrator tries to remove its endpoint without
   unsubscribing it, **Then** the form rejects it with a message and nothing is saved.
10. **Given** a subscribed client, **When** the administrator unsubscribes it and saves, **Then**
    its endpoint stays stored, and its private messages stop going to the workflow from the save
    on.
11. **Given** the clients list, **When** the administrator looks at it, **Then** each client shows
    whether it is subscribed to the chat service, and the administrator can show only the
    clients that are not subscribed.

---

### User Story 6 - Manage a client's business information, services and offers (Priority: P6)

The chat workflow answers customers with the client's business information (contact details,
location, work hours, payment and installment options), its services (name, description, price,
variants) and its offers (title, discount, dates). Today these can be changed only through API
tools. On a client's page, an administrator views, adds, edits and deletes them. Together with the
client profile and chat settings that are already in the dashboard, an administrator can enter
all of a client's information in one place.

**Why this priority**: Without correct prices, offers and opening hours the assistant has
nothing right to tell customers. This lifts the exclusion that feature 001 left for these three
kinds of data. It does not depend on User Story 5.

**Independent Test**: For a client with no business information, services or offers, enter its
business information, two services and one offer that covers one of the services. Check that all
of them are shown on the client's page and that the client's chat workflow request carries them.

**Acceptance Scenarios**:

1. **Given** a client's page, **When** the administrator opens its business information, **Then**
   they can enter and change phone, email, WhatsApp, website, social media links, location (city,
   district, full address, map links), work hours, payment methods and installment options. Every
   field is optional, and a client has at most one business information record.
2. **Given** a client's page, **When** the administrator adds a service with a name, and
   optionally a description, a price, variants (each with a name and a price, names unique within
   the service) and an offer, **Then** the service appears in the client's list, and they can edit
   or delete it.
3. **Given** a client's page, **When** the administrator adds an offer with a title, an optional
   description, a discount type (percentage or fixed amount), a positive discount value, a start
   date and an end date, **Then** the offer appears in the client's list.
4. **Given** the offer form, **When** the end date is before the start date, or a percentage
   discount is above 100, **Then** the form rejects it with a message on that field and nothing is
   saved.
5. **Given** an offer that covers 3 services, **When** the administrator deletes it after
   confirming, **Then** the offer is removed, the 3 services stay, and they no longer have an
   offer. The confirmation says this.
6. **Given** a service and an offer that belong to different clients, **When** the administrator
   tries to link them, **Then** the link is refused. Only offers of the same client can be chosen.
7. **Given** more services or offers than fit on one page, **When** the administrator reaches the
   end of the page, **Then** they can load the next page. Services sort by name, price or date
   created, and offers by title, start date, end date or date created.
8. **Given** text in Arabic, **When** the administrator saves it in any of these forms, **Then**
   it is stored and shown right to left, unchanged.
9. **Given** a user with the client role, **When** they try to view or change another business's
   information, services or offers, or to use these screens, **Then** they do not see the screens,
   and their requests are refused, because these screens are for administrators only (FR-026).
10. **Given** a service whose price was changed from 100 to 120 and saved, **When** the next
    private message of that client is handled, **Then** the information that goes to the client's
    workflow shows the price 120, not 100. The same holds for a changed offer, business
    information, or client setting.

---

### Edge Cases

- A customer sends many messages in a short time: they are answered as one batch and shown as one
  exchange (User Story 1, scenario 3).
- The reply to a customer could not be sent: the conversation exists, but no exchange is recorded
  for that attempt.
- The assistant is paused while a batch of messages is waiting for its reply: that reply is not
  sent, and the messages are shown as not answered.
- Two administrators pause or resume the same conversation at about the same time: the last action
  wins, and both actions are recorded.
- A conversation cannot be paused before it exists, that is, before the customer's first message
  has been recorded.
- An administrator pauses a conversation that is already paused: the new duration replaces the
  old one, and the change is recorded.
- A timed pause ends while messages received during it are still unanswered: the assistant
  answers only messages that arrive after the pause ended (FR-012).
- A comment is long (up to 8,000 characters), empty, or contains Arabic text, emoji, or line
  breaks: it is shown as written without breaking the layout.
- A comment is classified again later (for example after a retry): its entry is updated, not
  duplicated, and only the latest label is kept. The earlier label is not kept.
- The client has turned off both comment replies and likes: the platform does not classify its
  comments, so they are not collected. The Comments screen says that comments from clients with
  comment automation turned off are not included.
- The AI model fails and the comment is labelled spam as a safe default: it is collected but
  marked as a fallback, so it does not distort an analysis of the model.
- A customer deletes a comment on Facebook or Instagram after it was collected: the collected
  entry stays.
- A client is deleted: its conversations and collected comments are deleted with it.
- A user opens a conversation or comment that belongs to a client they are not allowed to see:
  they get "not found", and nothing shows whether it exists.
- A list has tens of thousands of entries: the dashboard still shows the first page quickly and
  never tries to load everything at once.
- A download is very large, or is interrupted (for example the administrator closes the page or
  the connection drops): the administrator is told it did not finish, no partial file is
  presented as complete, and customer-facing handling is not slowed down. The download record says
  it did not complete.
- A private message is resent because no acknowledgment came back, and its client's endpoint was
  changed in between: each delivery attempt uses the endpoint the client has at that moment.
- The workflow at a client's endpoint does not exist or is down: the message is handled like any
  workflow failure today (resent a limited number of times, then kept for operators). The
  dashboard does not check that the workflow exists when the endpoint is saved.
- A client is deleted: its endpoint becomes free for another client.
- A subscribed client is unsubscribed while its messages are waiting for a workflow's answer: no
  delivery attempt is made after the save, and the message is kept for operators like any other
  message that could not be delivered.
- A customer writes to a client that nobody has subscribed yet: no automatic reply is sent and the
  message is not stored. It stays in the page's own inbox on Facebook or Instagram. The clients
  list shows which clients are not subscribed, so that none is forgotten.
- A commenter replies to a private message that the platform sent them (the private-message
  settings of feature 001), and the client is not subscribed to the chat service: the reply is
  ignored and not stored, like any other private message to that client. The dashboard shows no
  warning about this combination of settings.
- This feature is released: every existing client is not subscribed, so the customers of a client
  that has not been subscribed yet get no automatic chat reply until an administrator subscribes
  it. The list of clients that are not subscribed is the administrator's checklist for this.
- A change is saved while a private message of that client is being handled: that message carries
  either all of the old information or all of the new, never a mix. A message that was already
  handed to a workflow before the save is not changed.
- A conversation is still active, but some of its exchanges are older than the retention period:
  those exchanges are deleted, and the conversation and its newer exchanges stay.
- A comment first classified 13 months ago was classified again last week: it is deleted with a
  12-month period, because its age counts from the first classification.
- A file that an administrator downloaded before the deletion still has the deleted rows: files
  outside the platform are not covered by the retention period.
- Two administrators edit the same service, offer or business information at about the same time:
  the last save wins. This differs from a client's own details, where an outdated save is refused.

## Requirements *(mandatory)*

### Functional Requirements

**Conversations**

- **FR-001**: The dashboard MUST list customer conversations, most recent activity first, in
  pages. Each entry MUST show the platform, the client account that received the messages, a
  customer identifier, the time of the last activity, whether the assistant is paused, and a
  preview of the latest customer message and the reply it received.
- **FR-002**: Administrators MUST be able to filter the conversation list by platform, by client,
  and to show only paused conversations. They MUST also be able to search by customer
  identifier, matching the whole identifier. The search works together with the filters.
- **FR-003**: Administrators MUST be able to open a conversation and read its exchanges from oldest
  to newest. Each exchange MUST show the customer's message, the reply that was sent (or that the
  message was not answered by the assistant), and the time. The latest 20 exchanges are shown
  first, and earlier ones load on request.
- **FR-004**: Messages that were answered together MUST appear as one exchange, with each message
  on its own line.
- **FR-005**: Text MUST be shown exactly as written, including Arabic (right to left), emoji and
  line breaks, and long text MUST NOT break the layout.
- **FR-006**: The conversation screens MUST show a clear empty state when there are no
  conversations, and when a conversation has no recorded exchange.
- **FR-007**: Administrators MUST be able to refresh the conversation list and an open
  conversation to see new activity. Updates that appear without refreshing are not required.
- **FR-008**: The dashboard MUST NOT let anyone send a message to a customer. Pausing or resuming
  the assistant is the only action the conversation screens offer.

**Pausing the assistant**

- **FR-009**: Administrators MUST be able to pause and resume the assistant for one conversation
  from the open conversation. When pausing, the administrator MUST choose one duration: until
  resumed, 1 hour, 24 hours or 7 days. The screen MUST show clearly whether the assistant is
  active or paused and, for a timed pause, when it ends.
- **FR-010**: While a conversation is paused, the assistant MUST NOT send any automatic reply in
  it. A reply that is being prepared when the pause takes effect MUST NOT be sent.
- **FR-011**: While a conversation is paused, new customer messages MUST still be recorded and
  shown in the conversation, marked as not answered by the assistant.
- **FR-012**: After the assistant is resumed, it MUST answer the customer's next message. It MUST
  NOT answer messages that arrived during the pause.
- **FR-013**: A paused conversation MUST stay paused until its chosen duration ends or an
  administrator resumes it, whichever comes first, including across restarts of the platform. When
  a timed pause ends, the assistant MUST become active again within 1 minute without anyone
  acting. The state MUST be the same for every administrator, in the list and in the open
  conversation.
- **FR-014**: Each pause and resume MUST be recorded with who did it, when, and, for a pause, the
  chosen duration. A resume caused by the end of a timed pause MUST be recorded as automatic. A
  paused conversation MUST show who paused it and when.
- **FR-015**: Pausing one conversation MUST NOT change how other conversations or comments are
  handled.

**Classified comments**

- **FR-016**: The dashboard MUST list every comment the platform has classified, most recent
  first, in pages. Each entry MUST show the comment text (or "No text"), its label, its decision
  basis and the reason, the platform, the client, and the time it was classified.
- **FR-017**: Administrators MUST be able to filter the comment list by label, decision basis
  (rules, AI model, safe fallback, or unknown), platform, client and date range. The list MUST
  show the total number of comments that match the filters.
- **FR-018**: A date range whose end is before its start MUST be rejected with a message that says
  what is wrong.
- **FR-019**: Long comments MUST be cut in the list and be readable in full on request.
- **FR-020**: The Comments screen MUST say that comments from clients with comment automation
  turned off are not classified and so are not included.

**Collecting comments for later analysis**

- **FR-021**: Every comment the platform classifies MUST be recorded exactly once, whether it
  arrived live or was handled by a reply run on a post. A comment that is delivered or classified
  again MUST update its existing entry, not create a second one.
- **FR-022**: Each recorded comment MUST state how its label was decided, in a form that can be
  filtered and counted: the built-in rules, the AI model, or a safe fallback after the AI model
  failed. For the AI model it MUST say which model gave the label.
- **FR-023**: Following from FR-022, a comment labelled by the safe fallback MUST be distinguishable from a comment the
  classifier judged to be spam, in the list, in the decision-basis filter and in the downloaded
  file.
- **FR-024**: Administrators MUST be able to download the comments that match the current filters
  as a file that opens in common spreadsheet and data tools. The file MUST contain one row per
  comment with the same fields as the list, MUST keep Arabic text intact, and its row count MUST
  equal the list's total. There is no limit on the number of rows. If a download cannot be
  completed, the administrator MUST be told, and MUST NOT receive a partial file as if it were
  complete.
- **FR-025**: A failure to record a comment's classification or a conversation's exchange MUST NOT
  stop the customer-facing handling, and MUST be visible to operators.

**Access and privacy**

- **FR-026**: Only signed-in administrators MUST be able to use the Conversations and Comments
  screens, to pause or resume the assistant, to download comments, to set a client's chat workflow
  endpoint, and to manage a client's business information, services and offers in the dashboard.
  Users with the client role MUST NOT see these screens, and their requests to pause, resume,
  download or change an endpoint MUST be refused.
  Data that client-role users can already read about their own business stays readable to them as
  before.
- **FR-027**: A user who is limited to one client MUST never see or count data of another client,
  even by changing the client in a link or a filter. On the routes such a user may use
  (conversations and classified comments), requests for another client's data MUST be answered as
  "not found". Every other route in this feature refuses such a user (FR-026).
- **FR-028**: Conversation text and comment text MUST NOT be written to logs at the default
  production logging level.
- **FR-029**: Changes to the data the dashboard already receives MUST keep working with the
  dashboard version that is currently deployed.
- **FR-030**: Each comments download MUST be recorded with who made it, when, the filters used, the
  number of rows, and whether it completed. The record MUST NOT contain any comment text, and it
  MUST be available to operators. No dashboard screen for these records is required.

**Per-client chat workflow**

- **FR-031**: The address of the automation tool (the base address) MUST be one fixed value set in
  the platform's configuration. It MUST NOT be entered, shown or changed from the dashboard, and
  it MUST NOT differ from one client to another.
- **FR-032**: Each client MUST be able to have a chat workflow endpoint: one short path segment
  that an administrator enters in the client's form. It is up to 100 characters, made of letters,
  digits, hyphens and underscores only.
- **FR-033**: A subscribed client's private messages MUST be handed to the workflow at the base
  address followed by that client's endpoint, and to no other client's workflow. Each message MUST carry
  only its own client's information.
- **FR-034**: An endpoint MUST belong to at most one client. A conflict MUST be reported on that
  field, and nothing MUST be saved.
- **FR-035**: An endpoint that is anything other than a plain path segment (a full web address, a
  host name, a slash, "..", spaces, a query) MUST be rejected with a message on the field. No
  stored value can change the host that the platform sends private messages to.
- **FR-036**: Changing an endpoint MUST follow the client edit rules of feature 001: confirmation
  before discarding unsaved changes, refusal of an outdated save, and a record of the change in the
  administrator activity record. The new value MUST apply to every delivery attempt made after the
  save.

**Client information in the dashboard**

- **FR-037**: On a client's page, administrators MUST be able to view, create, edit and delete that
  client's business information (at most one record per client), services and offers. With the
  client profile and settings of feature 001, this lets an administrator enter all of a client's
  information from the dashboard.
- **FR-038**: Business information MUST support these optional fields: phone and WhatsApp (up to 50
  characters each), email (a valid address, up to 255), website (an http or https address, up to
  255), social media links (platform name and web address), location (city, district, full
  address, map links), work hours (days with start and end time, and different hours on different
  days), payment methods and installment options (lists of text without duplicates).
- **FR-039**: A service MUST have a name (up to 255 characters). It MAY have a description (up to
  255), a price (free text up to 255), variants (each with a name and a price, names unique within
  the service) and a link to one offer of the same client.
- **FR-040**: An offer MUST have a title (up to 255 characters), a discount type (percentage or
  fixed amount), a positive discount value (a percentage up to 100), a start date and an end date
  that is not before the start date. It MAY have a description (up to 255). One offer can cover
  several services.
- **FR-041**: Deleting an offer MUST NOT delete its services, and the confirmation MUST say that
  its services stay without an offer. Deleting a service, an offer or business information MUST ask
  for confirmation.
- **FR-042**: Each invalid field MUST show a message, and an invalid submission MUST NOT change
  stored data. Lists of services and offers MUST be paged and sortable.

**Chat service subscription**

- **FR-043**: Each client MUST have a chat service setting, subscribed or not subscribed, that an
  administrator changes in the client's form. A new client starts as not subscribed.
- **FR-044**: The platform MUST hand private messages to a workflow only for clients that are
  subscribed. For a client that is not subscribed, it MUST NOT hand any message to a workflow,
  MUST NOT send any automatic chat reply, and MUST NOT store the message or create a conversation
  for it. Each ignored message MUST be logged as a dropped event, without the message text.
- **FR-045**: A client MUST NOT be marked as subscribed without a chat workflow endpoint, and the
  endpoint of a subscribed client MUST NOT be removed. Either attempt MUST be rejected with a
  message on the endpoint field, and nothing is saved. Unsubscribing keeps the endpoint stored.
- **FR-046**: Changing the subscription MUST follow the same edit rules as the endpoint (FR-036),
  and the new value MUST apply to every delivery attempt made after the save. The clients list and
  a client's page MUST show whether the client is subscribed, and the list MUST let the
  administrator show only clients that are not subscribed.
- **FR-047**: Every client that exists when this feature is released MUST start as not subscribed,
  with no endpoint. Its private messages get no automatic reply until an administrator subscribes
  it.

**Changes reach the chat workflow**

- **FR-048**: A saved change to a client's details or settings, business information, services or
  offers MUST be in the information carried by the first private message handled after the save,
  with no waiting period. A message already handed to a workflow before the save is not changed.

**Data retention**

- **FR-049**: Once a day, the platform MUST delete exchanges and classified comments that are older
  than the retention period, and conversations with no activity for longer than the retention
  period, together with their exchanges and pause records. The period MUST be set in the
  platform's configuration, with a default of 12 months and a minimum of 1 month. A classified
  comment's age counts from when it was first classified.
- **FR-050**: The deletion MUST NOT touch anything inside the period and MUST NOT slow down
  customer-facing handling. Each run MUST log how many conversations, exchanges and comments it
  deleted, without any text. Download records hold no customer text and are not deleted.

### Key Entities *(include if feature involves data)*

- **Conversation**: The messages between one customer and one of a client's accounts on one
  platform. It has a customer identifier, the receiving account, the client it belongs to, the
  times it started and was last active, and whether the assistant is paused in it (with who paused
  it, when, and until when). There is at most one per customer per account.
- **Exchange**: One customer message, or several messages sent in quick succession, and the reply
  that was sent to them. A message received while the assistant is paused has no reply and is
  marked as not answered. It belongs to one conversation, has a time, and is never edited after it
  is recorded.
- **Pause Record**: One pause or resume of a conversation: which conversation, who did it, when,
  which way, and for a pause the chosen duration. A resume caused by the end of a timed pause has
  no person and is marked automatic.
- **Classified Comment**: A customer comment on a client's post, with its text, platform, client,
  label, reason, decision basis, and the time it was classified. There is at most one per comment
  on a platform.
- **Label**: One of engagement, inquiry, complaint, spam, insult, or unsure.
- **Decision Basis**: How the label was decided: built-in rules, the AI model (with the model's
  name), or a safe fallback after the AI model failed. Comments collected before this feature have
  the basis "unknown".
- **Download Record**: One comments download: who made it, when, the filters used, the number of
  rows, and whether it completed. It never holds comment text.
- **Chat Workflow Endpoint**: A short path stored on a client. Added to the fixed base address, it
  gives the workflow that handles that client's private messages. A client has at most one, and
  no two clients share one. A client is either subscribed to the chat service or not, and only a
  subscribed client's private messages are handed to its workflow.
- **Business Information**: One optional record per client with contact details, social media
  links, location, work hours, payment methods and installment options.
- **Service**: Something a client sells, with a name, optional description and price, optional
  variants, and at most one offer of the same client.
- **Offer**: A discount of a client, with a title, a type and value, and a start and end date. It
  can cover several of the client's services.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Given a customer's identifier, an administrator can open that customer's
  conversation and read its latest exchange within 30 seconds of opening the Conversations screen.
- **SC-002**: In a check of 50 recorded exchanges, 100% appear in their conversation, in the order
  they happened, with the message and reply text exactly as recorded.
- **SC-003**: An administrator can pause the assistant in a conversation within 10 seconds of
  opening it. From the moment the screen confirms the pause, 0 automatic replies are sent in that
  conversation, checked with 20 consecutive customer messages.
- **SC-004**: After a conversation is resumed, by an administrator or because its timed pause
  ended, 100% of the customer messages sent after the resume are answered, and 0 of the messages
  received during the pause are answered. A timed pause ends within 1 minute of its end time.
- **SC-005**: In a test run that includes live comments and a reply run on a post, 100% of the
  classified comments appear once in the Comments list with the correct label.
- **SC-006**: With 10,000 conversations or comments stored, the first page of a list appears in
  under 2 seconds under normal load.
- **SC-007**: 100% of comments collected after this feature is released state their decision
  basis, and 100% of safe-fallback labels can be separated from real labels with the
  decision-basis filter in the list and with a column in the downloaded file.
- **SC-008**: A reviewer can narrow the comments to one label and one date range and download the
  result in under 1 minute, and the downloaded row count equals the list's total.
- **SC-009**: In access tests, 0 requests by a user limited to one client return another client's
  conversations or comments, 0 requests without a signed-in user return any, and 0 requests by a
  client-role user pause a conversation or download comments.
- **SC-010**: Customer-facing handling is not slower or less reliable than before: no comment goes
  unanswered or unclassified, and no exchange is lost, because recording it failed.
- **SC-011**: After release, every screen of the dashboard version that was deployed before this
  feature keeps working without a change: 0 broken screens in a check of the earlier features'
  screens.
- **SC-012**: A review of one day of production logs finds 0 customer messages, comment texts or
  replies.
- **SC-013**: A download of 100,000 matching comments completes without error, its row count
  equals the list's total, and customer replies during the download are not slower than usual.
- **SC-014**: 100% of comments downloads leave a record of who, when, filters, row count and
  whether they completed, and 0 of these records contain comment text.
- **SC-015**: In a test with 3 subscribed clients that have different endpoints and 50 private
  messages, 100% of the messages reach their own client's workflow, and 0 reach another client's
  workflow.
- **SC-016**: In a test of 20 invalid endpoint values (full web addresses, host names, slashes,
  "..", spaces, very long text), 100% are rejected, and 0 stored values make the platform send a
  private message to a host other than the fixed base address.
- **SC-017**: An administrator can enter a new client's business information, 5 services and 2
  offers in under 10 minutes using only the dashboard.
- **SC-018**: In a test with a client that is not subscribed and 50 private messages, 0 messages
  are handed to any workflow, 0 automatic chat replies are sent, and 0 conversations or messages
  are stored.
- **SC-019**: Right after release, 100% of the clients that existed before it show as not
  subscribed, and an administrator can list them all with one filter and subscribe a client in
  under 2 minutes.
- **SC-020**: In a test that saves a change to a client setting, to business information, to a
  service and to an offer, 100% of the changes are in the information carried by the first
  private message handled after the save, and 0 messages after the save carry the old values.
- **SC-021**: In a test with exchanges, comments and conversations dated 13 months and 11 months
  ago and a 12-month period, one deletion run removes 100% of the older rows and keeps 100% of
  the newer ones, and its log contains 0 customer texts.

## Assumptions

- The dashboard is the existing separate React dashboard from the earlier features (001 and 002).
  It uses the same sign-in, the same languages with right-to-left support, and the same error
  messages. This feature supplies what the dashboard needs from the backend and a UI contract for
  the dashboard's repository.
- Conversations, exchanges and classified comments are already being recorded, and read access to
  them already exists. This feature builds on that recording and adds what the screens still
  need: a latest-exchange preview on each conversation, the pause control, the decision basis on
  each comment, and the download.
- A customer is identified by the platform's own identifier. Customer names and profile pictures
  are not stored today, so showing them is out of scope. Administrators find a customer by
  entering that identifier. Searching inside message text is out of scope.
- Decided for this version: the screens are for administrators only. The only action on a
  conversation is pausing or resuming the assistant. The analysis of whether the model is right
  happens later, outside the dashboard, on the downloaded data.
- Out of scope for this version: sending a manual reply from the dashboard, a screen where a
  reviewer marks each label as correct or incorrect, an accuracy summary, a screen that lists
  download records, and screens for users with the client role.
- Pausing applies to direct-message conversations only. Comments keep their own per-client
  automation settings.
- Updates need a manual refresh. Live updates are out of scope.
- Only comments that the platform classifies are collected. Comments of clients with comment
  automation off are not classified, so they are not collected. This feature does not change which
  comments are classified.
- When a comment is classified again, only the latest label is kept. A history of earlier labels is
  out of scope.
- Customer messages and classified comments are kept for the retention period (12 months by
  default) and then deleted (FR-049). An analysis that needs older data must download it before
  it is deleted. Downloaded files and database backups are outside this rule.
- Comments already collected before this feature have no recorded decision basis. They are shown as
  "unknown" and are not changed by this feature.
- Apart from the pause, the platform's reply behaviour (what the assistant says and when it
  replies) does not change.
- The Postman collection and the dashboard UI contract are updated with the new screens' data
  needs, as the project constitution requires.
- This feature lifts the exclusion in feature 001 for business information, services and offers
  in the dashboard. User accounts and a screen for the administrator activity record stay out of
  scope.
- The base address of the automation tool and its shared secret stay in the platform's
  configuration. The dashboard never shows or changes them.
- The per-client chat workflow applies to private-message conversations only. Comments are still
  handled inside the platform and are not sent to any workflow.
- Each endpoint belongs to at most one client, so a workflow built for one client is not shared by
  another. The dashboard does not check that a workflow exists at an endpoint when it is saved.
- Decided for this version: changes to services, offers and business information are not added
  to the administrator activity record.
- There is no shared fallback workflow address. A client is handled by the chat workflow only
  after an administrator marks it as subscribed and gives it an endpoint.
- Releasing this feature stops automatic chat replies for every existing client until an
  administrator subscribes it. The team accepts this, chooses a release time when the workflows and
  their endpoints are ready, and subscribes the clients right after the release.
- The chat service setting is separate from the private-message settings of feature 001, which
  control the private messages the platform sends to commenters.
- Private messages to a client that is not subscribed stay only in that page's own inbox on
  Facebook or Instagram. The platform keeps nothing of them. Unsubscribing a client does not
  delete the conversations that were stored while it was subscribed.
