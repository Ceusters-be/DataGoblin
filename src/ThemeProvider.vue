<script setup lang="ts">
import { provideTheme } from './theme';
import { provideEditorPreferences } from './editorPreferences';
provideTheme();
provideEditorPreferences();
</script>

<template>
  <slot />
</template>
