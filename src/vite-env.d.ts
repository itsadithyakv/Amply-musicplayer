/// <reference types="vite/client" />

declare module '*.svg' {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    /** Dev-only debugging hooks (see App.tsx). */
    __AMPLY_DEBUG__?: {
      getPerfSnapshot: () => unknown;
      getLibraryVersions: () => unknown;
    };
  }
}

export {};
