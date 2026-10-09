# Danny's Claude Mods

Mods for [Claude Code](https://claude.com/claude-code): small plugins that add panes, highlights and commands to the terminal UI. This repo is a plugin marketplace, so you can install either mod straight from it.

| Mod | What it does |
| --- | --- |
| [jot](plugins/jot) | A notes pane. Jot things down during a session, keep them across sessions, and paste one into the prompt with a keystroke. |
| [jargon](plugins/jargon) | Highlights jargon in Claude's replies: about 190 built-in terms filtered by your level, and `/jargon <term>` for any other. Hover a term for a plain-English definition; click it to pin the card above the prompt. |

## Install

Inside Claude Code:

```
/plugin marketplace add Danh295/dannys-claude-mods
/plugin install jot@dannys-claude-mods
/plugin install jargon@dannys-claude-mods
```

Then run `/reload-plugins` or restart.

## Layout

```
.claude-plugin/marketplace.json   the marketplace: lists each mod and where it lives
plugins/<mod>/
  .claude-plugin/plugin.json      the mod's manifest
  hooks/register.tsx              everything that talks to Claude Code
  hooks/*.ts(x)                   pure logic and drawing, tested on their own
  types/index.d.ts                the mod's state contract
```

Each mod is self-contained: nothing is shared between them. Claude Code only follows its engine handle (`$`) within a mod's own `register.tsx`, so each `register.tsx` holds the engine-facing code and hands the rest to pure modules.

## Develop

```sh
claude --plugin-dir plugins/jot       # run a mod from this checkout
claude plugin test plugins/jot        # its tests
claude plugin validate plugins/jot    # what the engine would refuse
```

Opening a mod with `--plugin-dir` writes its API typings to `plugins/<mod>/.claude-plugin/types/` (git-ignored); after that, `npx -p typescript tsc -p plugins/<mod> --noEmit` type-checks it.

## License

[MIT](LICENSE)
