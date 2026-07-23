import type { DataUIPart } from "ai";
import type { UIArtifact } from "@/components/artifact";
import type { Suggestion } from "@/lib/db/schema";
import type { CustomUIDataTypes } from "@/lib/types";

type ArtifactStreamPart = DataUIPart<CustomUIDataTypes>;

export type ArtifactStreamState = {
  artifact: UIArtifact;
  suggestions: Suggestion[];
};

const SNAPSHOT_TYPES = new Set<ArtifactStreamPart["type"]>([
  "data-codeDelta",
  "data-sheetDelta",
  "data-imageDelta",
]);

export function compactArtifactStreamParts(
  parts: ArtifactStreamPart[]
): ArtifactStreamPart[] {
  const latestSnapshotIndexes = new Map<ArtifactStreamPart["type"], number>();
  for (let index = 0; index < parts.length; index += 1) {
    if (SNAPSHOT_TYPES.has(parts[index].type)) {
      latestSnapshotIndexes.set(parts[index].type, index);
    }
  }

  const compacted: ArtifactStreamPart[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const current = parts[index];
    if (
      SNAPSHOT_TYPES.has(current.type) &&
      latestSnapshotIndexes.get(current.type) !== index
    ) {
      continue;
    }

    const previous = compacted.at(-1);
    if (
      current.type === "data-textDelta" &&
      previous?.type === "data-textDelta"
    ) {
      compacted[compacted.length - 1] = {
        type: "data-textDelta",
        data: previous.data + current.data,
      };
    } else {
      compacted.push(current);
    }
  }
  return compacted;
}

export function reduceArtifactStreamBatch(
  state: ArtifactStreamState,
  incomingParts: ArtifactStreamPart[],
  errorMessage?: string
): ArtifactStreamState {
  let artifact = state.artifact;
  let suggestions = state.suggestions;
  const hadActiveArtifactStream = artifact.status === "streaming";
  let receivedArtifactPart = false;

  for (const streamPart of compactArtifactStreamParts(incomingParts)) {
    switch (streamPart.type) {
      case "data-id": {
        receivedArtifactPart = true;
        const isNewDocument = artifact.documentId !== streamPart.data;
        artifact = {
          ...artifact,
          documentId: streamPart.data,
          status: "streaming",
          errorMessage: undefined,
          ...(isNewDocument
            ? {
                content: "",
                hasAutoOpened: false,
                wasDismissed: false,
              }
            : {}),
        };
        if (isNewDocument) {
          suggestions = [];
        }
        break;
      }
      case "data-title":
        receivedArtifactPart = true;
        artifact = { ...artifact, title: streamPart.data, status: "streaming" };
        break;
      case "data-kind":
        receivedArtifactPart = true;
        artifact = { ...artifact, kind: streamPart.data, status: "streaming" };
        break;
      case "data-clear":
        receivedArtifactPart = true;
        artifact = { ...artifact, content: "", status: "streaming" };
        break;
      case "data-textDelta": {
        receivedArtifactPart = true;
        const content = artifact.content + streamPart.data;
        const shouldOpen =
          artifact.kind === "text" &&
          artifact.content.length < 400 &&
          content.length >= 400 &&
          !artifact.hasAutoOpened &&
          !artifact.wasDismissed;
        artifact = {
          ...artifact,
          content,
          status: "streaming",
          isVisible: shouldOpen || artifact.isVisible,
          hasAutoOpened: shouldOpen || artifact.hasAutoOpened,
        };
        break;
      }
      case "data-codeDelta":
      case "data-sheetDelta":
      case "data-imageDelta":
        receivedArtifactPart = true;
        artifact = {
          ...artifact,
          content: streamPart.data,
          status: "streaming",
          isVisible: artifact.wasDismissed ? artifact.isVisible : true,
          hasAutoOpened: artifact.wasDismissed ? artifact.hasAutoOpened : true,
        };
        break;
      case "data-suggestion":
        receivedArtifactPart = true;
        suggestions = [...suggestions, streamPart.data];
        break;
      case "data-finish":
        receivedArtifactPart = true;
        artifact = { ...artifact, status: "idle", errorMessage: undefined };
        break;
      default:
        break;
    }
  }

  if (errorMessage && (hadActiveArtifactStream || receivedArtifactPart)) {
    artifact = { ...artifact, status: "error", errorMessage };
  }

  return { artifact, suggestions };
}
