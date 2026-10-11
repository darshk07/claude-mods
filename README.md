# claude-mods

A collection of small mods for [Claude Code](https://claude.com/claude-code): changes to its own interface, built with the function-hooks plugin API.

Each mod lives in its own folder and installs on its own.

## Mods

| Mod | What it does |
| --- | --- |
| [**pulse**](./pulse) | A quiet banner above the prompt: rings for context, 5-hour and weekly usage, with reset times and compaction alerts. |
| [**diet**](./diet) | Trims huge tool outputs (build logs, long test runs, big fetches) before they reach the context, saves the full text to disk, and shows tokens saved in a panel. |
| [**anchor**](./anchor) | Pin facts, decisions and rules that ride the system prompt every turn, so `/compact` can never lose them. Per-project pinboard panel. |

## Install

In a terminal Claude Code session:

```
/plugin install pulse --marketplace darshk07/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope keeps it active in every session). The mod is active right away, with no reload.

> Mods draw through Claude Code's UI hooks, so install from a terminal session. The desktop app's Code tab doesn't run `/plugin install`, but a mod installed at user scope from a terminal loads there too.

To try a mod straight from a checkout without installing:

```
claude --plugin-dir ./pulse
```

## pulse

A quiet banner above the prompt with up to three rings: **Context**, **5-hour** and **Weekly**.

- Each ring shows its percentage in the middle, with one line beneath the name: tokens used (`124k of 200k`) or time to reset (`resets in 2h 14m`).
- The colour slides from green through amber to red as a ring fills. The name, the number and the ring always share one colour.
- The context ring ripples while Claude is working. Hover a ring for details, such as roughly how many turns are left at the current pace.
- A **Compact** button appears once context passes 75%, and a toast fires as it crosses 70%, 85% and 95%.
- `–` collapses the banner to a single line; `+` expands it again.

Usage-limit rings need a subscription plan; on API billing you see the context ring alone. No dollar amounts are shown.

| Command | Effect |
| --- | --- |
| `/pulse` | Cycle full → mini → off |
| `/pulse full` · `mini` · `off` | Set the mode directly |

Your chosen mode is remembered across sessions.

**Does it cost tokens?** No. It reads usage figures the engine already measures and draws them locally. The one exception is the Compact button, which runs the same compaction as `/compact` and only when you press it.

## diet

Big tool results are the fastest way to fill a context window. Diet watches Bash, Grep, WebFetch, WebSearch and MCP tool results, and when one is longer than the limit (20,000 characters by default) it keeps the head and the tail and replaces the middle with a one-line note. The full output is written to a temp file and the note says where, so Claude can grep it if it needs the middle.

File reads and edits are never trimmed, because Claude needs their text exactly.

| Command | Effect |
| --- | --- |
| `/diet` | Open the panel: tokens saved and what was trimmed |
| `/diet on` · `off` | Switch trimming on or off |
| `/diet limit <chars>` | Set the trim threshold (minimum 4,000) |

Trimming is done as the row is stored, so the model and the transcript only ever see the short version. It costs no tokens.

## anchor

`/compact` summarises the conversation, and small but important facts can fall out of the summary. Anchor keeps them outside the conversation: pinned notes are added to the system prompt on every request, so they survive compaction and carry over into new and resumed sessions of the same project.

| Command | Effect |
| --- | --- |
| `/anchor <text>` | Pin a fact, decision or rule |
| `/anchor` | Open the pinboard panel (add, remove) |
| `/anchor rm <n>` | Remove pin number n |
| `/anchor clear` | Remove all pins |
| `/anchor off` · `on` | Pause sending pins (they're kept) or resume |

Pins are stored per project folder. Each request carries them, so keep them short: the panel shows roughly how many tokens they add (a handful of short pins is a few dozen tokens).

## Turning mods off or removing them

Every mod can be switched off from inside a session, and any of them can be disabled or removed completely.

**Switch one off for now** (it stays installed; the setting is remembered):

| Mod | Off | Back on |
| --- | --- | --- |
| pulse | `/pulse off` | `/pulse full` |
| diet | `/diet off` (or **Pause** in its panel) | `/diet on` |
| anchor | `/anchor off` (or **Pause** in its panel). Pins are kept but not sent. `/anchor clear` deletes them. | `/anchor on` |

**Disable a mod** (installed but not loaded, in any session):

```
claude plugin disable pulse@claude-mods
claude plugin enable pulse@claude-mods
```

**Uninstall a mod:**

```
claude plugin uninstall pulse@claude-mods
```

You can also do both from the `/plugin` menu inside a session. Replace `pulse` with `diet` or `anchor` for the other mods.

To remove the marketplace itself once you've uninstalled its mods:

```
claude plugin marketplace remove claude-mods
```

**What's left behind:** nothing that affects Claude. Diet's saved full outputs sit in your temp folder (`claude-diet`) until your OS clears it, and you can delete that folder at any time. Uninstalling removes each mod's saved settings unless you pass `--keep-data`.

## Repository layout

```
claude-mods/
├── .claude-plugin/
│   └── marketplace.json     # makes this repo installable
├── README.md
└── <mod>/
    ├── .claude-plugin/plugin.json
    ├── hooks/
    │   ├── hooks.json
    │   └── register.tsx     # the mod itself
    ├── types/index.d.ts     # contract for the mod's saved state
    └── tests/*.test.tsx
```

## Adding a mod

1. Create `<mod-name>/` with the structure above.
2. Add an entry for it to `.claude-plugin/marketplace.json`:

   ```json
   { "name": "<mod-name>", "source": "./<mod-name>", "description": "One line." }
   ```

3. Add a row to the table at the top of this README.

## Developing

Run these from the repo root (the paths are relative to it):

```
claude plugin validate ./pulse     # manifest and hooks module
claude plugin test ./pulse         # runs tests/*.test.tsx
```

For live editing, start a session with `claude --plugin-dir ./pulse`. Edits reload when a turn ends.

The plugin API is early access and changes between Claude Code releases, so a mod may need adjusting after an update.

## License

[MIT](./LICENSE) © Darsh Kejriwal
