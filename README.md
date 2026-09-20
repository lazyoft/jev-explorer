# Jev Explorer

Give a browser goal in plain words. Get back the answer, the exact text that
proves it, and a browser that stays open.

An AI agent that browses a website spends its own memory on page text, clicks and
retries. This server does the browsing somewhere else, with a small cheap model,
and sends back only what matters.

## The one rule

**The code reads. Jev chooses.**

Jev picks one option from a list. It cannot plan, and it cannot write text. So the
code reads the page and builds the list, and Jev points at one item.

Every message to the model has the same shape:

```
state:    the goal, and short facts the code collected
question: one fixed sentence, written by hand
options:  a numbered list, built from the page
```

There are three question sentences in the whole system, and they live in one
file, `src/jev/questions.ts`:

1. Which of these options moves toward the goal?
2. Which field should receive the value named X?
3. Which of these text blocks answers this question?

Nothing else is ever asked. A question about a calendar would force a question
about every widget on earth, so there is none.

## What one step costs

One step of exploration sends one message: the question that chooses the action.

A test asserts this. If a change makes a step cost two messages, the test fails.

## Findings

The model never writes the answer. It points at a block of text on the page, and
the code copies that block word for word, with the page address. That is why the
evidence can be trusted.

## Safety

- Nothing stops a click. The run presses whatever moves toward the goal,
  including save, send, buy, book and delete. The goal is the only brake, so
  write one that stops before the button you do not want pressed.
- The model never supplies a selector, and no tool runs code on the page.
- Values whose name looks like a password or a token are removed from the trace.

The model's judgement is evidence, not a security boundary. The boundary is the
tool contract.

## Install

Node 24 or later.

```sh
npm install
npx playwright install chromium
npm run build
cp .env.example .env
```

Put your key in `.env` as `TYPESAFE_API_KEY`.

## Connect it

```json
{
  "mcpServers": {
    "jev-explorer": {
      "command": "node",
      "args": ["/absolute/path/to/jev-explorer/dist/mcp/main.js"],
      "env": { "TYPESAFE_API_KEY": "..." }
    }
  }
}
```

## The four tools

| Tool | What it does |
| --- | --- |
| `browse` | Send a goal, questions and values. Send the same `sessionId` again to carry on. Send a url with no goal to open a browser for a manual sign-in. |
| `inspect` | Look at the live page. This never calls the model. |
| `act` | Do one step yourself, using a control reference from `inspect`. |
| `close` | Close the browser. The evidence files stay on disk. |

## What comes back

Every call returns the same short report: a status, what is needed next, the
findings with their source text, the last few steps, how much was used, and the
paths to the evidence on disk. The page itself never goes back to the caller.

The status is one of five, and each one says what to do:

| Status | What to do |
| --- | --- |
| `answered` | Read the findings. |
| `needs_value` | Send the missing value. |
| `needs_decision` | Take over: no offered step moves toward the goal. |
| `blocked` | Sign in, solve a challenge, or give up. |
| `spent` | Raise the budget, or narrow the goal. |

## The skill

`skills/jev-explorer/SKILL.md` teaches an agent how to use these four tools:
what to send, what the five statuses mean, and how to carry a session on.

Link it into your own skills folder:

```sh
ln -s "$PWD/skills/jev-explorer" ~/.claude/skills/jev-explorer
```

## Tests

```sh
npm test          # local pages, scripted answers, no key and no cost
npm run test:live # the real model against the same local pages
```

## What this does not do

- It does not handle calendars, autocomplete lists or any other named widget with
  its own code. A popup adds its items to the option list, and the same question
  picks one. This is simpler, and less reliable, on purpose.
- It does not promise to finish any workflow on any website.
- It does not measure itself against other browser agents.

## Licence

Apache-2.0.
