# Notion Tasks

A system for managing tasks.

## Getting started

Install [mise](https://mise.jdx.dev/), then run:

```sh
mise run bootstrap
```

## Task data source

The workflows expect a Notion data source with the following schema. Property names are
case-sensitive and must match exactly unless noted otherwise.

| Property               | Notion type           | Configuration                                                                                                                                           |
| ---------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Title`                | Title (`title`)       | Required. This is the data source's title property. It may be renamed because the workflows identify it by type.                                        |
| `Status`               | Status (`status`)     | Required. Must include an option named `Not started`.                                                                                                   |
| `Due`                  | Date (`date`)         | Required. Supplies the start date for regular recurrence and receives every generated date-only due date.                                               |
| `Completed At`         | Date (`date`)         | Required. Empty on an open task; set to the completion timestamp by `onCompletion`.                                                                     |
| `Repeat Regularly`     | Text (`rich_text`)    | Required property, optional value. Contains the source task's RRULE.                                                                                    |
| `Repeat on Completion` | Text (`rich_text`)    | Required property, optional value. Contains the RRULE used to calculate the next task after completion.                                                 |
| `Repeat Of`            | Relation (`relation`) | Required. Configure it as a relation back to the same task data source. Generated regular occurrences point to their source task through this property. |

`Source URL` with type URL (`url`) and `Assignee` with type Person (`people`) are
optional. They are copied along with other writable, non-dynamic task properties when
the workflows create or synchronize occurrences.

### Recurrence rules

Store an [RFC 5545 RRULE](https://datatracker.ietf.org/doc/html/rfc5545#section-3.8.5.3)
without a `DTSTART`; the workflow supplies the start date. Useful values include:

| Schedule                            | Value                        |
| ----------------------------------- | ---------------------------- |
| Every day                           | `FREQ=DAILY`                 |
| Every 30 days                       | `FREQ=DAILY;INTERVAL=30`     |
| Every week                          | `FREQ=WEEKLY`                |
| Every Monday, Wednesday, and Friday | `FREQ=WEEKLY;BYDAY=MO,WE,FR` |
| Every month                         | `FREQ=MONTHLY`               |
| Every year                          | `FREQ=YEARLY`                |

Use daily-or-longer frequencies for date-only tasks. `Repeat Regularly` rejects hourly,
minutely, and secondly rules.

`Repeat on Completion` uses the Eastern calendar date containing the completion
timestamp as its start and creates one next task. The new task has empty page contents,
no `Completed At`, a `Not started` status, and a date-only `Due`.

`Repeat Regularly` uses the source task's `Due` as its start and maintains occurrences
after the current Eastern day through six calendar months in the future. Those
occurrences are locked and related to the source through `Repeat Of`. Editing the rule
reconciles the future set by creating, rescheduling, synchronizing, or archiving pages.
