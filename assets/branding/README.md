# DataGoblin — Goblin Stack (A)

Selected identity: a cobalt-blue database cap with integrated goblin ears, above two charcoal database layers. Transparent background, flat shapes, and open gaps keep the mark readable at small sizes.

- `../../public/goblin.svg`: app header and browser favicon.
- `app-icon.svg`: canonical desktop icon source.
- `../../icon.svg`: matching root icon.
- `../../src-tauri/icons/`: generated platform icons.

Colors: cobalt `#0647F7`, charcoal `#272C35`.

Regenerate platform icons from the project root:

```sh
npm exec -- tauri icon assets/branding/app-icon.svg --output src-tauri/icons
```

The older `slate-icon.png` and `../../public/slate.png` are retained as historical artwork; the app uses Goblin Stack.