---
name: jev-explorer
description: Use when a website needs real interaction before the answer exists: filling a search form, choosing dates, applying filters, clicking through result pages, signing in, or reading a page that only appears once scripts run. It returns the findings with the exact text from the page, and keeps the browser open so you can add a missing value or take over. Do NOT use it when a single fetch of a known address, or an API, would answer the question: that is cheaper and faster. Tools: browse, inspect, act, close.
---

# Jev Explorer

## When to use it, and when not to

Use it when the answer does not exist until something is done on the site:

- a search form, dates or filters must be filled in,
- results must be opened one by one,
- a sign-in stands in the way,
- the page is empty until its scripts run.

Do not use it for a page whose address you already know and whose text a single
fetch returns. A browser session and its model calls cost far more than a `curl`.

Whichever you choose: never write a quotation for a page you have not opened. A
star count, a price or a review score changes after your training ended. If you
did not read it now, say where the number comes from.

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
  "maxSteps": 25
}
```

Rules that matter:

- **Write the goal as a short journey**, not one word. "Search the city and the
  dates, then open one property so its scores can be read" works better than
  "find a hotel".
- **Start every goal by getting rid of the banner.** Begin the goal text with
  "Accept any cookie banner, pop-up or overlay that covers the page, then ...".
  A banner catches the pointer, so a click on the page behind it fails. Accept
  it, do not refuse it: on many sites the refuse button leads to a paywall or a
  second panel, and the banner stays up. This is not optional and it is not only
  for sites you expect to have one. Write it even when you have never seen the
  site.
- **Ask questions whose answers you do not know.** Each answer comes back as a
  block of text copied from the page, with its address. The model never writes
  an answer, so you can trust the quote.
- **Never ask for a list, and never ask by position.** An answer is one block of
  text picked off the page, so "the first five headlines" has no block to point
  at, and the run says the page does not hold the answer while the headlines sit
  in front of it. Splitting it into "the first", "the second", "the third" fails
  too: nothing inside a block says where it sits, so the model guesses and every
  answer lands under the confidence floor and is thrown away. Both shapes come
  back empty.

  ```
  wrong   [{ "key": "titles",  "question": "What are the first five headlines?" }]
  wrong   [{ "key": "title1",  "question": "What is the first headline?" }, ...]

  right   [{ "key": "price",   "question": "What does this room cost for one night?" },
           { "key": "checkout","question": "By what time must the room be left?" }]
  ```

  A question must name one thing that the page itself names: a price, a date, a
  telephone number, a score. **For a list, ask nothing.** Write a goal that only
  reaches the page, then read the list yourself with `inspect`. That costs no
  model call and gives you every row in the order the page shows them.
- **Send every value the site must receive** under `values`, and **never write
  that value in the goal text**. The model cannot invent text, so a word that
  sits only in the goal is never typed anywhere. The run opens the search,
  presses the button on an empty field, and wanders off into whatever it finds.
  The goal names the field to fill; `values` carries what goes in it.

  ```
  wrong   "goal": "Search the site for Iran and read the first five headlines"

  right   "goal": "Search the site and read the first five headlines",
          "values": { "search": "Iran" }
  ```

  A search term, a name, a city: all of these are values. Dates go in as
  `2026-09-23`. If you find yourself typing a proper noun, a number or a date
  inside the goal, it belongs in `values` instead.
- **Nothing stops a click.** The run presses whatever moves toward the goal,
  including save, send, buy, book and delete. Write a goal that stops before the
  button you do not want pressed, for example "fill the form and stop before
  sending it". There is no confirmation step to catch it for you.
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
