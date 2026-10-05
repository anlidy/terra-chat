/**
 * Content-hash deduplication helpers for knowledge documents.
 *
 * A document resource belongs to a user and can be linked to several
 * collections (project knowledge or chat attachments). Re-uploading the same
 * bytes reuses the already-indexed resource instead of parsing and embedding
 * it again, so deletes must only remove a resource once no collection uses it.
 */

export type ReuseCandidate = {
  status: string;
  pipelineVersion: string;
};

/**
 * Only fully indexed resources built by the current pipeline can be shared;
 * failed or in-flight ingestions, or chunks produced by an older pipeline,
 * must be processed again.
 */
export function canReuseResource(
  candidate: ReuseCandidate,
  pipelineVersion: string
): boolean {
  return (
    candidate.status === "ready" &&
    candidate.pipelineVersion === pipelineVersion
  );
}

/**
 * Given the resources just detached from some collections and the ones that
 * are still linked elsewhere, return the resources nothing references anymore.
 */
export function findOrphanedResourceIds(
  detachedIds: string[],
  stillLinkedIds: string[]
): string[] {
  const stillLinked = new Set(stillLinkedIds);
  return [...new Set(detachedIds)].filter((id) => !stillLinked.has(id));
}
