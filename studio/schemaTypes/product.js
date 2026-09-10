import {defineField, defineType} from 'sanity'

export default defineType({
  name: 'product',
  title: 'Product',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Product Name',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'URL Slug',
      type: 'slug',
      description: 'Auto-generated from the name. This becomes part of the product web address.',
      options: {source: 'name', maxLength: 96},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'string',
      options: {
        list: [
          {title: 'Utensils', value: 'utensils'},
          {title: 'Clothes', value: 'clothes'},
          {title: 'Shoes', value: 'shoes'},
          {title: 'Electricals', value: 'electricals'},
          {title: 'Hardware', value: 'hardware'},
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'price',
      title: 'Price (KES)',
      type: 'number',
      validation: (Rule) => Rule.required().positive(),
    }),
    defineField({
      name: 'compareAtPrice',
      title: 'Original Price (optional, for showing a discount)',
      type: 'number',
    }),
    defineField({
      name: 'images',
      title: 'Photos',
      type: 'array',
      of: [{type: 'image', options: {hotspot: true}}],
      validation: (Rule) => Rule.required().min(1),
    }),
    defineField({
      name: 'shortDescription',
      title: 'Short Description',
      description: 'One sentence, used in SEO snippets.',
      type: 'string',
    }),
    defineField({
      name: 'description',
      title: 'Full Description',
      type: 'text',
    }),
    defineField({
      name: 'sku',
      title: 'SKU (product code)',
      type: 'string',
    }),
    defineField({
      name: 'inStock',
      title: 'In Stock?',
      type: 'boolean',
      initialValue: true,
    }),
  ],
  preview: {
    select: {title: 'name', subtitle: 'category', media: 'images.0'},
  },
})
