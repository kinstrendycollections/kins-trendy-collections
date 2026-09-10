import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {schemaTypes} from './schemaTypes'

// IMPORTANT: replace 'REPLACE_WITH_YOUR_PROJECT_ID' below with the real
// Project ID you get after creating a free account at sanity.io
export default defineConfig({
  name: 'default',
  title: 'Kins Trendy Collections',

  projectId: 'REPLACE_WITH_YOUR_PROJECT_ID',
  dataset: 'production',

  plugins: [structureTool()],

  schema: {
    types: schemaTypes,
  },
})
