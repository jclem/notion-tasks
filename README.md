# Notion Tasks

Notion Tasks is a task system built around templates. It keeps repeating task rules
in a separate Task Templates data source. You can write schedules in plain language,
such as `Weekdays` or `1st Saturday of February`. You do not need to see or write raw
RRULEs in your normal task views.

## How it works

The system uses two main Notion data sources:

- `Tasks` holds the tasks you work on and the tasks you have finished.
- `Task Templates` holds the rules for every repeating task.

A task made from a template is called an **instance**.

```text
Task instance ──Template──▶ Task Template
```

The rules are simple:

- A template controls the task title, notes, context, repeat mode, and schedule.
- A task controls its own status, dates, and completion time.
- A repeating task always points to its template through the `Template` relation.
  A one-time task does not have a template.
- When you edit a template, the Worker copies the template-owned fields to all
  tasks linked to it, including finished tasks.
- The Worker may change dates on future regular tasks when it checks the schedule.
  It does not change dates in finished history.

## Setup

### Install

You need Node 22 or newer and npm 10.9.2 or newer. Install
[mise](https://mise.jdx.dev/), then run:

```sh
mise run bootstrap
cp .env.example .env
```

Add the data source IDs to `.env`:

```dotenv
TASKS_DATA_SOURCE_ID=...
TASK_TEMPLATES_DATA_SOURCE_ID=...
```

Add `NOTION_API_TOKEN` when your local Worker does not already have Notion login
details. Never commit `.env`, and never put a login token directly in the code.

Share the Tasks, Task Templates, and Contexts data sources with the Notion
connection. If a related data source is not shared, its relations may look empty
to the API.

### Check and deploy

Run all checks:

```sh
npm test
npm run check
npm run build
```

Then deploy the Worker and send it the `.env` settings:

```sh
ntn workers deploy
ntn workers env push
```

The `Deploy` GitHub Actions workflow also deploys after every push to `main`. You
can run it by hand with the “Run workflow” button. It rebuilds the ignored
`workers.json` file from these repository variables:

- `NOTION_WORKERS_CONFIG_VERSION`
- `NOTION_ENV`
- `NOTION_WORKSPACE_ID`
- `NOTION_WORKER_ID`

It reads `NOTION_API_TOKEN` from a repository secret. The workflow stops with a
clear error when the secret or any required variable is missing.

Set `nightlyReconcile` to run every day at midnight in `America/New_York`.

Set the `onUpdate` property trigger to watch `Name`, `Enabled`, `Repeat Mode`,
`Schedule`, `Starts`, `Due Offset Days`, `Notes`, and `Context`.

## Notion schemas

Property names and option names are case-sensitive. The Worker looks for these
exact names.

### Tasks

| Property         | Notion type               | What it does                                                                                                    |
| ---------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Title`          | Title                     | Required. Copied from the template for repeating tasks. You can edit it freely on one-time tasks.               |
| `Status`         | Status                    | Required. Must include `Not started` and `Done`. Setting a task to `Done` starts the completion workflow.       |
| `Start`          | Date                      | Optional on one-time tasks. Every generated repeating task stores its occurrence date here.                     |
| `Due`            | Date                      | Optional. A template can set it to the Start date or a number of days after Start.                              |
| `Completed At`   | Date                      | Set by the Worker when a task is completed.                                                                     |
| `Notes`          | Text                      | Copied from the template for repeating tasks. You can edit it freely on one-time tasks.                         |
| `Context`        | Relation → Contexts       | Copied from the template for repeating tasks.                                                                   |
| `Template`       | Relation → Task Templates | Empty on one-time tasks. Every repeating task points to its template. Link it to `Instances` on Task Templates. |
| `Repeat`         | Rollup                    | Shows `Template` → `Schedule Description` with “Show original” so people can read the repeat rule.              |
| `Occurrence Key` | Text                      | Hidden value set by the Worker to prevent duplicate tasks.                                                      |

Suggested status options are `Inbox`, `Not started`, `In progress`, `Done`, and
`Canceled`. The Worker only gives special meaning to `Not started` and `Done`.

### Task Templates

| Property               | Notion type                | What it does                                                                                    |
| ---------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| `Name`                 | Title                      | Copied to every task title. You may rename this property because the Worker finds it by type.   |
| `Enabled`              | Checkbox                   | When unchecked, the template does not create or update tasks. Existing tasks stay in place.     |
| `Repeat Mode`          | Select                     | Must be exactly `Regularly` or `After completion`.                                              |
| `Schedule`             | Text                       | The plain-language repeat rule you edit.                                                        |
| `Starts`               | Date                       | Required. The first occurrence and the starting date used by the RRULE. Do not include a time.  |
| `Due Offset Days`      | Number                     | Optional. A whole number of days from Start to Due. Leave it empty for no Due date.             |
| `Notes`                | Text                       | Copied to every task. You can use it for details such as an amount or payment method.           |
| `Context`              | Relation → Contexts        | Copied to every task.                                                                           |
| `Instances`            | Linked relation from Tasks | Shows all tasks that point to this template. The Worker reads the relation from the Tasks side. |
| `RRULE`                | Text                       | Hidden repeat rule created by the Worker.                                                       |
| `Schedule Description` | Text                       | Standard description created by the Worker, such as `Every February on the 1st Saturday`.       |
| `Schedule Error`       | Text                       | Explains a bad schedule. It is empty when the template is valid.                                |

If you want another template field copied to tasks, add that field to both data
sources. Then add it to `synchronizedTaskProperties` in
`src/lib/taskTemplate.ts`.

### Start and Due dates

Every generated task puts its occurrence date in `Start`. `Due Offset Days`
controls its deadline:

- Leave it empty for no Due date.
- Use `0` when Start and Due should be the same day.
- Use a positive whole number when Due should be later.

The offset uses calendar days. For example, a task with Start `2026-09-20` and
`Due Offset Days = 14` gets Due `2026-10-04`.

The Worker moves future tasks that only have Due dates to this Start-based setup.
It does not make a second series, and it does not rewrite finished history.

For `After completion`, the Worker first finds the next occurrence date from the
completion date. It puts that date in Start. It also sets Due when the template has
a Due offset.

### Contexts

The Worker only needs a `Name` property. `Active` is optional.

| Property | Notion type | What it does                                                |
| -------- | ----------- | ----------------------------------------------------------- |
| `Name`   | Title       | The context name.                                           |
| `Active` | Checkbox    | Optional. Lets you hide an old context without deleting it. |

The Tasks and Task Templates relations can link back to Contexts to make browsing
easier. The Worker copies every linked context. You can choose to use only one
context per task in the Notion interface.

## Friendly schedules

`Schedule` accepts a small, clear set of English phrases. It does not try to
understand every possible sentence.

| Schedule                            | RRULE made by the Worker             |
| ----------------------------------- | ------------------------------------ |
| `Daily`                             | `FREQ=DAILY`                         |
| `Weekdays`                          | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`   |
| `Every Monday`                      | `FREQ=WEEKLY;BYDAY=MO`               |
| `Every week on Monday and Thursday` | `FREQ=WEEKLY;BYDAY=MO,TH`            |
| `Every 2 weeks`                     | `INTERVAL=2;FREQ=WEEKLY`             |
| `Monthly`                           | `FREQ=MONTHLY`                       |
| `Every month on the 20th`           | `FREQ=MONTHLY;BYMONTHDAY=20`         |
| `Last Friday of every month`        | `FREQ=MONTHLY;BYDAY=-1FR`            |
| `February 6`                        | `FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=6` |
| `1st Saturday of February`          | `FREQ=YEARLY;BYMONTH=2;BYDAY=+1SA`   |

Advanced users may enter a raw rule that starts with `FREQ=`. Normal Notion views
should hide `RRULE`. Show `Schedule Description` and `Schedule Error` instead.

All repeat dates use the `America/New_York` time zone. Generated Start and Due
values are dates without times.

## What happens when tasks repeat

### When a template is created or changed

The `onUpdate` workflow runs when a Notion page is created or changed. It stops
unless that page belongs to `TASK_TEMPLATES_DATA_SOURCE_ID`.

For a valid template, the Worker does this:

1. It turns `Schedule` into an `RRULE` and fills in `Schedule Description`. If
   the schedule is wrong, it writes the problem in `Schedule Error`.
2. It copies `Title`, `Notes`, `Context`, and `Template` to every linked task,
   including finished tasks. This normal update does not overwrite `Status`,
   `Due`, or `Completed At`.
3. For `After completion`, it creates one first task from `Starts` when the
   enabled template has no tasks yet.
4. It copies the template page body into each new task. It only copies the body
   when it creates the task. Later template edits do not replace checklists or
   other page content inside existing tasks. If Notion cannot return the complete
   template body, the run fails and shows an error.
5. For `Regularly`, it checks all dates from today through six months from today.
   It includes today. It reuses tasks on the right dates, moves future tasks when
   needed, sends extra tasks to trash, and creates missing tasks.

Generated `Regularly` tasks are locked in Notion. The Worker can still update them
when their template changes.

### Repeat after completion

The `onCompletion` workflow runs when a task changes. It only acts when the task
has `Status = Done` and `Completed At` is empty. It saves the completion time and
loads the task's template.

If the template is enabled and uses `After completion`, the Worker finds the first
RRULE date after the completion date. It creates exactly one new, unlocked task.
The new task gets the template body and points to the same template.

The new task's `Occurrence Key` comes from the completed task's ID. Before the
Worker creates the new task, it looks for that key. This keeps a retry or a second
Notion event from making another copy.

Changing the template affects tasks made later. It does not change old dates that
were based on an earlier completion time.

### Repeat regularly

The `nightlyReconcile` workflow runs on a schedule. Set it to run every day at
midnight in `America/New_York`.

It checks every enabled `Regularly` template. It then checks and fixes the next six
months of tasks in the same way as a template edit.

Each regular task gets an `Occurrence Key` made from its template ID and date.
Notion does not let page creation use a built-in duplicate-prevention key. If two
copies are ever created, the next template update or nightly run treats one as
extra and sends it to trash.

## Safe retries

Notion Workers can retry a run after an error. The code is built to make retries
safe.

- All Notion reads and writes happen inside saved Worker steps.
- Reading the current time and reading environment settings also happen inside
  saved steps.
- Step keys include the Notion action and its arguments, so a replay can match the
  same saved work.
- Every repeating task has a predictable `Occurrence Key`.
- The completion workflow checks for an existing key before making the next task.
- Regular schedule checks reuse tasks on the correct dates and remove extras.
- First `After completion` tasks use a stable key. A later template check sends
  extra first tasks to trash.
- API errors are not hidden. The run stays failed so you can see it and retry it.

## Suggested views

- `Inbox`: `Status` is `Inbox`.
- `Today`: not done, and `Due` is today or earlier.
- `Upcoming`: not done, sorted by `Due` from earliest to latest.
- `Anytime`: not done, and `Due` is empty.
- `Logbook`: `Status` is `Done`, sorted by newest `Completed At` first.
- `Repeating`: Task Templates where `Enabled` is checked. Show
  `Schedule Description` and `Schedule Error`.

Hide `Completed At`, `Template`, and `Occurrence Key` from normal task views.
They are system fields, not fields you need for everyday task entry.

## Workflows

| Key                | Trigger                        | What it does                                               |
| ------------------ | ------------------------------ | ---------------------------------------------------------- |
| `onUpdate`         | Notion page created or changed | Reads and checks Task Templates, then updates their tasks. |
| `onCompletion`     | Notion page changed            | Saves completion and makes the next after-completion task. |
| `nightlyReconcile` | Daily schedule                 | Keeps six months of regular tasks ready.                   |

Workflow files are stored directly in `src/workflows/`. Each filename becomes the
workflow key used after deployment.
