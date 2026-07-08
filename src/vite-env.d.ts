/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TILES_URL?: string;
  readonly VITE_STUDIO_LEGACY_LOGIN_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
