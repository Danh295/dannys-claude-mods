# jargon

Highlights jargon in Claude's replies and explains it in plain English.

jargon ships with about 190 common dev terms (idempotent, mutex, race condition, CORS, …). Any of them in a reply is linked (`idempotent ⓘ`) and listed under it, with no model call. For any other word, `/jargon <term>` asks Haiku once, and the term highlights from then on.

- **Hover** a term in the list to see its definition card.
- **Click** a term (or its link) to pin the card above the prompt. **x** dismisses it.

## Commands

- `/jargon <term>`: show a term's card. A term jargon doesn't know yet costs one small Haiku call, using the newest reply that mentions it for context. With highlights off, the definition is printed instead.
- `/jargon level beginner|intermediate|advanced`: how much you already know. Each built-in term is tagged basic, intermediate or advanced:
  - **beginner** highlights all of them;
  - **intermediate** (the default) skips the basic ones, like API, git and JSON;
  - **advanced** highlights only the advanced ones, like idempotent and CORS.

  Terms you looked up with `/jargon <term>` always highlight, at any level. The level is kept across sessions; `/jargon level` alone shows it.
- `/jargon`: list the terms Haiku has defined so far, and the current level.
- `/jargon off` and `/jargon on`: turn the highlights off or on.

`on`, `off`, `level` and `level <one word>` are commands, so they can't be looked up; a longer phrase such as `/jargon level of indirection` can.

Acronyms (REST, PR, CI) are only linked when written in capitals, so "the rest of the file" stays plain. Terms are only linked where they appear in prose: a name used just inside code or backticks is your own.

## Cost and storage

Highlighting costs nothing: jargon only calls Haiku when you look up a term it doesn't know. Built-in terms live in `hooks/bundled.ts`; the terms Haiku defined for you, and the ones you looked up, are kept in `~/.claude/jargon/cache.json`. Each save merges with what is already in the file, so sessions open side by side keep each other's terms.
