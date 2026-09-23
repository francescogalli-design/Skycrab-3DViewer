import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

function copyRootAssets() {
  return {
    name: 'copy-root-asset-folder',
    buildStart() {
      const src = join(process.cwd(), 'asset');
      const dest = join(process.cwd(), 'public', 'asset');
      if (!existsSync(src)) return;
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
    },
  };
}

export default defineConfig({
    plugins: [react(), copyRootAssets()],
    resolve: {
        extensions: ['.js', '.jsx']
    },
    build: {
        assetsInlineLimit: 0,
        rollupOptions: {
            output: {
                assetFileNames: '[name].[ext]',
            },
        },
    },
    server: {
        host: '0.0.0.0',
        port: 3000,
        strictPort: true,
        open: false,
    },
});
