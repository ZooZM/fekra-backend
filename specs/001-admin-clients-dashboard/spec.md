# Feature Specification: Admin Clients Dashboard

**Feature Branch**: `001-admin-clients-dashboard`
**Created**: 2026-11-07
**Status**: Draft
**Input**: User description: "create admin dashboard to manage all clients (list, create, edit, delete, set access token)."

## Clarifications

### Session 2026-11-07

- Q: Who can use the dashboard in v1? → A: Administrators only; access for client-role users
  is a later version.
- Q: Which client settings can administrators edit? → A: Everything on the client record:
  profile, AI reply settings, private-message settings and comment settings (FR-010).
- Q: Which interface language does the dashboard use? → A: English and Arabic, with a switch;
  Arabic uses a right-to-left layout (FR-023).
- Q: How long do administrators stay signed in? → A: Through page reloads and browser restarts,
  signed out after 30 minutes without activity and always after 12 hours (FR-003).
- Q: How is sign-in protected against password guessing? → A: After 5 failed attempts for the
  same email within 15 minutes, sign-in for that email is blocked for 15 minutes, with a generic
  message (FR-027).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find and review clients (Priority: P1)

An administrator signs in to the dashboard and sees every client business the platform serves.
They page through the list, sort it, search by name or business category, and open a client to
see its details. People without the administrator role cannot see any client information.

**Why this priority**: Every other action starts with finding the right client. On its own, this
gives administrators visibility that today requires technical tools.

**Independent Test**: With existing clients in the system, sign in as an administrator and check
that the list, paging, sorting, search and detail view work. Then sign in as a non-administrator
and check that access is refused.

**Acceptance Scenarios**:

1. **Given** an administrator is signed in and 45 clients exist, **When** they open the clients
   list, **Then** they see the first page of 20 clients showing business name, business category,
   connected Facebook page and Instagram account (or "not connected") and creation date, the
   total count of 45, and they can move to pages 2 and 3.
2. **Given** the clients list, **When** the administrator sorts by name, business category or
   creation date in ascending or descending order, **Then** the list is reordered accordingly.
3. **Given** the clients list, **When** the administrator searches for part of a client's name or
   business category, **Then** only matching clients are shown, with the number of matches.
4. **Given** the clients list, **When** the administrator opens a client, **Then** they see all of
   that client's details, and the access token is shown only as "on file", never its value.
5. **Given** a user without the administrator role signs in, **When** they try to open the
   dashboard or any client page (including through a saved or shared link), **Then** they are
   told they do not have access and no client data is shown.
6. **Given** no clients exist yet, **When** the administrator opens the list, **Then** they see an
   empty state that invites them to create the first client.
7. **Given** the dashboard is shown in English, **When** the administrator switches to Arabic,
   **Then** all interface text appears in Arabic, the layout reads right-to-left, and the choice
   is kept for their next visit on that device.

---

### User Story 2 - Onboard a new client (Priority: P2)

An administrator adds a new business to the platform by entering its details, the identifiers of
its Facebook page and Instagram account, and the access token that lets the platform act on
those accounts.

**Why this priority**: Onboarding is how the platform grows. Without it, the dashboard is
read-only.

**Independent Test**: Create a client with valid details and confirm it appears in the list with
the token shown only as "on file". Then submit invalid and conflicting details and confirm nothing
is saved and the problem is explained.

**Acceptance Scenarios**:

1. **Given** the create form, **When** the administrator enters a business name, business
   category and access token (plus any optional fields) and saves, **Then** the client appears in
   the list, its detail page opens, and the token value is not displayed.
2. **Given** the create form, **When** the business name, business category or access token is
   missing, **Then** the form marks each missing field and nothing is saved.
3. **Given** a Facebook Page ID already connected to another client, **When** the administrator
   saves a new client with that ID, **Then** the form explains that the page is already connected
   to another client and nothing is saved.
4. **Given** the create form, **When** a Facebook Page ID or Instagram account ID contains
   anything other than digits, **Then** the field is marked invalid and nothing is saved.

---

### User Story 3 - Update a client's details (Priority: P3)

An administrator corrects or changes a client's details, such as its category, logo or connected
accounts. Automation settings are covered by User Story 6.

**Why this priority**: Details change over time, but less often than clients are added or looked
up.

**Independent Test**: Edit fields of an existing client, save, and confirm the change appears in
the detail view and the list, while the access token stays unchanged.

**Acceptance Scenarios**:

1. **Given** an existing client, **When** the administrator changes its business category and
   saves, **Then** the detail view and the list show the new category.
2. **Given** an existing client with a connected Facebook page, **When** the administrator removes
   or changes the Facebook Page ID, **Then** they are warned that the platform will stop handling
   messages and comments for the old page and must confirm before the change is saved.
3. **Given** the edit form has unsaved changes, **When** the administrator tries to leave the
   page, **Then** they are asked to confirm discarding the changes.
4. **Given** an existing client, **When** the administrator saves any edit, **Then** the client's
   access token is not changed.

---

### User Story 4 - Replace a client's access token (Priority: P4)

When a client's access token expires or is revoked, an administrator replaces it so the platform
can keep replying to that client's customers.

**Why this priority**: An invalid token silently stops all automation for that client, so fixing
it quickly matters. It is a single, focused action used less often than editing.

**Independent Test**: Replace a client's token and confirm the success message appears, the new
value is never displayed, and the client's other details are unchanged.

**Acceptance Scenarios**:

1. **Given** a client's detail page, **When** the administrator enters a new access token and
   confirms, **Then** the token is replaced, a success message is shown, and the value is never
   displayed again.
2. **Given** the replace-token action, **When** the administrator submits an empty value, **Then**
   it is rejected and the existing token is kept.
3. **Given** the replace-token action, **When** the administrator types the token, **Then** the
   value is hidden by default and can be revealed only while typing.

---

### User Story 5 - Remove a client (Priority: P5)

An administrator permanently removes a business that no longer uses the platform.

**Why this priority**: It is needed but rare, and the most destructive action, so it comes last.

**Independent Test**: Delete a client after confirming and check that it disappears from the list
and its detail link shows "not found". Then start a deletion, cancel it, and check that nothing
changed.

**Acceptance Scenarios**:

1. **Given** a client, **When** the administrator chooses to delete it, **Then** a confirmation
   explains that the client, its business information, services and offers will be permanently
   removed, its user accounts will be unlinked, and automation for its accounts will stop. The
   administrator must type the client's name to confirm.
2. **Given** the administrator completes the confirmation, **When** the deletion finishes,
   **Then** the client no longer appears in the list and its detail link shows "not found".
3. **Given** the deletion confirmation, **When** the administrator cancels, **Then** nothing is
   changed.

---

### User Story 6 - Configure a client's automated replies (Priority: P6)

An administrator controls how the platform answers on a client's behalf: the language and brand
voice of AI replies, whether customers who ask questions in comments get a private message,
whether public comment replies and likes are posted, and the messages used for each case.

**Why this priority**: It changes how the bot speaks to real customers, so it matters. But every
client already starts with safe defaults (automation off), and this story builds on clients that
the earlier stories create and edit. Delivering it last lets the dashboard ship sooner.

**Independent Test**: Turn a client's automation on, edit its message lists and AI settings,
save, and confirm the detail view shows exactly the saved settings. Then try invalid settings and
confirm nothing is saved.

**Acceptance Scenarios**:

1. **Given** an existing client with automation off, **When** the administrator turns comment
   replies on, adds three thank-you messages and saves, **Then** the detail view shows comment
   replies on with exactly those three messages.
2. **Given** an existing client, **When** the administrator sets the reply language to
   "Arabic and English" and enters a brand voice description, **Then** both are saved and shown
   on the detail view.
3. **Given** the private-message settings, **When** the administrator turns private messages on
   but leaves the message list empty, **Then** the form asks for at least one message and nothing
   is saved.
4. **Given** a message list with 50 messages, **When** the administrator tries to add another,
   **Then** the dashboard prevents it and explains the limit.
5. **Given** a comment reply list left empty, **When** the administrator saves, **Then** the
   dashboard explains that the platform's built-in default messages will be used for that case.

---

### Edge Cases

- **Session expires during an edit**: the save attempt fails with a clear "session expired"
  message, the administrator is asked to sign in again and is returned to the same client, and no
  partial change is stored.
- **Administrator role removed while signed in**: the next action is refused, and the user is
  told they no longer have access.
- **Repeated failed sign-ins**: after the fifth failure within 15 minutes, further attempts for
  that email are refused with the same generic message, including correct ones, until 15 minutes
  have passed. Other administrators can still sign in.
- **Two administrators edit the same client**: the last save wins.
- **Client deleted by another administrator while open**: any further action shows that the
  client no longer exists and returns the administrator to the list.
- **Server unreachable or failing**: the administrator sees a clear error with a way to retry.
  A failed action is never reported as successful.
- **Long names**: a 255-character business name is shortened in the list and shown in full on the
  detail page.
- **Arabic content**: business names and categories written in Arabic display correctly,
  right-to-left.
- **Broken logo link**: a logo link that does not load shows a placeholder image. Only `http`
  and `https` links are accepted.
- **Search with no matches**: the list says no clients match and offers to clear the search.
- **Duplicate business names**: allowed, because two businesses can share a name. Uniqueness
  applies only to the Facebook Page ID and Instagram account ID.
- **Switching language with unsaved changes**: changing the interface language keeps everything
  already typed into an open form.
- **Mixed-direction text**: English client data shown in the Arabic interface, and Arabic data
  shown in the English interface, each keep their own reading direction.
- **Automation on for a client without a connected account**: allowed, but the detail view notes
  that nothing will be sent until a Facebook page or Instagram account is connected.

## Requirements *(mandatory)*

### Functional Requirements

**Access**

- **FR-001**: Only signed-in users with the administrator role MUST be able to open the dashboard
  and perform any client management operation.
- **FR-002**: The system MUST refuse every client management operation requested by a
  non-administrator, including requests made without the dashboard.
- **FR-003**: Administrators MUST sign in with their existing email and password and MUST be able
  to sign out. A session MUST survive page reloads, new tabs and browser restarts. It MUST end
  after 30 minutes without any interaction with the dashboard, and in all cases 12 hours after
  sign-in, after which the administrator MUST sign in again. Signing out MUST end the session
  immediately, so the same browser cannot continue it.
- **FR-027**: After 5 failed sign-in attempts for the same email within 15 minutes, the system
  MUST refuse sign-in for that email for 15 minutes, even with the correct password. Unknown
  emails MUST be treated the same way. The message shown MUST NOT reveal whether the email
  exists or whether the block is active.

**List and view**

- **FR-004**: The dashboard MUST list all clients with business name, business category, Facebook
  page connection, Instagram account connection and creation date.
- **FR-005**: The list MUST be paged (20 clients per page by default, up to 100 per page) and MUST
  show the total number of clients.
- **FR-006**: The list MUST be sortable by business name, business category and creation date, in
  ascending or descending order, newest first by default.
- **FR-007**: The list MUST support a case-insensitive partial-match search on business name and
  business category.
- **FR-008**: The dashboard MUST show a client detail view with every managed field and the
  client's creation and last-update dates.

**Create and edit**

- **FR-009**: Administrators MUST be able to create a client with: business name (required, up to
  255 characters), business category (required, up to 255 characters), Facebook Page ID
  (optional, 5-30 digits), Instagram account ID (optional, 5-30 digits), logo link (optional,
  `http`/`https` web address, up to 255 characters) and access token (required).
- **FR-010**: Beyond the fields in FR-009, administrators MUST be able to view and change every
  client setting:
  - **AI reply settings**: reply language (Arabic, English, or Arabic and English; required) and
    brand voice (optional free text, up to 400 characters).
  - **Private-message settings**: private messages to commenters who ask a question (on/off),
    liking incoming private messages (on/off), and the list of private messages to send.
  - **Comment settings**: public comment replies and hiding of complaint or insulting comments
    (on/off), liking comments (on/off), and three message lists: the public reply to a question
    when a private message was sent, the public reply to a question when a private message could
    not be sent, and the thank-you reply to positive comments.
  - Each message list holds up to 50 messages of 1 to 1000 characters. The platform picks one
    message from the list each time it replies.
- **FR-011**: Administrators MUST be able to edit every field in FR-009 except the access token,
  and every setting in FR-010.
- **FR-012**: Each Facebook Page ID and each Instagram account ID MUST belong to at most one
  client. A conflicting value MUST be reported on that field, and nothing MUST be saved.
- **FR-013**: The dashboard MUST show a message on each invalid field. An invalid submission MUST
  NOT change any stored data.
- **FR-014**: Before saving an edit that removes or changes a client's Facebook Page ID or
  Instagram account ID, the dashboard MUST warn that the platform will stop handling the old
  account and MUST require confirmation.
- **FR-015**: The dashboard MUST ask for confirmation before discarding unsaved changes.

**Access token**

- **FR-016**: Once entered, the access token MUST be write-only. It MUST never be displayed,
  returned, or included in any list, detail view, export or log. The dashboard MUST show only
  that a token is on file.
- **FR-017**: Administrators MUST be able to replace a client's access token through a dedicated
  action that requires confirmation. An empty value MUST be rejected.
- **FR-018**: Access token input MUST be hidden by default while typing.

**Delete**

- **FR-019**: Administrators MUST be able to permanently delete a client only after a confirmation
  that lists the consequences (business information, services and offers removed; user accounts
  unlinked; automation for its accounts stopped) and requires typing the client's name.
- **FR-020**: A deleted client MUST disappear from the list, and its detail link MUST show
  "not found".

**Feedback and presentation**

- **FR-021**: Every operation MUST end with a visible success message or a specific failure
  message. A failed operation MUST never appear successful or leave a client partly updated.
- **FR-022**: The list and detail views MUST show loading and empty states.
- **FR-023**: The dashboard interface MUST be available in English and Arabic, with a language
  switch on every screen, including sign-in. In Arabic, the whole layout MUST read right-to-left.
  The chosen language MUST be remembered on the device. The first visit MUST follow the
  browser's preferred language when it is Arabic or English, and use English otherwise.
- **FR-024**: Client data written in Arabic or English MUST display correctly, including
  right-to-left text, whatever the interface language.

**Automation settings**

- **FR-025**: A new client MUST start with these defaults for any setting left untouched: reply
  language Arabic, no brand voice, all automation off (private messages, comment replies, likes),
  and empty message lists.
- **FR-026**: When private messages are turned on, at least one private message MUST be provided.
  An empty comment message list MUST be allowed, and the dashboard MUST state that the
  platform's built-in default messages will be used for that case.

### Key Entities *(include if feature involves data)*

- **Client**: a business served by the platform. Attributes: business name, business category,
  Facebook Page ID (optional, unique), Instagram account ID (optional, unique), logo link
  (optional), access token (secret, write-only), AI reply settings, private-message settings,
  comment settings (FR-010), and creation and last-update dates. Each client has at most one business-information record, any number of
  services and offers, and any number of linked user accounts. Deleting a client removes its
  business information, services and offers and unlinks its user accounts.
- **Administrator**: a user account with the administrator role, and the only actor in this
  feature.
- **Access token**: the credential that lets the platform act on a client's Facebook page and
  Instagram account. It is stored protected and is never revealed after entry.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can create a valid client in under 2 minutes, on the first
  attempt, without help.
- **SC-002**: With 500 clients in the system, an administrator can find a specific client by name
  in under 10 seconds.
- **SC-003**: In acceptance testing, 100% of client management operations attempted by
  non-administrator accounts are refused, both through the dashboard and through direct requests.
- **SC-004**: In acceptance testing, an access token value appears 0 times in any screen, response
  or log reviewed after it was entered.
- **SC-005**: The client list and detail pages show their content within 2 seconds for 95% of
  loads under normal conditions.
- **SC-006**: 100% of rejected saves tell the administrator which field or condition to fix, and
  no rejected save changes stored data.
- **SC-007**: No client can be deleted without completing the confirmation step, verified for
  every place a deletion can start.
- **SC-008**: Every screen, message and validation error is available in both English and Arabic.
  A review of every screen in each language finds 0 untranslated texts and 0 layout elements
  facing the wrong direction.
- **SC-009**: After an administrator saves a client's automation settings, the detail view shows
  exactly the saved values, with 0 differences across all settings in acceptance testing.
- **SC-010**: In acceptance testing, a correct password entered after 5 failed attempts within
  15 minutes is refused, and the same password succeeds once 15 minutes have passed. Responses
  for unknown and known emails cannot be told apart.

## Assumptions

- In v1, administrators are the only users of this dashboard. Their accounts already exist and
  are created outside this feature. Client-role users get no access; access for businesses is
  planned for a later version.
- Administrators can edit everything stored on the client record (FR-009, FR-010).
- The dashboard supports exactly two interface languages, English and Arabic. Adding more is
  out of scope.
- Sign-in uses the existing email-and-password accounts. Session limits are fixed by FR-003 (30
  minutes idle, 12 hours maximum) and are not configurable by each administrator. "Remember me"
  and password reset are out of scope.
- Scale: up to about 500 clients and up to 10 administrators.
- Concurrent edits to the same client use last-save-wins. There is no locking or merge.
- Deletion is permanent, with no archive or restore, matching current platform behavior. Database
  backups are the only recovery path.
- An access token is required when a client is created. The token is not checked against Meta
  when entered; validity checking is out of scope.
- Managing business information, services, offers and user accounts, and keeping an audit
  history of changes, are out of scope and left to future features.
- The dashboard is used mainly in desktop browsers and works at tablet width. A phone-optimized
  layout is not required.
- The dashboard is a web application separate from the platform's server, and is released
  independently of it.
