---
name: tasks
description: Working with Tasks and Task Templates.
---

# Purpose

Use this skill to create, update, and explain tasks in the
[Tasks](https://app.notion.com/p/39f6361404d980d99ebad2bd478ac9af)
database and repeating-task definitions in
[Task Templates](https://app.notion.com/p/3c46361404d9809bb240c917c72804fe).
Treat Task Templates as the source of truth for repetition. Do not manually create
a batch of future recurring tasks; the worker creates and maintains them.

# Choose the correct database

- Create a one-time action in **Tasks**.
- Create any repeating action in **Task Templates**.
- If the user asks to make an existing task repeat, convert it using the procedure below.
- Do not put ordinary one-time tasks in Task Templates.
- Do not expose or ask the user to write an RRULE when a supported friendly
  schedule expresses the request.

# Create a one-time task

Create a page in Tasks and set:

- **Title:** the action, written as a concise verb phrase.
- **Status:** Not started unless the user explicitly requests another status.
- **Start:** when work may begin, if the user gives a start date.
- **Due:** the deadline, if the user gives one.
- **Notes:** supporting details that belong in a property.
- **Context:** copy any context the user names.

Date rules:

- “Due Friday” means set Due only.
- “Start Friday” or “available Friday” means set Start only.
- “Start Friday and due two weeks later” means set both Start and Due.
- Do not invent a Due date when the user only provides a Start date.
- Leave **Template**, **Repeat**, **Occurrence Key**, and **Completed At** empty
  for a one-time task.

Put checklists, instructions, links, and other longer material in the page body.

# Create a repeating task

Create one page in Task Templates. Set these user-managed properties:

- **Name:** title copied to every task instance.
- **Enabled:** checked unless the user asks to pause the series.
- **Repeat Mode:** Regularly or After completion.
- **Schedule:** a friendly schedule from the supported language below.
- **Starts:** a required date-only first occurrence.
- **Due Offset Days:** leave empty for Start-only, use 0 for Start and Due on the
  same day, or use a positive whole number for a later Due.
- **Notes:** details copied to all instances.
- **Context:** context copied to all instances.

Add reusable instructions and checklists to the template page body. Use unchecked
to-do items in a template. The body is copied when each new task is created.
Editing template body content later affects future tasks only; it does not
overwrite content in existing task instances.

Do not create the six-month set of tasks yourself. For Regularly templates, the
worker creates and reconciles occurrences through the next six calendar months
after the template workflow runs, and the nightly workflow maintains that window.

# Choose the repeat mode

## Regularly

Use **Regularly** when dates belong to a fixed calendar cadence, whether or not
earlier tasks are complete.

Examples:

- every weekday
- every two weeks
- every month on the 20th
- every year on the second Saturday of February

The worker materializes the next six months and links every instance to the same template.

## After completion

Use **After completion** when the next task should be scheduled relative to the day
the current task is completed. The next task is created only after completion.

Examples:

- one week after completion → **Schedule: Every week**
- every two weeks after completion → **Schedule: Every 2 weeks**
- one month after completion → **Schedule: Monthly**

Starts is still required. It supplies the initial task date; later dates are
calculated from completion.

# Friendly schedules

Prefer these forms in **Schedule**:

| Meaning                       | Schedule value                    |
| ----------------------------- | --------------------------------- |
| Every day                     | Daily                             |
| Monday through Friday         | Weekdays                          |
| Every Monday                  | Every Monday                      |
| Monday and Thursday each week | Every week on Monday and Thursday |
| Every two weeks               | Every 2 weeks                     |
| Every month                   | Monthly                           |
| The 20th of every month       | Every month on the 20th           |
| Last Friday of every month    | Last Friday of every month        |
| Every February 6              | February 6                        |
| First Saturday of February    | 1st Saturday of February          |
| Second Saturday of February   | 2nd Saturday of February          |

The ordinal yearly form supports first through fifth and last, weekday names, and
month names. For example, “every year on the 2nd Saturday of February” should be
stored as **2nd Saturday of February**.

A raw `FREQ=...` RRULE is an escape hatch only when the friendly language cannot
represent the request.

# Place recurrence dates

Every generated repeating task has its occurrence date in **Start**.

- Leave **Due Offset Days** empty for no due date.
- Use **Due Offset Days = 0** for a due date on the same day as Start.
- Use a positive whole number for a later deadline. The offset is in calendar days.

Example: a monthly task starting September 20 with no deadline uses Starts =
September 20, Schedule = Every month on the 20th, and an empty Due Offset Days.

# Convert an existing task into a repeating task

When the user says to make an existing task recurring:

1. Read the existing task title, Notes, Context, Start, Due, and page body.
2. Create a Task Template with the matching Name, Notes, Context, and body.
3. In the copied template body, change checked to-do items to unchecked.
4. Set Repeat Mode, Schedule, Starts, Due Offset Days, and Enabled from the user request.
5. Relate **Template** on the existing task to the new template.
6. Do not manually create future instances. Let the worker reconcile the series.
7. Do not delete the existing task unless the user explicitly asks.

For Starts, use the existing task Start when possible; fall back to an existing Due
date for a due-only task. If neither exists and the user did not give a first date,
ask for the first occurrence date.

# Template synchronization

Editing a template synchronizes these properties to every related instance,
including completed history:

- title
- Notes
- Context
- Template relation

The worker preserves instance state such as Status and Completed At. Regular
reconciliation may reschedule future Start and Due values when the schedule
changes.

Template page body content is copy-on-create and is not synchronized into existing tasks.

# Validation and feedback

After creating or editing a template, inspect:

- **Schedule Error**
- **Schedule Description**
- **RRULE**

A valid template has an empty Schedule Error and a populated Schedule Description
and RRULE after the update workflow runs.

If Schedule Error is not empty:

1. Do not create recurring task instances manually.
2. Read and report the exact error.
3. Correct the user-managed property that caused it.
4. Check validation again.

Common validation failures include:

- missing Name
- missing Starts
- Starts includes a time instead of being date-only
- missing or unsupported Schedule
- Repeat Mode is not exactly Regularly or After completion
- Due Offset Days is negative or fractional

# Worker-managed properties

Do not edit these unless following the existing-task conversion procedure above:

On Tasks:

- Completed At
- Repeat
- Occurrence Key
- Template

On Task Templates:

- Instances
- RRULE
- Schedule Description
- Schedule Error

Completing a task means setting **Status = Done**. The completion workflow records
Completed At and, for an enabled After completion template, creates exactly one
successor.

# Safety rules

- Preserve completed history.
- Never manufacture multiple future recurrences by hand.
- Never delete or archive a task or template without an explicit request.
- Never silently guess a missing first occurrence date for a repeating task.
- When a request is ambiguous between Start and Due, ask whether the date is an
  availability date or a deadline.
- Use exact, case-sensitive property and select-option names from this skill.
