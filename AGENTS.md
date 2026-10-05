# AGENTS.md — Harvik Technologies HR Dashboard
## AI Coding Agent Harness / Single Source of Truth

> This file is the implementation contract for the AI coding agent.
> Build the complete internal HR system described below.
> Do not replace the mandated stack or silently remove requirements.
> If a requirement is genuinely ambiguous, choose the simplest extensible implementation,
> record the decision in `docs/DECISIONS.md`, and continue.
> Do not ask for clarification unless implementation is blocked.

---

# 1. OBJECTIVE

Build an internal HR Dashboard / HR Module for Harvik Technologies.

Company website:
https://harviktech.com/

This is an INTERNAL application. It is not a public-facing HR website.

The system is the central source of truth for the complete employee lifecycle:

EMPLOYEE
→ DOCUMENTS
→ ATTENDANCE
→ LEAVE
→ HARDWARE
→ SOFTWARE
→ ACCESS
→ EXIT

Supported employment types:

- Full-Time
- Intern
- Freelancer
- Contractor
- Other

The system must be simple enough for a startup with fewer than 500 employees, but modular and data/config driven so new employment types, leave types, asset types, and license types can be added without code changes.

Opening an employee must provide an Employee 360 view connecting:

- Overview
- Documents
- Attendance
- Leave
- Assets
- Software & Access
- Employment History
- Exit, when applicable

When an employee enters On Notice/Resigned, the system must surface the hardware, licenses, accounts, clearances, and other exit actions that must be completed.

---

# 2. NON-NEGOTIABLE AGENT RULES

1. Follow this tech stack exactly.
2. Do not substitute PostgreSQL, MySQL, Firebase, Supabase, Next.js, Kafka, etc.
3. Frontend must be React 19 + Vite static build.
4. Backend must be Node.js + Express.
5. Database must be MongoDB Community 7.x.
6. Redis 7 must be used for queues/cache/rate limiting/session denylist.
7. Use `.env`; never hardcode secrets.
8. Implement modules in the build phases defined in Section 16.
9. Tests in Section 14 are acceptance criteria. A module is not complete until its tests pass.
10. After every phase:
   - run tests
   - run lint
   - update README.md
   - update docs/DECISIONS.md
   - commit with a clear message
11. Do not automatically revoke external accounts in v1. Track required actions and completion status only.
12. Final application must run with:
   `docker compose up --build`
13. Seed demo data with:
   `npm run seed`
14. Do not delete or weaken requirements just to make implementation easier.
15. Prefer clear modular code over clever abstractions.
16. Never expose bank details, license keys, passwords, tokens, or other secrets in logs or normal list responses.

---

# 3. MANDATORY TECHNOLOGY STACK

## Frontend

- React 19
- Vite
- React Router
- TanStack React Query
- React Hook Form
- Zod
- Tailwind CSS
- Recharts
- Calendar component such as react-big-calendar or a custom accessible calendar
- Playwright for E2E

Frontend is a static build:

`vite build → dist/`

Serve the build through Nginx or Caddy.

No SSR.

Frontend calls:

`/api/*`

Nginx/Caddy reverse proxies `/api` to Express.

## Backend

- Node.js
- Express
- Mongoose
- Zod
- JSON Web Tokens
- bcrypt
- Helmet
- CORS
- express-rate-limit
- Pino
- Multer
- BullMQ
- ioredis
- PDFKit OR Puppeteer + Handlebars
- ExcelJS / csv-stringify
- Nodemailer

## Database

MongoDB Community Edition 7.x.

Run MongoDB as a single-node replica set because transactions are required.

Use transactions for:

- employee exit processing
- license seat assignment
- asset assignment/history

## Redis

Redis 7 is required for:

1. BullMQ jobs
2. Scheduled reminders
3. PDF generation jobs
4. Large report exports
5. Dashboard summary cache
6. Rate limiting
7. Refresh-token/session denylist

Dashboard cache TTL:

60 seconds.

Invalidate dashboard cache after relevant employee, leave, asset, license, exit, or onboarding writes.

---

# 4. REPOSITORY STRUCTURE

Create:

/
├── AGENTS.md
├── README.md
├── docker-compose.yml
├── .env.example
├── docs/
│   └── DECISIONS.md
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── middleware/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── employees/
│   │   │   │   ├── recruitment/
│   │   │   │   ├── onboarding/
│   │   │   │   ├── attendance/
│   │   │   │   ├── leave/
│   │   │   │   ├── documents/
│   │   │   │   ├── assets/
│   │   │   │   ├── licenses/
│   │   │   │   ├── exit/
│   │   │   │   ├── reports/
│   │   │   │   ├── notifications/
│   │   │   │   ├── dashboard/
│   │   │   │   └── settings/
│   │   │   ├── jobs/
│   │   │   ├── utils/
│   │   │   ├── seed/
│   │   │   ├── app.js
│   │   │   ├── server.js
│   │   │   └── worker.js
│   │   └── tests/
│   └── web/
│       ├── src/
│       │   ├── pages/
│       │   ├── components/
│       │   ├── features/
│       │   ├── api/
│       │   ├── hooks/
│       │   └── routes/
│       └── e2e/
└── deploy/
    ├── nginx.conf
    └── ecosystem.config.js

Each backend domain module should preferably contain:

- model
- schema
- service
- controller
- routes

Use one language consistently across the repository:
JavaScript with JSDoc OR TypeScript.
TypeScript is preferred.

---

# 5. ENVIRONMENT

`.env.example` must contain:

NODE_ENV=development
PORT=4000
MONGO_URI=mongodb://mongo:27017/harvik_hr?replicaSet=rs0
REDIS_URL=redis://redis:6379

JWT_ACCESS_SECRET=change_me
JWT_REFRESH_SECRET=change_me
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

FIELD_ENCRYPTION_KEY=base64_32_bytes

UPLOAD_DIR=/data/uploads
MAX_UPLOAD_MB=10

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
MAIL_FROM=hr@harviktech.com

APP_BASE_URL=http://localhost:8080

FIELD_ENCRYPTION_KEY must be suitable for AES-256-GCM.

---

# 6. AUTHENTICATION AND RBAC

Roles:

1. HR Admin
2. HR Manager
3. Manager
4. Employee

RBAC must be enforced on the backend and reflected in the frontend UI.

## HR Admin

Full access.

Can:

- manage users
- manage roles
- system settings
- leave types
- document templates
- asset/license types
- add/edit/soft-delete employees
- process exits
- access all reports

## HR Manager

Can perform almost all HR operations but cannot manage users/system settings and cannot delete employees.

## Manager

Can access team-scoped information based on reportingManagerId.

Can:

- view direct/indirect reports
- approve team leave
- approve attendance corrections
- provide manager clearance
- view relevant recruitment jobs
- add interview feedback

Cannot access unrestricted HR data.

## Employee

Can access self-service only:

- own profile
- own attendance
- own leave
- own assets
- own software/access
- own permitted documents
- own onboarding items
- own notifications

Employees cannot access the full employee management list.

## Authentication

- Access JWT lifetime: 15 minutes.
- Refresh token lifetime: 7 days.
- Refresh token stored hashed.
- Refresh token rotation.
- Denylist logout/session invalidation in Redis.
- Passwords use bcrypt with cost >= 10.
- Password minimum: 8 characters, at least one number and one letter.
- Access token held in memory on frontend.
- Refresh via httpOnly cookie.
- On 401, refresh/redirect to login.

Unauthorized:

HTTP 401.

Forbidden:

HTTP 403 with:

{
  "error": {
    "code": "FORBIDDEN",
    "message": "..."
  }
}

Manager scope is derived recursively from reportingManagerId, maximum depth 5.

Audit every:

- create
- update
- delete
- status change

Audit shape:

{
  actorId,
  action,
  entityType,
  entityId,
  before,
  after,
  at,
  ip
}

---

# 7. DATA MODEL

Every major document must contain:

- createdAt
- updatedAt
- createdBy
- isDeleted

Use soft deletion where specified.

Human-readable IDs must be generated atomically through a counters collection:

- Employee: HRV-0001
- Asset: AST-0001
- Job: JOB-0001
- License: LIC-0001
- Candidate: CAN-0001

## Users

Fields:

- email unique
- passwordHash
- role
- employeeId
- isActive
- lastLoginAt
- refreshTokenHash

## Employees

Fields:

- employeeCode
- firstName
- lastName
- photoUrl
- email
- phone
- dob
- address:
  - line1
  - line2
  - city
  - state
  - postalCode
  - country
- emergencyContact:
  - name
  - relation
  - phone
- designation
- departmentId
- reportingManagerId
- employmentType
- dateOfJoining
- probationEndDate
- compensation:
  - amount
  - currency
  - period: monthly/hourly/fixed
- bankDetails:
  - accountHolder
  - accountNumberEnc
  - ifscOrRouting
  - bankName
- status
- statusHistory
- employmentHistory
- lastWorkingDay

Employment types:

- Full-Time
- Intern
- Freelancer
- Contractor
- Other

Statuses:

- Active
- Probation
- On Notice
- Resigned
- Relieved
- Inactive

Bank details must be encrypted at rest.

Normal responses must mask bank details except HR Admin/self according to RBAC.

## Departments

- name
- headEmployeeId

## Jobs

- jobCode
- title
- departmentId
- openings
- description
- requiredSkills[]
- hiringManagerId
- openingDate
- closingDate
- status
- filledCount

Statuses:

- Draft
- Open
- On Hold
- Closed
- Filled

## Candidates

- candidateCode
- name
- email
- phone
- resumeFile
- jobId
- source
- stage
- interviews[]
- selectionStatus
- offerStatus
- joiningDate
- stageHistory
- convertedEmployeeId

Sources:

- LinkedIn
- Referral
- Website
- Agency
- Other

Candidate stages:

Applied
→ Shortlisted
→ Interview
→ Selected / Rejected
→ Offer
→ Joined

Resume:
- pdf/doc/docx
- maximum 10 MB

## Onboarding

- employeeId unique
- status
- items[]
- startedAt
- completedAt

Checklist:

- Personal information
- Identity documents
- Educational documents
- Offer letter
- Agreement/NDA
- Bank information
- Tax information
- Department assignment
- Manager assignment
- Company email/account
- Hardware assignment
- Software/license assignment
- Orientation
- Policy acknowledgement

Statuses:

Not Started
→ In Progress
→ Completed

## Attendance

- employeeId
- date
- status
- workMode
- checkIn
- checkOut
- source
- note

Statuses:

- Present
- Absent
- Half Day
- Holiday
- Leave

workMode:

- Office
- WFH

Use unique compound index:

(employeeId, date)

## Attendance Corrections

- employeeId
- date
- requestedStatus
- requestedWorkMode
- reason
- status
- reviewedBy
- reviewNote

Statuses:

Pending / Approved / Rejected

## Holidays

- date unique
- name

## Leave Types

Configurable by HR:

- name
- code
- annualAllocation
- carryForward
- maxCarryForward
- isPaid
- requiresDocument
- applicableEmploymentTypes[]
- isActive

Seed:

- Casual: 12
- Sick: 10
- Earned: 15
- Unpaid: 0/unlimited

## Leave Balances

- employeeId
- leaveTypeId
- year
- allocated
- used
- pending
- carriedForward

Unique:

employeeId + leaveTypeId + year

## Leave Requests

- employeeId
- leaveTypeId
- fromDate
- toDate
- halfDay
- days
- reason
- status
- approverId
- decisionNote
- decidedAt

Statuses:

Pending / Approved / Rejected / Cancelled

Days exclude weekends and holidays.

## Documents

- employeeId
- category
- title
- file
- version
- previousVersionId
- source
- templateId
- expiryDate
- confidential
- uploadedBy

Categories:

- Offer Letter
- Agreement
- NDA
- Experience Certificate
- Relieving Letter
- Appraisal
- Identity
- Education
- Other

Document examples:

- Internship Offer Letter
- Freelance Agreement
- Full-Time Offer Letter
- NDA
- Employment Agreement
- Experience Certificate
- Relieving Letter
- Salary/Appraisal Letter
- Other HR documents

## Document Templates

- name
- category
- applicableEmploymentTypes[]
- bodyHtml
- isActive

Use Handlebars variables such as:

{{employee.firstName}}
{{employee.designation}}
{{employee.dateOfJoining}}
{{employee.compensation.amount}}
{{company.name}}
{{today}}
{{exit.lastWorkingDay}}

## Assets

Asset:

- assetCode
- name
- type
- brand
- model
- serialNumber
- purchaseDate
- purchaseCost
- condition
- status
- currentAssignmentId
- notes

Types:

- Laptop
- Desktop
- Monitor
- Keyboard
- Mouse
- Headphones
- Mobile Phone
- ID Card
- Other

Statuses:

- Available
- Assigned
- Under Repair
- Lost
- Damaged
- Returned
- Retired

Asset assignments:

- assetId
- employeeId
- assignedAt
- expectedReturnDate
- actualReturnDate
- conditionAtAssign
- conditionAtReturn
- assignedBy
- returnedTo
- notes

Only one active assignment per asset.

Workflow:

Available
→ Assigned
→ Returned
→ Available

## Licenses

- licenseCode
- softwareName
- licenseType
- licenseKeyRef
- provider
- cost
- currency
- billingCycle
- startDate
- renewalDate
- maxSeats
- usedSeats
- status

License types:

- Per-Seat
- Site
- Single-User
- Free
- Other

Statuses:

- Available
- Assigned
- Expired
- Suspended
- Revoked

availableSeats is always:

maxSeats - usedSeats

Do not store availableSeats independently.

License keys are encrypted and never returned in normal list responses.

## License Assignments

- licenseId
- employeeId
- assignedAt
- accountIdentifier
- status
- revokedAt
- revokedBy
- revocationNote

Statuses:

Assigned / Revoked

## Access Items

For external accounts beyond licenses:

- employeeId
- system
- identifier
- status
- revokedAt
- revokedBy
- linkedLicenseAssignmentId

Examples:

- GitHub org
- Google Workspace
- Slack
- VPN
- AWS

Statuses:

Active / Revoked

## Exits

- employeeId
- resignationDate
- noticePeriodDays
- lastWorkingDay
- reason
- reasonNote
- clearances
- checklist
- finalSettlementStatus
- experienceLetterDocId
- relievingLetterDocId
- stage
- completedAt

Exit stages:

Resignation
→ Notice Period
→ Clearance
→ Asset Return
→ Software Revocation
→ Final Settlement
→ Documents
→ Relieved

## Notifications

- userId
- type
- title
- body
- link
- readAt
- dueAt
- dedupeKey

dedupeKey must prevent duplicate reminders.

---

# 8. FUNCTIONAL REQUIREMENTS

## 8.1 DASHBOARD

Route:

GET `/api/v1/dashboard/summary`

Dashboard cards:

- Total employees
- Full-time employees
- Interns
- Freelancers
- New joiners
- Employees on leave
- Employees on notice
- Recently joined
- Leaving soon
- Pending HR actions
- Pending onboarding
- Pending document generation
- Pending asset returns
- Pending software/license revocations

Definitions:

- Total excludes Relieved and Inactive.
- New joiners = joined within last 30 days.
- Employees on leave = employees on approved leave today.
- Leaving soon = LWD within next 30 days.
- Recently joined = latest 5 relevant employees.
- Pending HR actions = pending approvals + onboarding + document generation + asset returns + license revocations.

Cards must be clickable and lead to filtered lists.

Quick actions:

- Add Employee
- Add Candidate
- Start Onboarding
- Generate Document
- Assign Asset
- Assign Software License
- Process Exit

Dashboard must use Redis cache TTL 60 seconds.

Managers receive team-scoped values.

Employees receive personal dashboard data.

---

## 8.2 EMPLOYEE MANAGEMENT

Routes:

POST/GET/PATCH `/api/v1/employees`

GET `/api/v1/employees/:id`

POST `/api/v1/employees/:id/status`

GET `/api/v1/employees/:id/history`

DELETE `/api/v1/employees/:id`

Search by:

- name
- email
- employeeCode
- phone

Filters:

- department
- employmentType
- status
- manager
- joining date range

Employee 360 tabs:

1. Overview
2. Documents
3. Attendance
4. Leave
5. Assets
6. Software & Access
7. Employment History
8. Exit, if applicable

Business rules:

- Email unique → 409 duplicate.
- Phone validation.
- Intern age >= 16.
- Others age >= 18 unless configurable.
- Joining date cannot be > 1 year in future.
- Manager must exist and not be Relieved.
- Employee cannot report to self.
- Circular manager chains prohibited.
- Employment type change appends employment history.
- Employee code remains unchanged.
- Creating employee can optionally create login.
- Creating employee auto-creates leave balances.
- Creating employee auto-creates onboarding checklist.
- Default Full-Time status is Probation when probation configured.
- Moving to On Notice or Resigned auto-creates Exit and checklist.

Allowed status transitions:

Probation → Active | On Notice | Resigned | Inactive
Active → On Notice | Resigned | Inactive
Resigned → On Notice | Relieved guarded
On Notice → Relieved guarded | Active
Inactive → Active
Relieved → terminal, except HR Admin re-hire

Every status transition creates statusHistory.

---

## 8.3 RECRUITMENT

Jobs CRUD.

Candidates CRUD.

Strict candidate workflow:

Applied
→ Shortlisted
→ Interview
→ Selected / Rejected
→ Offer
→ Joined

Provide candidate-to-employee conversion.

When converted:

- create employee
- preserve candidate history
- create onboarding
- create leave balances

---

## 8.4 ONBOARDING

Every newly created employee receives an onboarding checklist.

Status:

Not Started → In Progress → Completed

Smart links should connect checklist items to:

- documents
- employee information
- department
- manager
- company account
- hardware
- software/licenses

Completion must update automatically where appropriate.

---

## 8.5 ATTENDANCE

Support:

- Present
- Absent
- Half Day
- Holiday
- Leave

Work modes:

- Office
- WFH

Views:

- Daily
- Monthly
- Calendar
- History

Attendance correction:

Employee requests → Manager/HR approves or rejects.

Rules:

- duplicate employee/date → conflict
- future attendance forbidden
- WFH/Office only applies to Present/Half Day
- Relieved employee cannot receive attendance after LWD
- nightly job creates Holiday for holidays
- approved leave creates Leave
- weekends do not create Absent
- working day without record creates Absent
- job must be idempotent

---

## 8.6 LEAVE

Employees can:

- apply
- cancel own eligible requests
- view balance
- view history
- view team calendar where permitted

Managers/HR can:

- approve
- reject

HR can configure leave types.

Rules:

- exclude weekends/holidays
- half-day = 0.5
- multi-day half-day not allowed
- no overlapping requests
- insufficient balance rejected
- unpaid leave unlimited
- required documents enforced
- approvals update balances atomically
- approved leave updates attendance
- cancellation restores balance where allowed

---

## 8.7 DOCUMENTS

Support:

- upload
- view
- download
- category
- versions
- employee history
- template generation

Secure file serving is mandatory.

Uploads:

- random server filename
- MIME validation
- size validation
- no public static uploads

Generation:

Employee Data
→ Select Template
→ Generate
→ Preview
→ Download PDF

Generated documents must be linked to employee and template.

Versioning required.

---

## 8.8 ASSETS

Support:

- create
- edit
- list
- search
- filter
- assign
- return
- repair
- retire

Assignment must record history.

When employee exits, show all assigned assets and returned status.

Overdue assets must be filterable.

Do not assign:

- Lost
- Damaged
- Retired
- Under Repair
- Relieved employee

---

## 8.9 SOFTWARE / LICENSES

Support:

- create
- edit
- assign
- revoke
- renew
- suspend
- expire
- utilization

Seat assignment must be atomic.

No assignment if:

- no seats
- expired
- suspended
- revoked
- employee is Relieved

License keys encrypted.

Normal lists must never expose secret key values.

---

## 8.10 EXIT / OFFBOARDING

When employee is On Notice or Resigned:

create Exit record automatically.

Checklist must contain relevant:

- asset returns
- license revocations
- access removals
- manager clearance
- HR clearance
- finance clearance
- final settlement
- experience letter
- relieving letter

Example:

Employee leaves
→ Revoke GitHub
→ Revoke Google Workspace
→ Revoke Figma
→ Collect laptop
→ Collect headphones
→ Complete exit checklist

Do not automatically call external APIs in v1.

Track actions and status only.

When asset returned or license revoked from its own module, corresponding exit checklist item must automatically become Done.

Relieve is blocked if any blocker remains.

HR Admin may force relieve only with:

- `force=true`
- mandatory audited `forceReason`

On successful relieve:

- employee status = Relieved
- user login disabled
- pending leave cancelled
- future attendance blocked
- exit completedAt set
- employment history closed
- lastWorkingDay locked

Withdrawal:

On Notice → Active

must:

- cancel open exit
- preserve exit/checklist history
- leave assets/licenses unaffected

---

## 8.11 REPORTS

Provide:

1. Employee report
2. New joiner report
3. Employee exit report
4. Attendance report
5. Leave report
6. Asset report
7. Software/license report
8. Pending asset returns
9. Pending license revocations
10. Employee cost summary
11. Department-wise employee count

Formats:

- JSON
- CSV
- XLSX

Large exports should use BullMQ.

Salary/cost data is HR Admin/HR Manager only.

Bank data must never be exported.

---

## 8.12 NOTIFICATIONS / REMINDERS

Use BullMQ scheduled jobs.

Default schedule:

Daily at 08:00 server time.

Notifications:

- employee joining: 3 and 1 day before
- employee leaving: 7 and 1 day before
- probation completion: 7 days before
- document expiry: 30 and 7 days before
- software renewal: 30 and 7 days before
- asset return: 3 days before and daily when overdue
- pending approval >24h
- leave request immediately on apply/decision

Use dedupeKey.

Provide:

- in-app notification bell
- email through Nodemailer
- console/log transport in development

---

# 9. FRONTEND ROUTES

Required routes:

/login
/
/employees
/employees/:id
/recruitment/jobs
/recruitment/candidates
/onboarding
/attendance
/leave
/documents
/assets
/licenses
/exit
/reports
/notifications
/settings
/me

Layout:

- left sidebar
- top bar
- global employee search
- notification bell

Sidebar is role filtered.

Tables must have:

- server-side pagination
- sorting
- filtering
- loading state
- empty state
- error state

Forms:

- frontend validation matching backend Zod schemas
- disabled submit while saving
- toast feedback
- confirmation dialogs for destructive actions

Responsive target:

>= 1024px primary.
Usable on tablet.

Accessibility:

- labels
- keyboard navigation
- focus states
- adequate contrast

---

# 10. API CONVENTIONS

Base prefix:

`/api/v1`

List endpoints:

`?page=&limit=&q=&sort=`

Response:

{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0
  }
}

Errors:

{
  "error": {
    "code": "...",
    "message": "...",
    "details": {}
  }
}

Status codes:

- 400 validation
- 401 unauthenticated
- 403 forbidden
- 404 not found
- 409 conflict
- 422 business rule violation

Maximum page limit:

100.

---

# 11. SECURITY / NON-FUNCTIONAL REQUIREMENTS

Security:

- Helmet
- CORS allow-list
- rate limiting
- login limit: 5/min/IP
- Zod validation on every route
- NoSQL injection protection
- upload whitelist
- secure file serving
- field-level encryption for bank details
- field-level encryption for license keys
- no sensitive values in logs

Performance:

- indexed fields
- paginated lists
- max limit 100
- dashboard p95 target <300ms with cache

Reliability:

- idempotent scheduled jobs
- graceful shutdown
- `/health`
- `/ready`

`/ready` must verify MongoDB and Redis.

Observability:

- Pino structured logging
- request IDs

Time:

- store timestamps in UTC
- dates-only fields use YYYY-MM-DD
- company timezone comes from settings

Code quality:

- ESLint
- Prettier
- no console.log in source
- >=80% line coverage on services

---

# 12. SEED DATA

`npm run seed` must create demo data.

Demo password:

`Passw0rd!`

Users:

- admin@harviktech.com → HR Admin
- hrmanager@harviktech.com → HR Manager
- manager@harviktech.com → Manager
- employee@harviktech.com → Employee

Departments:

- Engineering
- Design
- HR
- Finance
- Sales

Employees:

approximately 25 across employment types/statuses.

Include:

- at least 2 On Notice
- at least 1 Relieved
- manager hierarchy of at least 3 levels

Also seed:

- leave types
- current-year holidays
- 5 job openings
- ~15 candidates
- ~30 assets
- ~8 licenses
- assignments
- one expired license
- one near-renewal license
- all 9 document templates
- attendance for last 30 days

Include an exit fixture employee suitable for exit E2E tests.

---

# 13. FILE / DOCUMENT SECURITY

Uploaded files must not be publicly served.

Store files with random server-generated filenames.

Validate:

- extension
- MIME
- size

Maximum default:

10 MB.

Document access must be authorized through the API.

Direct `/uploads/...` guessing must return 404.

---

# 14. REQUIRED ACCEPTANCE TEST CASES

Implement unit/integration/E2E tests.

## AUTH / RBAC

- all four demo roles can login
- invalid login fails
- employee cannot access `/employees`
- manager only sees team
- HR roles have correct permissions
- unauthenticated request → 401
- forbidden request → 403
- logout invalidates refresh session
- passwords are not logged

## EMPLOYEE

- create employee → HRV-#### generated
- duplicate email → 409
- search works
- filters work
- employee 360 returns all tabs/data
- employment type change records history
- manager self-reference rejected
- circular manager chain rejected
- On Notice automatically creates Exit
- Resigned automatically creates Exit
- invalid status transition → 422
- Relieved employee cannot normally transition
- HR Admin rehire works with new employment history entry

## DASHBOARD

- all 14 metrics exist
- values match underlying data
- dashboard cache is used within 60 seconds
- writes invalidate cache
- manager receives team-scoped data
- employee receives personal dashboard
- all 7 quick actions open correct workflow

## RECRUITMENT

- job CRUD
- candidate CRUD
- resume validation
- strict stage transitions
- candidate conversion creates employee/onboarding

## ONBOARDING

- new employee gets checklist
- checklist has all required items
- status transitions work
- linked actions update checklist

## ATTENDANCE

- create valid attendance
- duplicate date → 409
- future date → 422
- WFH on Absent → rejected
- HR can correct
- manager can approve team correction
- employee cannot approve own correction
- holiday job
- leave job
- weekend job
- absent job
- nightly job idempotent
- monthly grid
- calendar
- correction request
- Relieved employee cannot receive attendance

## LEAVE

- valid application
- weekends/holidays excluded
- insufficient balance → 422
- unpaid leave allowed
- overlapping leave rejected
- half-day = 0.5
- multi-day half-day rejected
- required sick document enforced
- manager approval updates balance
- employee cannot approve own leave
- unauthorized manager cannot approve
- rejection requires note
- approved future cancellation restores balance
- past cancellation rejected
- team calendar scoped
- HR can configure leave type
- year rollover
- joining-month pro-rating
- concurrent applications cannot overdraw balance

## DOCUMENTS

- valid upload
- MIME mismatch rejected
- >10MB rejected
- versioning
- owner can access own document
- other employee cannot
- confidential document protected
- direct upload URL inaccessible
- filter works
- expiry tracked
- template preview
- missing template fields rejected
- valid PDF generated
- employment-type mismatch rejected
- Experience Certificate restricted to On Notice/Relieved
- history works
- unsafe HTML sanitized

## ASSETS

- create asset
- duplicate serial rejected
- negative cost rejected
- assignment works
- already assigned rejected
- invalid asset status rejected
- Relieved employee cannot receive asset
- concurrent assignment allows exactly one winner
- return works
- Returned → Available
- invalid return rejected
- repair blocks assignment
- retired asset terminal
- deletion with history prevented/soft handled
- overdue filter
- employee self-service assets
- configurable asset types

## LICENSES

- create license
- invalid seats rejected
- invalid renewal date rejected
- assignment consumes seat
- no seats → 409
- duplicate assignment → 409
- concurrent last-seat assignment has exactly one winner
- expired/suspended/revoked blocked
- revoke releases seat
- duplicate revoke rejected
- renewal recalculates status
- license keys never exposed in list
- reveal key HR Admin only and audited
- employee sees own licenses/access
- Relieved employee cannot receive license
- access item creation
- utilization report

## EXIT

Fixture employee has:

- 2 assets
- 3 licenses
- 1 access item
- pending leave

Test:

1. Start exit.
2. Correct LWD generated.
3. Employee becomes On Notice.
4. Checklist contains all required asset/license/access/clearance/settlement/document items.
5. Exit view shows returned/revoked flags.
6. Returning asset completes linked checklist item.
7. Revoking license completes linked checklist item.
8. Exit checklist license action must revoke the actual license assignment.
9. New asset during notice adds exit checklist item.
10. Manager clearance works.
11. HR clearance cannot be completed by Manager.
12. Relieve with pending blockers → 422 and blocker list.
13. HR Manager cannot force relieve.
14. HR Admin force relieve requires reason.
15. Complete all blockers → Relieved.
16. Login disabled.
17. Leave cancelled.
18. Future attendance blocked.
19. Employment history closed.
20. Withdrawal changes On Notice → Active and cancels exit while preserving audit history.
21. Dashboard pending counts update.
22. Exit report includes employee.
23. Pending return report includes outstanding assets.
24. Concurrent return/relieve cannot create inconsistent state.

## REPORTS

- employee CSV
- new joiner report
- attendance XLSX
- cost report RBAC
- cost calculations
- department counts
- manager leave scope
- large export queued
- unknown report → 404
- pending license revocation report

## NOTIFICATIONS

- joining reminder
- leaving reminder
- probation reminder
- document expiry
- license renewal
- asset return
- overdue asset
- pending approval
- leave notification
- unread filtering
- read notification
- user cannot read another user's notification
- retries with BullMQ
- dedupe prevents duplicate notifications

## SECURITY

- NoSQL injection rejected/sanitized
- XSS safely escaped
- Helmet headers
- no X-Powered-By
- CORS blocked for unauthorized origin
- bank account encrypted in DB
- logs contain no secrets
- health works
- ready checks Mongo/Redis
- audit log created
- path traversal blocked
- list limit capped at 100

---

# 15. PLAYWRIGHT E2E FLOWS

## E2E 1 — Hire to Onboard

HR Admin login
→ Add Candidate
→ move Applied → Shortlisted → Interview → Selected → Offer → Joined
→ Convert to Employee
→ onboarding checklist appears
→ generate Offer Letter
→ preview
→ download PDF
→ assign laptop
→ assign GitHub license
→ linked onboarding items update

## E2E 2 — Leave

Employee login
→ apply leave
→ Manager login
→ approve
→ attendance calendar shows Leave
→ balance reduced
→ team calendar shows leave

## E2E 3 — Attendance Correction

Employee
→ request correction
→ Manager
→ approve
→ monthly attendance updates

## E2E 4 — Exit

HR Admin
→ Process Exit
→ view assets/licenses/access
→ attempt Relieve
→ blocked
→ show blockers
→ return assets
→ revoke licenses
→ complete access
→ clearances
→ settlement
→ generate Experience Letter
→ generate Relieving Letter
→ Relieve
→ employee becomes Relieved
→ dashboard counts update

## E2E 5 — RBAC

Employee login
→ only self-service navigation visible
→ direct `/employees` blocked/redirected

## E2E 6 — Reports

HR Manager
→ export Employee CSV
→ export Pending Asset Returns XLSX

---

# 16. BUILD PHASES

## P0 — Foundation

Implement:

- repo
- Docker Compose
- Mongo replica set
- Redis
- API
- worker
- web
- Nginx/Caddy
- config
- logging
- errors
- health
- auth
- RBAC
- audit
- ID generator
- encryption utility
- seed skeleton

Definition of Done:

- docker compose works
- AUTH tests pass
- SEC foundation tests pass

## P1 — Employees + Dashboard

Implement:

- departments
- employees
- employee 360
- history
- status machine
- dashboard

DoD:

EMP tests pass.
Dashboard tests pass.

## P2 — Assets + Licenses + Access

Implement:

- assets
- assignment history
- licenses
- seats
- access items
- transactions/concurrency

DoD:

AST and LIC tests pass.

## P3 — Exit

Implement:

- exit creation
- checklist generation
- clearances
- asset/license linkage
- relieve guard
- force-relieve

DoD:

EXT tests pass.

## P4 — Documents

Implement:

- uploads
- secure serving
- versions
- templates
- preview
- PDF generation

DoD:

DOC tests pass.

## P5 — Attendance + Leave

Implement:

- attendance
- correction
- calendar
- monthly view
- leave
- balances
- team calendar
- nightly jobs

DoD:

ATT and LEV tests pass.

## P6 — Recruitment + Onboarding

Implement:

- jobs
- candidates
- workflow
- resume uploads
- candidate conversion
- onboarding

DoD:

REC and ONB tests pass.

## P7 — Reports + Notifications

Implement:

- 11 reports
- CSV/XLSX
- large exports
- notification bell
- email
- BullMQ reminders
- deduplication

DoD:

REP and NOT tests pass.

## P8 — Hardening + E2E

Implement:

- frontend polish
- accessibility
- Playwright
- OpenAPI
- README
- deployment documentation
- architecture diagram
- coverage improvements

DoD:

- all E2E flows pass
- >=80% service line coverage
- final acceptance checklist passes

---

# 17. FINAL ACCEPTANCE CHECKLIST

Before declaring the project complete, verify:

- [ ] docker compose up --build works
- [ ] nginx/caddy starts
- [ ] API starts
- [ ] worker starts
- [ ] Mongo replica set works
- [ ] Redis works
- [ ] app available at :8080
- [ ] React 19 + Vite used
- [ ] Node + Express used
- [ ] MongoDB 7 used
- [ ] Redis 7 used
- [ ] npm run seed works
- [ ] all four demo users can log in
- [ ] all original HR requirements are implemented
- [ ] all acceptance tests pass
- [ ] E2E flows pass
- [ ] RBAC enforced server-side
- [ ] bank details encrypted
- [ ] license keys encrypted
- [ ] sensitive data masked
- [ ] documents securely served
- [ ] no automatic external account revocation
- [ ] exit blockers enforced
- [ ] reports export CSV/XLSX
- [ ] reminders deduplicated
- [ ] audit logs work
- [ ] health/ready endpoints work
- [ ] README complete
- [ ] docs/DECISIONS.md complete
- [ ] requirement-to-feature mapping included in README

---

# 18. REQUIREMENT TRACEABILITY

The implementation must map every business requirement to a module:

1. Dashboard → dashboard module
2. Employee Management → employees module
3. Recruitment → recruitment module
4. Onboarding → onboarding module
5. Attendance → attendance module
6. Leave → leave module
7. Documents → documents module
8. Hardware/Assets → assets module
9. Software/Licenses → licenses + access modules
10. Exit → exit module
11. Reports → reports module
12. Notifications → notifications module
13. Access Control → auth/users/RBAC modules
14. Employee lifecycle / 360 view → employees + all connected modules

README must contain a requirement traceability table.

---

# 19. AGENT BEHAVIOR

When implementing:

1. Read this entire file first.
2. Inspect the repository before creating files.
3. Preserve existing working code unless it violates this contract.
4. Implement one phase at a time.
5. Do not create fake/mock-only functionality in place of required backend behavior.
6. Do not use hardcoded demo values for actual business logic.
7. Use seed data only for development/testing fixtures.
8. Keep frontend and backend validation aligned.
9. Prefer transactions for operations explicitly requiring atomicity.
10. Add tests with each feature.
11. Run tests after each meaningful change.
12. Run lint before completing each phase.
13. Keep documentation synchronized with implementation.
14. Record genuine implementation decisions in `docs/DECISIONS.md`.
15. At completion, run the full acceptance suite and report any failures instead of claiming success.

---

# 20. COMPLETION STANDARD

The system is complete only when:

- it implements the complete employee lifecycle,
- all required modules are connected,
- Employee 360 works,
- RBAC works,
- security requirements work,
- exit workflow is enforced,
- documents/assets/licenses are linked to employees,
- reports and notifications work,
- acceptance tests pass,
- E2E flows pass,
- deployment works from Docker Compose,
- seed data works,
- documentation is complete.

Do not declare completion based only on the frontend looking correct.
The backend rules, database model, tests, security, jobs, and integrations are part of the deliverable.
