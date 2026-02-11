#!/usr/bin/env node
/**
 * Seed script for Flow App Store - MVP Proof of Concept
 * This creates demo apps for testing the app store
 * 
 * Usage:
 *   node scripts/seed-app-store.mjs
 */

import { createApp, getAppBySlug } from "../db.js";

const apps = [
  {
    flow_id: "demo-image-generator",
    name: "AI Image Generator (Demo)",
    slug: "ai-image-generator",
    description: "Generate creative images with AI. This demo uses a webhook trigger and returns a simulated image URL.",
    icon_url: "🎨",
    created_by: "system",
    category: "AI & Creative",
    tags: ["AI", "Image", "Creative"],
    status: "published",
    input_schema: [
      {
        name: "prompt",
        type: "textarea",
        label: "Image Prompt",
        placeholder: "Describe the image you want to generate...",
        required: true,
      },
      {
        name: "style",
        type: "select",
        label: "Art Style",
        options: ["realistic", "cartoon", "abstract", "watercolor", "oil painting"],
        required: true,
      },
      {
        name: "quality",
        type: "select",
        label: "Quality",
        options: ["standard", "high", "ultra"],
        required: false,
      },
    ],
    output_type: "image",
  },
  {
    flow_id: "demo-text-summarizer",
    name: "Smart Text Summarizer (Demo)",
    slug: "text-summarizer",
    description: "Summarize long text into concise versions. Powered by advanced natural language processing.",
    icon_url: "📝",
    created_by: "system",
    category: "Productivity",
    tags: ["Text", "Summarize", "AI"],
    status: "published",
    input_schema: [
      {
        name: "text",
        type: "textarea",
        label: "Text to Summarize",
        placeholder: "Paste the text you want to summarize...",
        required: true,
      },
      {
        name: "length",
        type: "select",
        label: "Summary Length",
        options: ["brief (1-2 sentences)", "medium (3-5 sentences)", "detailed (full paragraph)"],
        required: true,
      },
    ],
    output_type: "text",
  },
  {
    flow_id: "demo-json-formatter",
    name: "JSON Data Formatter (Demo)",
    slug: "json-formatter",
    description: "Format and validate JSON data with beautiful output.",
    icon_url: "⚙️",
    created_by: "system",
    category: "Developer Tools",
    tags: ["Developer", "JSON", "Data"],
    status: "published",
    input_schema: [
      {
        name: "json_input",
        type: "textarea",
        label: "JSON Data",
        placeholder: '{"key": "value"}',
        required: true,
      },
      {
        name: "minify",
        type: "select",
        label: "Output Format",
        options: ["pretty (indented)", "minified (compact)"],
        required: false,
      },
    ],
    output_type: "json",
  },
];

async function seed() {
  try {
    console.log("🌱 Seeding Flow App Store with demo apps...\n");

    for (const appData of apps) {
      const existing = await getAppBySlug(appData.slug);
      if (existing) {
        console.log(`⏭️  Skipping "${appData.name}" (already exists)`);
        continue;
      }

      const created = await createApp(appData);
      console.log(`✅ Created: ${created.name}`);
      console.log(`   Slug: ${created.slug}`);
      console.log(`   Flow ID: ${created.flow_id}\n`);
    }

    console.log("🎉 Seeding complete!");
    console.log("\n📚 Next steps:");
    console.log("   1. Start the server: npm start");
    console.log("   2. Visit: http://localhost:10000/apps");
    console.log("   3. Click 'Open App' on any demo app to test");
  } catch (err) {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  }
}

seed();
