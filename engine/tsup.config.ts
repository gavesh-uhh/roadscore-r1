import { defineConfig } from 'tsup';

/**
 * ENGINE-PLAN §5 stack: "tsup (esbuild) → single bundle, distroless image".
 *
 * The CLI entrypoints ship alongside the server so the deployed image can run a
 * replay or a capture without a second build (§10).
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'replay/cli': 'src/replay/cli.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  // Keep the stack traces readable in production logs; the size win is not worth
  // debugging a minified detector at 3 a.m.
  treeshake: true,
  dts: false,
  // pg and the Supabase client both do dynamic requires that do not survive
  // bundling cleanly, so they stay external and are installed in the image.
  external: ['postgres', '@supabase/supabase-js'],
  banner: {
    js: '// roadscore-engine — see ENGINE-PLAN.md',
  },
});
