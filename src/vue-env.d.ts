import 'vue';
declare module 'vue' {
  interface HTMLAttributes { onKeydownCapture?: (event: KeyboardEvent) => void }
}
