---
name: jev-explorer
description: Delegate browser work to the Jev Explorer MCP server instead of reading web pages yourself. Use when a task needs a website visited, searched, filled in or read, and the answer must come with the exact source text. Covers the four tools (browse, inspect, act, close), what to send, what the five statuses mean, and how to carry on a session.
---

# Jev Explorer

## What it is for

A website page is large. Reading it yourself fills your context with markup and
link lists. This server browses in its own process, with a small model, and
returns a short report: the findings, the exact text that proves them, and a
browser that stays open.

Use it when the task is "go to this site and find out X", or "fill this form".

Do not use it for a page you can read once with a simple fetch.

## The four tools

| Tool | Use it to |
| --- | --- |
| `browse` | Send a goal. Send it again with the same `sessionId` to carry on. |
| `inspect` | Look at the live page without spending a model call. |
| `act` | Do one step yourself, with a control reference from `inspect`. |
| `close` | End the session. The evidence files stay on disk. |

## Sending a goal

```json
{
  "url": "https://example.com",
  "goal": "Find the workshop telephone number of this company.",
  "questions": [{ "key": "phone", "question": "What is the workshop telephone number?" }],
  "values": { "destination": "Tromso" },
  "allowCommit": false,
  "maxSteps": 25
}
```

Rules that matter:

- **Write the goal as a short journey**, not one word. "Search the city and the
  dates, then open one property so its scores can be read" works better than
  "find a hotel".
- **Ask questions whose answers you do not know.** Each answer comes back as a
  block of text copied from the page, with its address. The model never writes
  an answer, so you can trust the quote.
- **Send every value the site must receive** under `values`. The model cannot
  invent text. A search term, a name, a city: all of these are values. Dates go
  in as `2026-09-23`.
- **Leave `allowCommit` false** unless the user asked for something to be saved,
  sent, bought, booked or deleted.
- Add `"headed": true` when a site refuses a hidden browser. It often helps.

## Reading the answer

Every reply carries a `status`. Each one tells you exactly what to do next.

| Status | Do this |
| --- | --- |
| `answered` | Read `findings`. Each one has the source text and its address. |
| `needs_value` | `need` names the missing field. Call `browse` again with the same `sessionId` and the value. |
| `needs_decision` | Either a step acts outside the page and waits for permission, or the run is stuck. Use `inspect` to look. |
| `blocked` | A sign-in, a challenge or a failure. A person must step in. |
| `spent` | The budget ran out. Raise `maxSteps` and `maxMessages`, or narrow the goal. |

## Carrying on

The browser stays open between calls. To continue, send `browse` with the same
`sessionId`. Keep the same `goal` text, or the session starts over.

```json
{ "sessionId": "...", "goal": "<the same goal>", "values": { "postcode": "20121" } }
```

After a step that may have changed something outside the page, the session stops
and waits. Look at the page first, then answer:

```json
{ "sessionId": "...", "goal": "<the same goal>", "confirm": "done" }
```

Use `"not_done"` when the page shows it did not happen. Never guess, and never
repeat the step blindly.

## Taking over

When the session is stuck, do it yourself:

1. `inspect` with `"controls": true` gives a list of references. Page with `offset`.
2. `act` with a `ref`, and `text` when the control takes typing.
3. `browse` again with the same `sessionId` to hand the goal back.

Add `"screenshot": true` to `inspect` only when you need to see the page.

## What it cannot do

- It cannot type anything you did not supply. There is no free text from the model.
- It decides from what is on screen, and scrolls to see the rest. A control far
  down the page needs a scroll first.
- Its choices are not repeatable. The same goal can take a different path twice.
- A site that challenges robots can stop it. The report says `blocked`.

## Closing

Call `close` when the task is done. The trace, the last page and the screenshot
stay on disk, and the report gives their paths.
