import { artifactsPrompt } from "./sections/artifacts";
import { buildIdentitySection } from "./sections/identity";
import { buildLocationSection } from "./sections/location";
import { buildToolGuidelinesSection } from "./sections/tools";
import type { PromptContext } from "./types";

export class SystemPromptBuilder {
  build(context: PromptContext): string {
    const sections = [
      buildIdentitySection(),
      buildLocationSection(context.requestHints),
      buildToolGuidelinesSection(),
      artifactsPrompt,
    ];

    return sections.join("\n\n");
  }
}

// Singleton instance for reuse
export const promptBuilder = new SystemPromptBuilder();
