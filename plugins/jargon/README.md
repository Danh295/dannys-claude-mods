# jargon

Highlights jargon in Claude's replies and explains it in plain English.

After a reply, jargon asks Haiku which of its terms a newcomer might not know. Those terms are linked in the reply (`idempotent ⓘ`) and listed under it.

- **Hover** a term in the list to see its definition card.
- **Click** a term (or its link) to pin the card above the prompt. **x** dismisses it.

## Commands

- `/jargon`: list the terms defined so far.
- `/jargon off` and `/jargon on`: turn the highlights off or on.

## Cost and storage

Each reply with words Haiku hasn't seen before costs one small Haiku call. Replies made only of words it has already read are skipped, and known terms still highlight from the cache. The glossary and the words already read are kept in `~/.claude/jargon/cache.json`.
