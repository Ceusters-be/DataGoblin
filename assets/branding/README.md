# DataGoblin — Goblin Stack (A)

Selected identity: a green database cap with integrated goblin ears, above two slate database layers without outlines. Transparent background, flat shapes, and open gaps keep the mark readable at small sizes.

- `../../public/goblin.svg`: app header and browser favicon.
- `app-icon.svg`: canonical desktop icon source.
- `../../icon.svg`: matching root icon.
- `../../src-tauri/icons/`: generated platform icons.

Colors: green `#22C55E`, shared slate base `#64748B`. GitGoblin uses blue horns with the same slate base.

Regenerate platform icons from the project root:

```sh
npm exec -- tauri icon assets/branding/app-icon.svg --output src-tauri/icons
```

The older `slate-icon.png` and `../../public/slate.png` are retained as historical artwork; the app uses Goblin Stack.