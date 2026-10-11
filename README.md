# claude-mods

A collection of small mods for [Claude Code](https://claude.com/claude-code): changes to its own interface, built with the function-hooks plugin API.

Each mod lives in its own folder and installs on its own.

## Mods

| Mod | What it does |
| --- | --- |
| [**pulse**](./pulse) | A slim live banner above the prompt: context-window donut, usage-limit donuts with reset times, token mix, growth forecast and compaction alerts. |

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

A banner that makes context and usage easy to read at a glance.

- **Context donut**: a gradient ring with the % in the middle. Its colour slides continuously from green through amber to red as the window fills, and it ripples while Claude is working.
- **Usage-limit donuts**: one each for your 5-hour and weekly windows, in the same style, with `resets in 2h 14m` and the clock time it resets.
- **Token mix**: session tokens split into cache reads, cache writes, fresh input and output, plus a cache hit rate.
- **Growth and forecast**: `+3.1k last turn · ≈12 turns left`.
- **Context trend**: a small chart of the fill turn by turn, so compactions show up as drops.
- **Compact button**: appears once context passes 75%.
- **Alerts**: a toast as context crosses 70%, 85% and 95%, each once.

It shows percentages only, with no dollar amounts. Usage-limit donuts need a subscription plan; on API billing you get the context donut alone.

**Commands**

| Command | Effect |
| --- | --- |
| `/pulse` | Cycle full → mini → off |
| `/pulse full` · `mini` · `off` | Set the mode directly |
| `/pulse reset` | Zero the session counters |

Your chosen mode is remembered across sessions.

**Does it cost tokens?** No. It reads usage figures the engine already measures and draws them locally. It sends nothing to the model and adds nothing to your context. The one exception is the Compact button, which runs the same compaction as `/compact` and only when you press it.

**Where it draws**: the desktop and mobile surfaces get the SVG donuts. The terminal gets a compact text version using pie glyphs (`◔ ◑ ◕`) and bars.

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
