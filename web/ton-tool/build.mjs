// Bundles src/main.js (TON SDK + TON Connect + jetton deploy logic) into a single
// browser IIFE at ../public/ice-ton.js, exposing window.IceTon. Run: npm run build
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/entry.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  inject: ['./shim.js'],
  outfile: '../public/ice-ton.js',
  legalComments: 'none',
  logLevel: 'info',
});
console.log('Built ../public/ice-ton.js');
