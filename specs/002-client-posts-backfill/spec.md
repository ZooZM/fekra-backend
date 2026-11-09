# Feature Specification: Client Posts and Unreplied Comment Replies

**Feature Branch**: `002-client-posts-backfill`
**Created**: 2026-11-09
**Status**: Draft
**Input**: User description: "Admin dashboard: client posts with unreplied comments and per-post reply backfill. Story: on a client in the admin clients dashboard, the admin clicks a button that fetches all posts of that client's connected page/account (Facebook posts or Instagram media), each showing the number of comments the page has not replied to. Each post has a button that triggers the existing comment backfill action to start replying to that post's unreplied comments in the background."

## Clarifications

### Session 2026-11-09

- Q: Which posts does the client's posts list show? → A: All recent posts, each with its
  unreplied count, plus a switch to show only the loaded posts that have unreplied comments
  (FR-008).
- Q: What control does an administrator have over a run in progress? → A: The post shows live
  progress ("handled X of N"), and any administrator can stop the run (FR-017, FR-021).
- Q: Does a run still answer a comment that the page answered, hid or deleted after the run
  started? → A: No. The run checks each comment again just before answering it and skips it if
  it no longer needs a reply (FR-023).
- Q: Can a run start when the client's comment replies are turned off? → A: No. The reply
  action is unavailable, with an explanation and a link to the client's comment settings
  (FR-011).
- Q: How does the posts list load? → A: Posts appear first; each post's unreplied count fills in
  when it is ready, and a count that fails can be retried for that post alone (FR-024).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See a client's posts and their unreplied comments (Priority: P1)

From a client's detail page in the admin dashboard, an administrator opens the client's posts.
They see the recent posts of the client's connected Facebook page or Instagram account. Each post
shows how many of its comments the client has not answered. The administrator can tell which
posts need attention without opening Facebook or Instagram.

**Why this priority**: Administrators cannot see unanswered comments today without going to
Facebook or Instagram. This view is useful on its own, and it is where the reply action in User
Story 2 starts.

**Independent Test**: For a client with a connected Facebook page whose posts have a known number
of answered and unanswered comments, open the client's posts. Check that each post shows the
correct total and unreplied counts.

**Acceptance Scenarios**:

1. **Given** a client with a connected Facebook page that has 40 posts, **When** the
   administrator opens the client's posts, **Then** they see the 25 most recent posts, newest
   first. Each post shows its publication date, the start of its text, a thumbnail when it has
   an image or video, a link that opens it on Facebook, its number of comments, and its number
   of unreplied comments. The administrator can load the remaining 15 posts.
2. **Given** a post with 12 comments from customers, 9 of them answered by the client's page,
   **When** the administrator views the post in the list, **Then** it shows 3 unreplied comments.
3. **Given** a client with both a Facebook page and an Instagram account connected, **When** the
   administrator opens the client's posts, **Then** they can switch between the Facebook page's
   posts and the Instagram account's posts.
4. **Given** a client with no Facebook page and no Instagram account connected, **When** the
   administrator looks at the client's detail page, **Then** the posts action is unavailable and
   the page explains that an account must be connected first.
5. **Given** the posts list is open, **When** the administrator refreshes it, **Then** the counts
   are reloaded and the list shows when they were last loaded.
6. **Given** 25 posts are loaded and 4 of them have unreplied comments, **When** the
   administrator turns on "only posts with unreplied comments", **Then** only those 4 posts are
   shown. When they load more posts, the new posts are filtered the same way.

---

### User Story 2 - Reply to a post's unreplied comments (Priority: P2)

On a post that has unreplied comments, the administrator starts an action that answers them. The
platform handles each unanswered comment the same way it handles a new comment, using the
client's comment settings, one comment at a time with a pause between each. The administrator
does not need to keep the page open.

**Why this priority**: This is the reason for the feature: clearing a backlog of unanswered
comments in one action instead of answering each one by hand. It depends on User Story 1 to
choose the post.

**Independent Test**: On a test post with 5 unanswered comments from customers, start the reply
action, confirm, and check that the dashboard reports 5 comments to answer and an estimated
duration. Then check on Facebook that the comments receive replies one by one.

**Acceptance Scenarios**:

1. **Given** a post with 8 unreplied comments, **When** the administrator chooses to reply to
   them, **Then** a confirmation shows that 8 comments will be answered publicly on the client's
   behalf, using the client's comment settings, one comment every few seconds, with an estimated
   duration. Nothing starts until the administrator confirms.
2. **Given** the confirmation, **When** the administrator confirms, **Then** the dashboard
   reports that replying has started, with the number of comments found, the number that will be
   answered, and the estimated time to finish. The post is marked as being replied to.
3. **Given** the confirmation, **When** the administrator cancels, **Then** nothing is started.
4. **Given** a reply run is already in progress for a post, **When** any administrator tries to
   start another one for the same post, **Then** it is refused with a message that a run is
   already in progress for that post.
5. **Given** a post with 0 unreplied comments, **When** the administrator views it, **Then** the
   reply action is not offered.
6. **Given** a reply run has started, **When** the administrator leaves the page or closes the
   browser, **Then** the run continues.
7. **Given** a run on a post with 8 comments to answer is in progress, **When** any
   administrator opens the client's posts, **Then** the post shows "handled 3 of 8" (or the
   current numbers), and the numbers update on their own while the list is open.
8. **Given** a run is in progress, **When** an administrator stops it and confirms, **Then** no
   further comments from that run are answered, and the post shows the run as stopped with the
   number of comments handled. The remaining comments stay unreplied and can be answered by
   starting a new run.
9. **Given** a client whose comment replies are turned off, **When** the administrator views a
   post with unreplied comments, **Then** the post still shows its unreplied count, the reply
   action is unavailable, and a message explains that comment replies are off, with a link to
   the client's comment settings.

---

### User Story 3 - Check the result of a reply run (Priority: P3)

After a reply run finishes, the administrator refreshes the client's posts and checks that the
post's unreplied count went down.

**Why this priority**: It confirms that the action worked, but the replies themselves already
reach customers through User Story 2.

**Independent Test**: Start a run on a post with 5 unanswered comments, wait until the post shows
the run as finished, refresh the post list, and check that the post shows 0 unreplied comments.

**Acceptance Scenarios**:

1. **Given** a reply run on a post with 5 unreplied comments, from senders who are not blocked,
   has finished, **When** the administrator refreshes the posts list, **Then** the post shows 0
   unreplied comments.
2. **Given** a reply run included comments that the platform chose not to answer (for example,
   from blocked senders), **When** the administrator refreshes the posts list, **Then** those
   comments are still counted as unreplied, and the dashboard explains that some comments may be
   left unanswered on purpose.

---

### Edge Cases

- **Access token missing, expired or revoked**: the posts list and the reply action fail with a
  message saying the client's access token must be replaced, and a link to the replace-token
  action. Nothing is started.
- **Token missing a permission**: the message names the permission the client's page must grant.
- **Facebook or Instagram unavailable**: the administrator sees that the service is unavailable
  and can retry. A failed action never appears successful.
- **Post deleted after the list loaded**: starting a run on it fails with "this post no longer
  exists", and the post can be removed from the list by refreshing.
- **Very busy post**: only the most recent 500 comments of a post are checked. When a post has
  more, its count is shown as a minimum (for example "at least 37") with an explanation.
- **New comments during a run**: a run answers only the comments found when it started. New
  comments are handled by the platform's normal live handling.
- **Comment answered, hidden or deleted during a run**: when the run reaches it, the comment is
  skipped and counted as handled. The customer does not get a second reply (FR-023).
- **Re-check fails**: if the run cannot check a comment again because Facebook or Instagram is
  unavailable, it skips that comment rather than risk a second reply. The comment stays
  unreplied and is picked up by the next run.
- **Server restart during a run**: the run stops and the post shows it as interrupted, with the
  number of comments handled. Comments not yet answered are counted as unreplied again, and the
  administrator can start a new run.
- **Stop while a comment is being handled**: that comment is completed, and no further comment
  from the run is started.
- **Stop pressed after the run finished**: the dashboard says the run has already finished, and
  nothing changes.
- **Comment replies turned off for the client**: the reply action is unavailable, with an
  explanation and a link to the client's comment settings. A request to start a run made
  without the dashboard is refused with a specific message.
- **Comment replies turned off during a run**: the run stops before the next comment and is
  shown as interrupted, with the reason.
- **Counts that are not unreplied comments**: comments written by the client's own page or
  account, hidden comments, and replies to other comments are never counted. On Instagram,
  comments without text are not counted either. A comment that only another customer replied to
  is still counted as unreplied.
- **One post's count fails**: that post shows "couldn't count" with a retry. The other posts
  and their counts are unaffected (FR-024).
- **Post without text**: shows its thumbnail and a "no text" label.
- **Arabic captions**: post text written in Arabic displays correctly, right-to-left, in either
  interface language.
- **Two administrators start the same post at the same moment**: one run starts and the other
  is refused. No comment is answered twice.

## Requirements *(mandatory)*

### Functional Requirements

**Access**

- **FR-001**: Only signed-in administrators MUST be able to view a client's posts and start, follow
  or stop reply runs. The system MUST refuse these operations for anyone else, including requests
  made without the dashboard.

**Posts list**

- **FR-002**: The client detail page MUST offer an action that opens the client's posts. It MUST
  be unavailable, with an explanation, when the client has no connected Facebook page or
  Instagram account.
- **FR-003**: When the client has both a Facebook page and an Instagram account connected, the
  administrator MUST be able to choose which account's posts to see. The Facebook page is shown
  first.
- **FR-004**: The posts list MUST show the most recent posts first, 25 at a time, with a way to
  load the next 25 until the account has no more posts.
- **FR-005**: Each post MUST show its publication date, the start of its text shortened to one
  line, a thumbnail when it has an image or video, a link that opens the post on Facebook or
  Instagram in a new tab, its number of comments, and its number of unreplied comments.
- **FR-006**: An unreplied comment MUST be a top-level comment on the post that is not written by
  the client's page or account, is not hidden, has no reply from the client's page or account,
  and, on Instagram, has text. The posts list and the reply action MUST use this same
  definition, so the count shown is the number of comments a run started at that moment would
  try to answer.
- **FR-007**: For each post, at most the 500 most recent comments MUST be checked. When a post has
  more, its unreplied count MUST be shown as a minimum, with an explanation.
- **FR-008**: Posts with 1 or more unreplied comments MUST be visually highlighted. The list MUST
  offer a switch to show only the loaded posts that have 1 or more unreplied comments. The switch
  applies to every post loaded later and is off by default. When it hides every loaded post, the
  list MUST say so and still offer to load more posts.
- **FR-009**: The counts MUST reflect Facebook and Instagram at the time the list was loaded. The
  list MUST show that time, and the administrator MUST be able to refresh it.
- **FR-010**: The posts list MUST show loading and empty ("this account has no posts yet") states.
- **FR-024**: The posts MUST appear without waiting for their unreplied counts. Each count MUST
  show a loading mark until it is ready, then fill in on its own. When a post's count cannot be
  loaded, that post MUST show "couldn't count" with a retry for that post only, and the other
  posts MUST be unaffected. The reply action and the "only posts with unreplied comments" switch
  MUST treat a post whose count is not known yet as not having unreplied comments.

**Reply action**

- **FR-011**: Each post with 1 or more unreplied comments MUST offer an action to reply to them,
  unless comment replies are turned off in the client's settings. In that case the action MUST
  be unavailable, with an explanation and a link to the client's comment settings, and the
  system MUST refuse a request to start a run with a specific message. If comment replies are
  turned off during a run, the run MUST stop before the next comment and end as interrupted.
- **FR-012**: Before starting, the dashboard MUST ask for confirmation. The confirmation MUST state
  the number of comments to answer, that replies are posted publicly on the client's behalf
  according to its comment settings, the pause between two comments, and the estimated
  duration.
- **FR-013**: Once confirmed, the run MUST start in the background and the dashboard MUST report
  right away the number of comments found, the number that will be answered, the pause between
  comments and the estimated time to finish. The run MUST continue if the administrator leaves
  the page.
- **FR-014**: A run MUST answer the newest unreplied comments first, one at a time, with a fixed
  pause between two comments (5 seconds by default) to stay within Facebook and Instagram
  limits.
- **FR-015**: Each comment in a run MUST go through the same handling as a newly received
  comment: blocked senders, duplicate detection, comment classification and the client's comment
  settings decide whether a public reply, a private message, a like or hiding happens. A comment
  MUST NOT be answered twice.
- **FR-016**: Only one run per post MUST be in progress at a time. A request to start another run
  on the same post MUST be refused with a specific message.
- **FR-017**: While a run is in progress, the post MUST show it to every administrator, with the
  number of comments handled so far out of the number to answer ("handled X of N"). A comment
  counts as handled once the platform has processed it, whether or not it was answered. The
  progress MUST update on its own at least every 10 seconds while the list is open. The reply
  action MUST NOT be offered for the post during the run.
- **FR-021**: Any administrator MUST be able to stop a run in progress, after a confirmation.
  Once stopped, no further comment from that run MUST be started; a comment already being
  handled is completed. Stopped runs cannot be resumed.
- **FR-022**: After a run ends, the post MUST show its outcome (finished, stopped by an
  administrator, or interrupted with the reason: server restart, comment replies turned off,
  the account disconnected from the client or the client deleted, or the client's access to
  Facebook or Instagram rejected) with the number of comments handled, until a new run starts
  on that post or 24 hours have passed.
- **FR-023**: Just before handling each comment, a run MUST check the comment again on Facebook
  or Instagram. If the comment was deleted or hidden, or the client's page or account has
  replied to it, the run MUST skip it. If the check fails, the run MUST also skip the comment,
  which stays unreplied. In both cases the comment counts as handled.
- **FR-018**: When the client's access token is missing, invalid or lacks a permission, when the
  post no longer exists, or when Facebook or Instagram is unavailable, the posts list and the
  reply action MUST fail with a specific message (FR-021 of the admin clients dashboard), and no
  run MUST start.

**Activity record**

- **FR-019**: Each started run MUST be recorded in the activity record of the admin clients
  dashboard (its FR-028), with the administrator, the client, the account (Facebook page or
  Instagram account), the post, the time and the number of comments to answer. Each stopped run
  MUST be recorded the same way, with the administrator who stopped it and the number of
  comments handled.

**Presentation**

- **FR-020**: The new screens and messages MUST follow the language, text direction and
  accessibility requirements of the admin clients dashboard (its FR-023, FR-024 and FR-030):
  English and Arabic, right-to-left layout in Arabic, and WCAG 2.2 level AA.

### Key Entities *(include if feature involves data)*

- **Post**: a publication on a client's Facebook page or Instagram account. It is read from
  Facebook or Instagram and is not stored by the platform. Attributes: platform, publication
  date, text, thumbnail, link, number of comments, number of unreplied comments.
- **Unreplied comment**: a comment on a post that the client has not answered, as defined in
  FR-006.
- **Reply run**: one pass over a post's unreplied comments, started by an administrator. It
  holds the post, the client account, who started it, the comments found, the comments to
  answer, the number handled so far, the pause between comments, the estimated finish time and
  its state: in progress, then finished, stopped (with who stopped it) or interrupted. At most
  one run per post is in progress. A run's state is kept for 24 hours after it ends; its
  activity record entries are kept as the activity record requires.
- **Activity record entry**: as defined by the admin clients dashboard, with two new action
  types: "reply run started" and "reply run stopped".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a client's detail page, an administrator can see the client's posts with their
  unreplied counts in 1 click. Under normal conditions, the first 25 posts appear within 2
  seconds for 95% of loads, and 95% of their unreplied counts appear within 10 seconds of the
  list opening.
- **SC-002**: In acceptance testing, for 100% of posts checked, the unreplied count shown equals
  the number of comments that a run started immediately afterwards reports it will answer.
- **SC-003**: After a run on a post whose unreplied comments all come from senders who are not
  blocked, a refreshed list shows 0 unreplied comments for that post.
- **SC-004**: An administrator can clear a backlog of 100 unreplied comments on a post with 2
  actions (start and confirm), and the run finishes within 10 minutes at the default pace.
- **SC-005**: In acceptance testing, 0 runs start without the confirmation step, and 100% of
  attempts to start a second run on a post with a run in progress are refused.
- **SC-006**: In acceptance testing, 100% of post list, run start, run progress and run stop
  requests made by non-administrator accounts are refused, through the dashboard and through
  direct requests.
- **SC-007**: In acceptance testing, 0 comments receive two automatic replies from runs, and 0
  comments answered by hand after a run started receive an automatic reply from that run.
- **SC-008**: Every new screen and message is available in English and Arabic, and passes an
  automated accessibility scan with 0 WCAG 2.2 AA violations.
- **SC-009**: In acceptance testing, after an administrator stops a run, at most 1 more comment
  from that run is answered, and the handled count shown matches the number of comments
  actually processed.

## Assumptions

- This feature extends the admin clients dashboard (`specs/001-admin-clients-dashboard`). It
  reuses its sign-in, administrator-only access, languages, accessibility level and activity
  record.
- The list shows all recent posts. The "only posts with unreplied comments" switch filters the
  posts already loaded; it does not search the account's whole history (FR-008).
- Posts are always read live from Facebook and Instagram. The platform does not store posts or
  counts.
- The pause between two comments (5 seconds) and the 500-comment limit per post are set on the
  server and cannot be changed from the dashboard.
- The existing reply process is reused unchanged: how replies are written, classified and sent is
  out of scope.
- A run can be stopped but not paused or resumed. To continue after a stop, the administrator
  starts a new run, which picks up the comments that are still unreplied.
- Replying to the comments of several posts in one action, scheduling runs automatically, and a
  screen showing past runs are out of scope.
- Only top-level comments are considered. Replies inside comment threads are not answered.
