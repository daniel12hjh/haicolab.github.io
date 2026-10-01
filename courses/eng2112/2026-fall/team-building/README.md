# ENG2112 — Linguistics with AI, Fall 2026

English project team-building classroom for 52 students. Teams may have 1–4 members including the permanent leader (the original idea author). Existing teams submit one representative idea and each teammate confirms membership. Recruitment can be closed at any size.

Live URL: https://haicolab.sogang.ac.kr/courses/eng2112/2026-fall/team-building/

Append `?demo=1` to preview fictional sample ideas without signing in.

## One-time setup in the existing ENG3510 project

This is an add-on to Supabase project `ybotwermtuxtohbwyznm`, not a new project. Do not run it in the STS2026 project. No additional project or paid plan is required for this architecture; both courses share the existing project's resources.

1. Open the existing ENG3510 project's SQL Editor and run `setup.sql` once. It creates `eng2112_private`, course-specific RPCs and a private `eng2112-images` bucket. It preserves existing tables and functions, and updates the Auth signup trigger to route new ENG2112 registrations separately. The migration is transactional; if it fails before commit, its changes roll back.
2. Save the returned `professor_invite_code` privately. Do not publish it or send it to students.
3. Open the classroom. If already registered for ENG3510, **Sign in** using that account. On **Join this classroom**, enter `professor` as the student number and the new ENG2112 professor invitation code. Do not register the same email again. If using a new email, use **Register** with these values instead.
4. In **Instructor dashboard**, paste the 52 student numbers into **Enroll students**, then **Generate codes and download CSV**. Send each student only their own invitation code and the classroom URL.
5. Email confirmation is already disabled in the shared project. Keep it disabled for this invitation-based setup. The browser uses only a publishable key; never add a secret or service-role key to this repository.

For ordinary subsequent use, do not rerun `setup.sql`. Invitation reissue and class settings are available in the instructor dashboard.

## Accounts and isolation

ENG3510 and ENG2112 share Supabase Auth email/password accounts. Students already registered for ENG3510 sign in with that account and enter their separate ENG2112 student number and invitation code once. Password changes affect the same account in both courses. Enrollment, student numbering, instructor role, ideas, teams, applications, comments, settings, invitation codes and images are separate. An existing ENG3510 account has no ENG2112 data access until it enrolls with an ENG2112 invitation.

After the ENG3510 existing-account enrollment migration (see the ENG3510 classroom README, 2026-10-01) and frontend update are deployed, students may register for either course first. In the other classroom, sign in with the same email/password and enter that course’s invitation code. Do not create a second account. For existing installations, apply `courses/eng3510/2026-fall/team-building/migrations/20261001_existing_account_enrollment.sql` in the shared project before publishing the updated ENG3510 frontend.

Students are shown as Student 01, Student 02, etc. Only the instructor can retrieve the roster mapping. Do not put names, student numbers or contact information in public proposal text or images. Existing teammates enter student numbers privately and confirm their membership. Applications and leader replies are visible only to the applicant, leader and instructor; comments are visible to enrolled classmates.

All classroom data goes through checked `eng2112_read`, `eng2112_enroll` and `eng2112_action` RPCs. The private schema is not exposed, all tables use RLS without browser table grants, and image access checks course membership. Membership limits and immutable authorship are enforced on the server. Pending existing-teammate invitations reserve seats. Accepting a team offer cannot overfill a team or leave a student in two teams within the course.

## Operations

- Every proposal requires an explanatory image plus a problem, expected outcome, data plan, methods/tools and contribution. Recruiting teams also describe sought teammates.
- In **03 / TEAM**, below target size and recruitment, enter the student numbers of already agreed teammates (optional; exclude the leader). Publishing or editing saves the idea and all invitations together. If any number is invalid, nothing in that save is committed. Teammates must still sign in and confirm in **My activity**. Leave the fields blank when recruiting; existing ideas, confirmed members and pending invitations are preserved. Only additional members should be entered when editing. Student numbers are not published with the idea.
- A team leader can edit recruitment and target size. Small teams do not need to fill four places.
- Students without an existing team post an idea. Confirming membership in an existing team counts as their representative submission. An application alone does not complete submission.
- Instructor settings control submission/editing and matching. Turn off both switches to freeze existing-team confirmations too.
- Download the instructor roster CSV for student IDs, submission status and team membership. Keep roster and invitation CSVs outside the public repository.
- The instructor can remove a member or dissolve a team, with an audit entry. Students cannot transfer an established team themselves.
- Activity is refreshed manually. There are no automatic notification emails or chat.
- Password email recovery is disabled until SMTP is configured. The local utility `TEAM_COURSE=eng2112 node scripts/team-building/reset-password.mjs` uses hidden input for an administrator key. Resetting a shared account also changes its ENG3510 password.

## Existing-project update (2026-10-01)

Before deploying the updated frontends, run `scripts/team-building/migrations/20261001_shared_classroom_updates.sql` in the **ENG3510/ENG2112 shared project**. It updates both courses’ idea saving and includes the ENG3510 existing-account enrollment fix. It is safe if the earlier enrollment-only migration has already run. Do not rerun `setup.sql` or use this shared-project update in STS2026. Existing ideas, teams and invitations are preserved.

## Verification

From the repository root (dependencies in `scripts/team-building`):

```sh
node scripts/team-building/eng2112.test.mjs
python3 -m http.server 8765
# In another terminal:
node scripts/team-building/eng2112-browser.test.mjs
```

Database tests apply this migration on top of an existing ENG3510 fixture, including 52-student enrollment, existing/new accounts, old signup preservation, isolated permissions/storage and capacity rules. Browser tests cover English desktop/mobile pages, image submission, offers, enrollment and instructor operations. Test accounts are fictional; no live student data is used.
