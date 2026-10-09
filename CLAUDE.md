# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A plugin marketplace of Claude Code mods (`jot`, `jargon`), each a self-contained plugin under `plugins/<mod>/` built from function hooks. Load the `plugin-authoring` skill before writing or debugging a hooks module. Install steps, layout and dev commands are in `README.md`.

## Commands

```sh
claude --plugin-dir plugins/jot       # run a mod from this checkout
claude plugin test plugins/jot        # all of a mod's tests
claude plugin validate plugins/jot    # lists the $ calls and state reads/writes the engine sees
```

- `claude plugin test` takes a mod's root folder and runs every `*.test.ts(x)` under it. Its unit is the mod: a subfolder fails with "no hooks module to load", and it has no per-test filter.
- Type-checking (`npx -p typescript tsc -p plugins/<mod> --noEmit`) needs one `--plugin-dir` launch first: each `tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which that launch generates (git-ignored). Without a launch: loading the `plugin-authoring` skill writes `types/claude-code.d.ts` in its folder, whose header gives a tsconfig; put one in a scratch folder with `include` naming that file plus the mod's `hooks`, `types` and `tests`.
- Releasing a version means bumping it in both `plugins/<mod>/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.

## How a mod is built

- **`register.tsx` is the engine boundary.** The engine follows `$` and atom references only within the module's own file, so every function that takes `$` and every `atom(...)` lives in `hooks/register.tsx`. Everything else (`notes.ts`, `view.tsx`, `text.ts`, `card.tsx`, `cache.ts`, `glossary.ts`, `bundled.ts`) is pure logic or drawing that takes plain values and callbacks, and is tested directly.
- **State contract:** `types/index.d.ts` augments `PluginState` in `'claude-code'`; each atom's `{ plugin, key }` must match a field there. Every `read`/`update` names its atom at the call: the engine refuses to load a module that passes an atom through a generic helper.
- **Render hooks cannot write state.** Facts learned while drawing (jot's `reachable`, `windowStart`, `lastModel`; jargon's `transcriptColumns`, `recent`) live in module-level variables in `register.tsx`. A hot reload resets those but keeps atoms, so code treats them as rebuildable on the next render or `session.start`.
- Mod typings declare no DOM or Node globals; a test that needs timers declares them (`declare const setTimeout`).

## Persistence

- **jot** keeps notes in `$.store`, shared by every open session. `saveNotes` re-reads the store and applies a change function to that, so a note another session saved is never overwritten. Route every list write through it.
- **jargon** highlights what `visibleTerms` builds: the bundled terms the reader's `level` shows (`hooks/bundled.ts`) and every slug in `lookedUp` (bundled or in the `glossary` atom). Glossary entries never looked up (0.1.x auto-picks) stay hidden but answer a lookup for free. The matcher and memos key on `termsVersion`, bumped after each write to `glossary`, `lookedUp` or `level`. Haiku (`$.model.complete`) runs only for `/jargon <term>` on a term in none of them, and its definition is stored under the person's own spelling. Only Haiku's definitions and the `lookedUp` slugs go in the atoms and in jargon's own file, `~/.claude/jargon/cache.json` (with a `$.store` copy as backup in case the file breaks). Bundled entries never do; `session.start` prunes those that 0.1.x auto-picked. `save()` merges with the file as it is now (`merge` in `hooks/glossary.ts`, falling back to the `$.store` copy) so side-by-side sessions keep each other's lookups. Terms match only in a reply's prose (`proseOf`), never in its code.

## Tests

Tests import from `claude-code/testing` and fake the engine by handling its events (`store.get`/`set`, `ui.open`, `prompt.fill`, `model.complete`, …); a fake the kit skips with "returned neither { value } nor { deny }" must wrap its result in `{ value }`. A test takes one hook per event ("registered twice" otherwise), so one that inspects `store.set` writes its own store in place of `mock.store`. See `world()` in `plugins/jot/hooks/register.test.ts`. Engine-facing tests loop over both surfaces, `terminal` and `desktop`. jot's tests sit beside its modules in `hooks/`; jargon's are in `tests/`.

## jot: adding a pane key

A key is one entry in `KEYS` (`hooks/keys.ts`; `scope` decides whether it needs a selected note), a branch in `runAction` in `register.tsx` (pane-scope keys go before its "No note to act on" guard), and a row in the README's key table. `view.tsx` draws the key rows and help list from `KEYS`.
