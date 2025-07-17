#!/usr/bin/env bun

/**
 * Build script for html-to-markdown package
 * Creates optimized builds for different environments
 */

import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = join(import.meta.dir, '..');
const distDir = join(rootDir, 'dist');

// Clean dist directory
console.log('🧹 Cleaning dist directory...');
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(distDir, { recursive: true });

// Build configurations
const builds = [
  {
    name: 'Universal (ESM)',
    entryPoint: './src/index.ts',
    outfile: './dist/index.js',
  },
];

// Build each target
for (const config of builds) {
  console.log(`\n📦 Building ${config.name}...`);

  const startTime = performance.now();

  try {
    // Use Bun.build API
    // Determine target based on entry point
    const target = config.entryPoint.includes('worker.ts') ? 'browser' : 'browser';

    const result = await Bun.build({
      entrypoints: [config.entryPoint],
      format: 'esm',
      target,
      minify: true,
      sourcemap: 'external',
      splitting: false,
      external: [],
    });

    if (!result.success) {
      throw new Error(result.logs.join('\n'));
    }

    // Write the output to the specific file
    if (result.outputs && result.outputs.length > 0) {
      const output = result.outputs[0];
      if (output) {
        await Bun.write(config.outfile, output);
      }
    }

    const buildTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Built in ${buildTime}s`);

    // Get file size
    if (existsSync(config.outfile)) {
      const stats = await Bun.file(config.outfile).stat();
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(`   Output: ${config.outfile} (${sizeKB} KB)`);
    }
  } catch (error) {
    console.error(`❌ Failed to build ${config.name}`);
    console.error(error);
    process.exit(1);
  }
}

// Generate TypeScript declarations
console.log('\n📝 Generating TypeScript declarations...');
const tscStart = performance.now();

try {
  // Use the existing tsconfig.build.json configuration
  const proc = Bun.spawn(['bunx', 'tsc', '-p', 'tsconfig.build.json'], {
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const success = (await proc.exited) === 0;

  if (!success) {
    const stderr = await new Response(proc.stderr).text();
    console.error('TypeScript errors:', stderr);
  }

  const tscTime = ((performance.now() - tscStart) / 1000).toFixed(2);
  console.log(`✅ Generated declarations in ${tscTime}s`);
} catch (error) {
  console.error('⚠️  Failed to generate TypeScript declarations');
  console.error('Error:', error);
  console.error('Continuing without declarations...');
}

// Move declaration files to match the bundle structure
console.log('\n📂 Organizing files...');

// Helper to copy declaration files
async function copyDeclarations(from: string, to: string) {
  if (existsSync(from)) {
    const content = await Bun.file(from).text();
    await Bun.write(to, content);

    // Copy source map too if it exists
    const mapFrom = from + '.map';
    const mapTo = to + '.map';
    if (existsSync(mapFrom)) {
      const mapContent = await Bun.file(mapFrom).text();
      await Bun.write(mapTo, mapContent);
    }
  }
}

// Copy main declarations if they exist
const srcDist = join(distDir, 'src');
if (existsSync(srcDist)) {
  await copyDeclarations(join(srcDist, 'index.d.ts'), join(distDir, 'index.d.ts'));

  // Preserve specific subdirectory declarations
  const declarationsToPreserve = [
    { from: 'browser/index.d.ts', to: 'browser/index.d.ts' },
    { from: 'server/index.d.ts', to: 'server/index.d.ts' },
    { from: 'types/index.d.ts', to: 'types/index.d.ts' },
  ];

  for (const { from, to } of declarationsToPreserve) {
    const fromPath = join(srcDist, from);
    const toPath = join(distDir, to);

    if (existsSync(fromPath)) {
      const toDir = join(distDir, to.split('/')[0]!);
      if (!existsSync(toDir)) {
        mkdirSync(toDir, { recursive: true });
      }
      await copyDeclarations(fromPath, toPath);
    }
  }

  // Clean up src directory
  rmSync(srcDist, { recursive: true, force: true });
}

// Create a simple package.json for the dist folder
const distPackageJson = {
  name: 'html-to-markdown',
  type: 'module',
  sideEffects: false,
};

await Bun.write(join(distDir, 'package.json'), JSON.stringify(distPackageJson, null, 2));

// Summary
console.log('\n✨ Build complete!');
console.log('\n📊 Build Summary:');

// Count files
const jsFiles: string[] = [];
const dtsFiles: string[] = [];

async function scanDir(dir: string) {
  const fs = await import('node:fs');
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDir(fullPath);
    } else if (entry.name.endsWith('.js')) {
      jsFiles.push(fullPath);
    } else if (entry.name.endsWith('.d.ts')) {
      dtsFiles.push(fullPath);
    }
  }
}

await scanDir(distDir);

console.log(`  JavaScript bundles: ${jsFiles.length}`);
console.log(`  TypeScript declarations: ${dtsFiles.length}`);

// Calculate total size
let totalSize = 0;
for (const file of jsFiles) {
  const stats = await Bun.file(file).stat();
  totalSize += stats.size;
}

console.log(`  Total bundle size: ${(totalSize / 1024).toFixed(2)} KB`);

// Verify exports
console.log('\n🔍 Verifying package exports...');
const pkg = await Bun.file(join(rootDir, 'package.json')).json();

type ExportConfig = {
  import?: string;
  require?: string;
  types?: string;
};

for (const [exportPath, exportConfig] of Object.entries(
  pkg.exports as Record<string, ExportConfig | string>,
)) {
  if (exportPath === './package.json') continue;

  const config = exportConfig as ExportConfig;
  if (config.import) {
    const exists = existsSync(join(rootDir, config.import));
    console.log(`  ${exportPath}: ${exists ? '✅' : '❌'} ${config.import}`);
  }
}
