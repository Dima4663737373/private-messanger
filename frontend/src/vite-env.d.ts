/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALEO_EXPLORER_API_BASE?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_PINATA_JWT?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
