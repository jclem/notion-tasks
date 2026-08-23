# Notion Tasks

A template-driven task system designed to replace Things. Repeating tasks are
configured in a separate Task Templates data source using friendly schedules such
as `Weekdays` and `1st Saturday of February`; normal task views never expose raw
RRULEs.

## How the system works

The system uses three Notion data sources:

- `Tasks` contains actionable and historical task instances.
- `Task Templates` is the source of truth for every repeating series.
- `Contexts` is a shared lookup data source. An existing contexts data source can
  be used instead.

```text
Task Template ──Template relation──▶ Task instance
      │                                  │
      ├──Root Task───────────────────────┤
      │                                  └──Repeat Of──▶ first task in the series
      └──Context────────────────────────────Context◀──Context── Task instance
```

The ownership rules are:

- A template owns series configuration and copied defaults: title, notes, context,
  repeat mode, and schedule.
- A task owns instance state: status, due date, and completion time.
- `Repeat Of` always identifies the first task in the series. The root task relates
  to itself, so every instance follows the same invariant.
- A repeating task always has a template. One-off tasks have no template.
- Editing a template updates its owned fields on every related task, including
  completed instances, without overwriting instance state.

## Notion schemas

Property and option names are case-sensitive because the Worker uses them as its API
contract.

### Tasks

| Property         | Notion type               | Ownership and behavior                                                                                                   |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Title`          | Title                     | Required. Copied from the template for repeating tasks; freely editable for one-off tasks.                               |
| `Status`         | Status                    | Required. Must include `Not started` and `Done`. `Done` triggers completion handling.                                    |
| `Due`            | Date                      | Optional for one-off tasks. Date-only for generated instances.                                                           |
| `Completed At`   | Date                      | Worker-managed completion timestamp.                                                                                     |
| `Notes`          | Text                      | Copied from the template for repeating tasks; freely editable for one-off tasks.                                         |
| `Context`        | Relation → Contexts       | Copied from the template for repeating tasks.                                                                            |
| `Template`       | Relation → Task Templates | Empty for one-off tasks; set on every repeating instance. Configure a reciprocal `Instances` property on Task Templates. |
| `Repeat`         | Rollup                    | Roll up `Template` → `Schedule Description` with “Show original” for a friendly recurrence label.                        |
| `Repeat Of`      | Relation → Tasks          | Points to the root task, including from the root task itself.                                                            |
| `Occurrence Key` | Text                      | Hidden, Worker-managed deduplication key.                                                                                |

Suggested status options are `Inbox`, `Not started`, `In progress`, `Done`, and
`Canceled`. Only `Not started` and `Done` are interpreted by the current Worker.

### Task Templates

| Property               | Notion type                    | Ownership and behavior                                                                                     |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `Name`                 | Title                          | The title copied to every instance. The title property may be renamed because the Worker finds it by type. |
| `Enabled`              | Checkbox                       | Disabled templates do not create or reconcile instances. Existing tasks remain.                            |
| `Repeat Mode`          | Select                         | Exactly `Regularly` or `After completion`.                                                                 |
| `Schedule`             | Text                           | User-edited friendly schedule. This is the normal recurrence UI.                                           |
| `Starts`               | Date                           | Initial task due date and the DTSTART anchor for regular recurrence.                                       |
| `Notes`                | Text                           | Copied to every instance. Useful for details such as an amount or payment method.                          |
| `Context`              | Relation → Contexts            | Copied to all instances.                                                                                   |
| `Root Task`            | Relation → Tasks               | Worker-managed single relation to the first series instance.                                               |
| `Instances`            | Reciprocal relation from Tasks | All tasks whose `Template` points here. Useful in the UI; the Worker queries from the Tasks side.          |
| `RRULE`                | Text                           | Hidden, Worker-managed normalized RRULE.                                                                   |
| `Schedule Description` | Text                           | Worker-managed canonical display, such as `Every February on the 1st Saturday`.                            |
| `Schedule Error`       | Text                           | Worker-managed validation feedback. Empty for a valid template.                                            |

To make another template property propagate, add it to both data sources and to
`synchronizedTaskProperties` in `src/lib/taskTemplate.ts`.

### Contexts

Only `Name` is required by the Worker. `Active` is an optional organizational field:

| Property | Notion type | Behavior                                                              |
| -------- | ----------- | --------------------------------------------------------------------- |
| `Name`   | Title       | Context name.                                                         |
| `Active` | Checkbox    | Optional. Allows retired contexts to be hidden without deleting them. |

The Tasks and Task Templates relations may be reciprocal for navigation. The Worker
copies every related context ID, although the UI can enforce a single context by
convention.

## Friendly schedules

`Schedule` supports a predictable subset of English rather than open-ended natural
language.

| Schedule                            | Compiled RRULE                       |
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

Raw `FREQ=...` input remains available as an escape hatch. Normal views should hide
`RRULE` and display `Schedule Description` and `Schedule Error` instead.

All recurrence calculations use `America/New_York`. Generated tasks have date-only
due dates.

## Recurrence behavior

### Template creation or update

The `onUpdate` workflow handles page-created and page-updated events but exits unless
the page belongs to `TASK_TEMPLATES_DATA_SOURCE_ID`.

1. Compile `Schedule` and update `RRULE`, `Schedule Description`, and
   `Schedule Error` only when their values changed.
2. Find or create the root task and make its `Repeat Of` relation self-referential.
3. Copy `Title`, `Notes`, `Context`, and `Template` to every instance, including
   completed history. `Status`, `Due`, and `Completed At` are not overwritten by
   ordinary template synchronization.
4. For `Regularly`, reconcile dates after the current Eastern day through six
   calendar months ahead. Exact matches are reused, surplus pages are trashed,
   existing pages are rescheduled where possible, and missing dates are created.

Generated regular occurrences are locked in the Notion UI. The Worker can still
update them when their template changes.

### Repeat after completion

The `onCompletion` workflow reacts only when a task is `Done` and has no
`Completed At` value. It records the event timestamp and loads the task's current
template.

For an enabled `After completion` template, it calculates the first RRULE occurrence
after the Eastern completion date and creates exactly one new, unlocked task. The new
task points to the original root through `Repeat Of`; a chain never changes roots.

The occurrence key is derived from the completed task ID. Before creating a task, the
Worker queries for that key, so retries and duplicate page events converge on the same
logical next task. Changing a template affects the next task created but does not
rewrite historical dates that depended on earlier completion times.

### Repeat regularly

The `nightlyReconcile` workflow uses a scheduled trigger. Configure the deployed
trigger to run daily at midnight in `America/New_York`. It queries every enabled
`Regularly` template and performs the same six-month reconciliation used after a
template edit.

Each regular occurrence key is derived from the template ID and due date. Notion page
creation does not expose a native idempotency key, so the reconciler also treats
duplicate pages as surplus and repairs them on the next template edit or nightly
sweep.

## Durable execution and retry safety

All Notion reads, writes, time generation, and environment reads run inside awaited
Worker steps. Step keys include a hash of the Notion operation and arguments, which
makes repeated work stable across workflow replay.

The system uses several additional duplicate guards:

- Every logical task instance has a deterministic `Occurrence Key`.
- Completion-driven creation queries for that key before creating a successor.
- Regular reconciliation reuses exact due-date matches and removes surplus pages.
- Root tasks use a stable root key; duplicate roots are detected and trashed.
- API failures propagate so the Worker run remains visibly failed and retryable.

## Suggested Things-like views

- `Inbox`: `Status` is `Inbox`.
- `Today`: not done, and `Due` is today or earlier.
- `Upcoming`: not done, sorted by `Due` ascending.
- `Anytime`: not done and `Due` is empty.
- `Logbook`: `Status` is `Done`, sorted by `Completed At` descending.
- `Repeating`: Task Templates where `Enabled` is checked, showing
  `Schedule Description` and `Schedule Error`.

Hide `Completed At`, `Template`, `Repeat Of`, and `Occurrence Key` from normal task
views. They are system metadata rather than part of the capture interface.

## Workflows

| Key                | Trigger                        | Outcome                                                       |
| ------------------ | ------------------------------ | ------------------------------------------------------------- |
| `onUpdate`         | Notion page created or updated | Compiles and reconciles Task Templates.                       |
| `onCompletion`     | Notion page updated            | Records completion and creates an after-completion successor. |
| `nightlyReconcile` | Scheduled recurrence           | Maintains six months of regular occurrences.                  |

Workflow files live directly under `src/workflows/`; each filename is its deployed
workflow key.

## Local setup

Node 22 or newer and npm 10.9.2 or newer are required. Install
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

Add `NOTION_API_TOKEN` locally when the Worker runtime does not already provide its
Notion client credentials. Never commit `.env` or hard-code credentials.

The Tasks, Task Templates, and Contexts data sources must all be shared with the
Notion connection. Relations can appear empty to the API when the related data source
has not been shared.

## Verification and deployment

Run:

```sh
npm test
npm run check
npm run build
```

Then deploy and push the environment:

```sh
ntn workers deploy
ntn workers env push
```

Finally, configure `nightlyReconcile` to run every day at midnight in
`America/New_York`.
