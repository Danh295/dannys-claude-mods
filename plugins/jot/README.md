# jot

A notes pane for Claude Code. Jot text down during a session, keep it across sessions, and paste a note into the prompt without leaving the keyboard.

## Getting in and out

- `/notes` opens the pane with the keyboard (from an empty prompt).
- **ctrl+x tab** moves the keyboard into the pane, even when the prompt has text in it.
- The pane's top line says where your keys are: **● keys here**, or **○ ctrl+x tab or /notes to use**.
- Pasting a note returns the keyboard to the prompt by itself. **q** also goes back. You never need Esc (an Esc at the prompt stops a running reply).

## Keys

| Key | Does |
| --- | --- |
| ↑ ↓ | Move between notes |
| Enter | Paste the selected note at the cursor |
| 1–9 | Paste note 1 to 9 |
| e | Edit the selected note |
| p | Pin it to the top, or unpin it |
| d | Delete it (u undoes) |
| u | Bring back the last deleted note |
| c | Copy it to the clipboard |
| r | Replace the whole prompt with it |
| a | Write a new note |
| g | Save the mouse selection as a note (fullscreen) |
| l | Save your last prompt as a note |
| q | Back to the prompt |
| k | Show or hide the key list |

The selected note opens to show the rest of its text, rendered as Markdown.

## Commands

- `/notes`: open the pane. `/notes 3` pastes note 3 without opening it.
- `/note <text>`: save a note. `/note` on its own saves the mouse selection.

Notes are kept in the plugin store, so they survive restarts and are shared by open sessions.
