/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_ENABLE_TEMPLATE_SHELL?: string;
  readonly VITE_SYSTEM_TITLE?: string;
  readonly VITE_TEMPLATE_OVERLAY_INTERACTIVE?: string;
  readonly VITE_TEMPLATE_SHOW_LOADING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

