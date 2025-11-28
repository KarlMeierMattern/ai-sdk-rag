"use server";

import {
  NewResourceParams,
  insertResourceSchema,
  resources,
} from "@/lib/db/schema/resources";
import { Document } from "@/lib/types/document";
import { generateEmbeddings } from "../ai/embedding";
import { db } from "../db";
import { embeddings as embeddingsTable } from "../db/schema/embeddings";
import { and, eq, sql } from "drizzle-orm";

/**
 * Creates a resource from a normalized Document
 * Handles metadata and embeddings
 * Optionally checks for duplicates based on content + source
 */
export const createResourceFromDocument = async (
  document: Document,
  options?: { skipDuplicate?: boolean }
) => {
  try {
    // Check for duplicate if option is enabled
    if (options?.skipDuplicate) {
      const existing = await db
        .select()
        .from(resources)
        .where(
          and(
            eq(resources.content, document.content),
            document.source
              ? eq(resources.source, document.source)
              : sql`${resources.source} IS NULL`
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const resourceId = existing[0].id;

        // Check if embeddings exist - if not, create them
        const existingEmbeddings = await db
          .select()
          .from(embeddingsTable)
          .where(eq(embeddingsTable.resourceId, resourceId))
          .limit(1);

        if (existingEmbeddings.length === 0) {
          // Resource exists but no embeddings - backfill them
          const embeddings = await generateEmbeddings(document.content);
          await db.insert(embeddingsTable).values(
            embeddings.map((embedding) => ({
              resourceId,
              ...embedding,
            }))
          );
          return { success: true, resourceId, backfilled: true };
        }

        return {
          success: true,
          resourceId,
          skipped: true,
        };
      }
    }

    const [resource] = await db
      .insert(resources)
      .values({
        content: document.content,
        title: document.title ?? null,
        source: document.source ?? null,
      })
      .returning();

    const embeddings = await generateEmbeddings(document.content);
    await db.insert(embeddingsTable).values(
      embeddings.map((embedding) => ({
        resourceId: resource.id,
        ...embedding,
      }))
    );
    return { success: true, resourceId: resource.id };
  } catch (error) {
    throw error instanceof Error && error.message.length > 0
      ? error
      : new Error("Error creating resource, please try again.");
  }
};

/**
 * Creates multiple resources from an array of Documents
 * Useful for JSON/CSV imports that generate multiple documents
 */
export const createResourcesFromDocuments = async (
  documents: Document[],
  options?: { skipDuplicate?: boolean }
) => {
  const results = await Promise.allSettled(
    documents.map((doc) => createResourceFromDocument(doc, options))
  );

  const successful = results.filter((r) => r.status === "fulfilled").length;
  const skipped = results.filter(
    (r) => r.status === "fulfilled" && "skipped" in r.value && r.value.skipped
  ).length;
  const failed = results.filter((r) => r.status === "rejected").length;
  const created = successful - skipped;

  // Log first few failures for debugging
  if (failed > 0) {
    const failures = results
      .filter((r) => r.status === "rejected")
      .slice(0, 3)
      .map((r) => {
        if (r.status === "rejected") {
          return r.reason instanceof Error
            ? r.reason.message
            : String(r.reason);
        }
        return "";
      })
      .filter(Boolean);

    if (failures.length > 0) {
      console.error(
        `⚠️  Sample errors (${failures.length} of ${failed}):`,
        failures
      );
    }
  }

  return {
    success: true,
    created,
    skipped,
    failed,
    message: `Created ${created} resource(s)${
      skipped > 0 ? `, ${skipped} skipped (duplicates)` : ""
    }${failed > 0 ? `, ${failed} failed` : ""}.`,
  };
};

/**
 * Legacy function - maintains backward compatibility
 * For new code, use createResourceFromDocument or createResourcesFromDocuments
 */
export const createResource = async (input: { content: string }) => {
  try {
    const { content } = insertResourceSchema.parse(input);

    const [resource] = await db
      .insert(resources)
      .values({ content })
      .returning();

    const embeddings = await generateEmbeddings(content);
    await db.insert(embeddingsTable).values(
      embeddings.map((embedding) => ({
        resourceId: resource.id,
        ...embedding,
      }))
    );
    return "Resource successfully created and embedded.";
  } catch (error) {
    return error instanceof Error && error.message.length > 0
      ? error.message
      : "Error, please try again.";
  }
};
