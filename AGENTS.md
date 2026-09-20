# Notes for an agent working on this repository

## The one rule

**The code reads. Jev chooses.**

Jev picks one option from a list and returns a confidence value. It cannot plan,
and it cannot write text. So the code reads the page and builds the list, and Jev
points at one item. Every design question in this repository is settled by that
sentence.

## What is where

```
src/start_browsing.ts   the browse tool with a goal
src/open_browser.ts     the browse tool without a goal, for a manual sign-in
src/inspect_session.ts  look at the live page, no model call
src/act_in_session.ts   one step taken by the caller
src/close_session.ts    end the session
src/explore_loop.ts     the step loop
src/browser/            read the page, perform one action
src/jev/questions.ts    the four question shapes, and nowhere else
src/jev/client.ts       one request to the model
src/domain/             session, errors, report, trace
src/mcp/                tool schemas and the stdio entry point
skills/jev-explorer/    the skill that teaches an agent to use the tools
```

## Rules that must not be broken

1. **Three question shapes.** Next action, field binding, answer source. They
   live in `src/jev/questions.ts`. A fourth shape must be argued for, not added
   quietly. A question about a named website feature, such as a calendar, forces
   a question for every feature on earth.
2. **One message for each step.** The question that chooses the action, and
   nothing else. A test asserts the count and fails if it grows.
3. **The model never writes text.** Every value typed into a page comes from the
   caller. Every finding is a block of text copied from the page, word for word.
4. **The model never supplies a selector**, and no tool runs code on a page.
5. **Nothing stands between the run and a button.** There is no brake. A run
   clicks whatever moves toward the goal, including save, send, buy, book and
   delete. The caller carries that risk and must write a goal that stops short of
   those. This was weighed and chosen: the check cost a model call on every step
   and called a cookie button a purchase.
6. **Build, then reconnect the server, every time.** The MCP server reads the
   built code into memory when it starts and keeps that copy until it stops. A
   rebuild never reaches a server that is already running, so the tools go on
   using the old code and a finished fix looks as if it failed. This has already
   cost a whole debugging session twice. Reconnecting is not enough on its own:
   a reconnect to a server that is still alive reattaches to the same process,
   which still holds the old code. Only a dead process is replaced. So after a
   change: `npm run build`, then kill the server process, then `/mcp reconnect
   all`. Check the result. The new process must be younger than the files in
   `dist`, and while it is down the four tools disappear from the session. The
   same trap catches the editor: the TypeScript server also holds an old view of
   the files, so trust `npx tsc --noEmit` over the red marks on screen.

## Things learned from live websites

Every one of these came from a real run, not from reading the code.

- Offer the model only click, scroll, back and close-tab. A chosen "type" has no
  text behind it and empties the field.
- Jev accepts at most 255 choices in one question. Slices must leave room for
  their own paging options.
- Offer only what is on screen. A page with 235 controls gives answers near
  0.25 confidence, which is a coin flip.
- Read only what is on screen, and cut to the budget last. Collect every on-screen
  element, order them by z-order with the top-most first, then cut. A cookie banner
  is the last thing in the page: on repubblica.it it is control 468 of 474, so a
  budget spent in document order never reaches it.
- Share the budget across frames after the merge, never frame by frame. A main page
  that fills the budget leaves nothing for the iframe that holds the banner, as on
  theguardian.com. The z-order of the iframe element itself decides where its
  content lands in the merged list.
- A give-up answer below 0.5 confidence is asked once more before it is believed.
- Check the answers on arrival at each new page. If you only check when the model
  gives up, it scrolls a long page until the budget is gone.
- Follow a tab opened by a link, and offer to close it. A new tab has no history,
  so the go-back option never appears there.
- A control that vanished before the click was never clicked, so read the page
  and try again.
- Judge readiness on real page content, not on the paging options the code adds.
- Set the browser locale. Otherwise a site picks the language from the machine.
- Some sites serve nothing useful to a hidden browser. `headed: true` helps.

## Working on it

```sh
npm run check      # build, then the twelve local tests. No key, no cost.
npm run build      # then reconnect the server with /mcp, or it keeps the old code
npm run test:live  # the real model against the local pages. Needs TYPESAFE_API_KEY.
```

Local tests use pages in `test/pages` and a scripted decider in `test/helpers.mjs`
that chooses by a written rule. Every path in the loop is testable with no key.

A live run against a real website costs money and gets rate limited. Space the
runs out, and read `trace.jsonl` in the session folder before running again.

## How it is installed on this machine

- The server is registered with Claude Code at user scope, running
  `node --env-file-if-exists=<repo>/.env <repo>/dist/mcp/main.js`.
- The API key is in `.env` in this folder. Git ignores it.
- A `pre-commit` hook runs `npm run build`, so a commit never leaves `dist`
  behind the source. The hook cannot reconnect the running server. Only `/mcp` does.
- `~/.claude/skills/jev-explorer` is a link to `skills/jev-explorer`.

## Known limits

- The decisions are not repeatable. The same goal can take a different path twice.
- No code handles calendars, autocomplete lists or any other named widget. Their
  controls simply appear in the option list. This is deliberate, and less reliable.
- A site that challenges robots stops the run, and the report says `blocked`.
