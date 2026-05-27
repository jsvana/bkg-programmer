import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Static export for GitHub Pages — bkg-programmer is fully client-side
  // (Web Serial, no API routes, no `use server`). `next build` writes the
  // exported site to `out/`, which gh-pages pushes to the gh-pages branch.
  output: "export",
  // GitHub Pages serves no Image Optimization endpoint; bypass the loader.
  // (No-op today since the app doesn't use next/image, but flipping output
  // to "export" requires this to be set when one is later added.)
  images: { unoptimized: true },
  // Pages requires trailing slashes on directory routes so requests like
  // /tools/ resolve to /tools/index.html. Without this, Pages 404s on
  // bare /tools.
  trailingSlash: true,
};

export default config;
