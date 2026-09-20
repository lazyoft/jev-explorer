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

1. **Four question shapes.** Next action, effect of the chosen action, field
   binding, answer source. They live in `src/jev/questions.ts`. A fifth shape
   must be argued for, not added quietly. A question about a named website
   feature, such as a calendar, forces a question for every feature on earth.
2. **Two messages for each step.** One to choose the action, one small one to
   check what that action does. A test asserts the count and fails if it grows.
3. **The model never writes text.** Every value typed into a page comes from the
   caller. Every finding is a block of text copied from the page, word for word.
4. **The model never supplies a selector**, and no tool runs code on a page.
5. **An action that acts outside the page** runs only with `allowCommit`, and the
   run then stops and waits for the caller to confirm what happened. Nothing is
   ever repeated automatically after such an action.
6. **The effect question asks about the chosen action only.** Never about the
   options that were not chosen.

## Things learned from live websites

Every one of these came from a real run, not from reading the code.

- Offer the model only click, scroll, back and close-tab. A chosen "type" has no
  text behind it and empties the field.
- Jev accepts at most 255 choices in one question. Slices must leave room for
  their own paging options.
- Offer only what is on screen. A page with 235 controls gives answers near
  0.25 confidence, which is a coin flip.
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
npm run build      # the MCP server runs the built code, so build after a change
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
- `~/.claude/skills/jev-explorer` is a link to `skills/jev-explorer`.

## Known limits

- The decisions are not repeatable. The same goal can take a different path twice.
- No code handles calendars, autocomplete lists or any other named widget. Their
  controls simply appear in the option list. This is deliberate, and less reliable.
- A site that challenges robots stops the run, and the report says `blocked`.
