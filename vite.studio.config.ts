import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({root:resolve(import.meta.dirname,'apps/content-admin'),plugins:[react()],resolve:{dedupe:['react','react-dom']},build:{outDir:resolve(import.meta.dirname,'dist/studio'),emptyOutDir:true,rolldownOptions:{input:{studio:resolve(import.meta.dirname,'apps/content-admin/index.html'),preview:resolve(import.meta.dirname,'apps/content-admin/preview.html')}},target:['chrome111','safari16.4','firefox113']}});
