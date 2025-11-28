/**
 * Backfill script to create missing embeddings for resources
 *
 * Run with: tsx lib/db/backfill-embeddings.ts
 */

import { db } from "./index";
import { resources } from "./schema/resources";
import { embeddings as embeddingsTable } from "./schema/embeddings";
import { generateEmbeddings } from "../ai/embedding";
import { sql } from "drizzle-orm";

async function backfillEmbeddings() {
  console.log("=== Backfilling Missing Embeddings ===\n");

  // Find resources without embeddings
  const resourcesWithoutEmbeddings = await db
    .select({
      id: resources.id,
      content: resources.content,
      title: resources.title,
      source: resources.source,
    })
    .from(resources)
    .leftJoin(
      embeddingsTable,
      sql`${resources.id} = ${embeddingsTable.resourceId}`
    )
    .where(sql`${embeddingsTable.id} IS NULL`);

  console.log(
    `Found ${resourcesWithoutEmbeddings.length} resources without embeddings\n`
  );

  if (resourcesWithoutEmbeddings.length === 0) {
    console.log("✅ All resources have embeddings!");
    return;
  }

  // Group by source for better reporting
  const bySource = resourcesWithoutEmbeddings.reduce((acc, resource) => {
    const source = resource.source || "unknown";
    if (!acc[source]) {
      acc[source] = [];
    }
    acc[source].push(resource);
    return acc;
  }, {} as Record<string, typeof resourcesWithoutEmbeddings>);

  console.log("Resources by source:");
  Object.entries(bySource).forEach(([source, items]) => {
    console.log(`  ${source}: ${items.length} resources`);
  });

  console.log("\nGenerating embeddings...\n");

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < resourcesWithoutEmbeddings.length; i++) {
    const resource = resourcesWithoutEmbeddings[i];
    const progress = `[${i + 1}/${resourcesWithoutEmbeddings.length}]`;

    try {
      console.log(
        `${progress} Processing: ${
          resource.title || resource.id.substring(0, 8)
        }...`
      );

      const embeddingsData = await generateEmbeddings(resource.content);

      await db.insert(embeddingsTable).values(
        embeddingsData.map((embedding) => ({
          resourceId: resource.id,
          ...embedding,
        }))
      );

      console.log(`  ✅ Created ${embeddingsData.length} embedding chunks\n`);
      successCount++;
    } catch (error) {
      console.error(
        `  ❌ Failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`
      );
      failCount++;
    }
  }

  console.log("\n=== Backfill Complete ===");
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
}

// Run backfill
backfillEmbeddings()
  .then(() => {
    console.log("\n✅ Backfill completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Backfill failed:", error);
    process.exit(1);
  });
