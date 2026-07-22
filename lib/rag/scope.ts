export function resolveChatCollectionIds({
  chatCollectionId,
  projectCollectionId,
}: {
  chatCollectionId: string;
  projectCollectionId?: string | null;
}): string[] {
  return [
    ...new Set([chatCollectionId, projectCollectionId].filter(Boolean)),
  ] as string[];
}
