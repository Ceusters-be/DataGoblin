# DataGoblin logo C

Selected direction: database cylinder with goblin ears.

- `../../public/goblin.svg`: transparent vector mark used in the app header and favicon.
- `app-icon.svg`: charcoal rounded-square app icon with the same teal mark.
- `../../src-tauri/icons/`: generated platform icons.

Regenerate from the project root with:

```sh
npx tauri icon assets/branding/app-icon.svg --output src-tauri/icons
```

The SVG is a clean vector recreation of the selected concept, suited to small UI sizes. Colors: teal `#00A883`, charcoal `#202426`.


## Slate icon

Active source: `slate-icon.png`, the selected refined stacked-slate concept A,
generated with the built-in image generation tool. Three isometric slabs (blue,
slate grey, charcoal), tighter vertical spacing, reduced margins, transparent
background. Original generated file retained separately.

Regenerate platform icons: `npm exec -- tauri icon assets/branding/slate-icon.png --output src-tauri/icons`.
The UI and favicon use `public/slate.png`. The application identifier, credential
service and saved preference keys retain their previous values for compatibility.
