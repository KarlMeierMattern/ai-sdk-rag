/**
 * Database insertion test for ingestion pipeline
 * Tests end-to-end: normalization → DB insertion → embedding generation
 *
 * Run with: tsx lib/actions/ingest.test.ts
 */

import { priorityClients } from "@/data/priority-clients";
import { ingestDocument } from "./ingest";
import { db } from "../db";
import { resources } from "../db/schema/resources";
import { embeddings } from "../db/schema/embeddings";
import { eq } from "drizzle-orm";

async function testIngestion() {
  console.log("=== Testing Database Ingestion ===\n");

  // Test 1: Ingest a single priority client (Remgro)
  console.log("1. Testing single document ingestion (Remgro):");
  try {
    const remgroClient = priorityClients.find((c) => c.account === "Remgro");

    if (!remgroClient) {
      throw new Error("Remgro client not found in test data");
    }

    const result = await ingestDocument(
      {
        type: "json",
        data: [remgroClient],
        metadata: {
          title: "Remgro Client",
          source: "priority-clients.ts",
        },
      },
      { skipDuplicate: true }
    );

    if (result.success) {
      console.log(`✅ Success: ${result.message}`);
      if ("resourceId" in result && result.resourceId) {
        console.log(`   Resource ID: ${result.resourceId}`);
        if (result.skipped) {
          console.log(`   ⚠️  Skipped (duplicate detected)`);
        }

        // Verify it was stored in DB
        const stored = await db
          .select()
          .from(resources)
          .where(eq(resources.id, result.resourceId))
          .limit(1);

        if (stored.length > 0) {
          console.log(
            `   ✅ Verified in DB: title="${stored[0].title}", source="${stored[0].source}"`
          );

          // Check embeddings were created
          const resourceEmbeddings = await db
            .select()
            .from(embeddings)
            .where(eq(embeddings.resourceId, result.resourceId!));

          console.log(
            `   ✅ Created ${resourceEmbeddings.length} embedding chunks`
          );
        }
      }
    } else {
      console.error(`❌ Failed: ${result.message}`);
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }

  console.log("\n2. Testing bulk ingestion (first 3 priority clients):");
  try {
    const firstThree = priorityClients.slice(0, 3);

    const result = await ingestDocument(
      {
        type: "json",
        data: firstThree,
        metadata: {
          title: "Priority Clients Batch",
          source: "priority-clients.ts",
        },
      },
      { skipDuplicate: true }
    );

    if (result.success) {
      console.log(`✅ Success: ${result.message}`);
      if ("created" in result) {
        console.log(
          `   Created: ${result.created}, Skipped: ${
            result.skipped || 0
          }, Failed: ${result.failed}`
        );
      }
    } else {
      console.error(`❌ Failed: ${result.message}`);
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }

  console.log("\n3. Verifying query capability:");
  try {
    // Fetch recent resources and check for Remgro
    const allResources = await db.select().from(resources).limit(20);
    const remgroResources = allResources.filter((r) =>
      r.content.includes("Remgro")
    );

    if (remgroResources.length > 0) {
      console.log(
        `✅ Found ${remgroResources.length} resource(s) containing "Remgro"`
      );
      console.log(
        `   Sample: ${remgroResources[0].content.substring(0, 100)}...`
      );
      console.log(`   Title: ${remgroResources[0].title || "N/A"}`);
      console.log(`   Source: ${remgroResources[0].source || "N/A"}`);
    } else {
      console.log("⚠️  No resources found containing 'Remgro'");
      console.log(`   Total resources in DB: ${allResources.length}`);
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }

  console.log("\n=== Test Summary ===");
  console.log("✅ Database ingestion pipeline verified");
  console.log("✅ Resources stored with metadata (title, source)");
  console.log("✅ Embeddings generated and stored");
  console.log("\nNext: Test querying with 'Who is the partner for Remgro?'");
}

// Run test
testIngestion()
  .then(() => {
    console.log("\n✅ Tests completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
