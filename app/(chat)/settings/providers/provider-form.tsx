"use client";

import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Model = {
  id: string;
  modelId: string;
  displayName: string;
  isEnabled: boolean;
};

type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  format: "openai" | "anthropic" | "alibaba";
  isEnabled: boolean;
};

export function ProviderForm({
  provider,
  onCancel,
  onSaved,
}: {
  provider?: Provider;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEditing = !!provider;

  const [name, setName] = useState(provider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [format, setFormat] = useState<"openai" | "anthropic" | "alibaba">(
    provider?.format ?? "openai"
  );
  const [saving, setSaving] = useState(false);

  const { data: models, mutate: mutateModels } = useSWR<Model[]>(
    provider ? `/api/settings/providers/${provider.id}/models` : null,
    fetcher
  );

  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");

  async function handleSave() {
    setSaving(true);
    try {
      if (isEditing) {
        const body: Record<string, unknown> = { name, baseUrl, format };
        if (apiKey) {
          body.apiKey = apiKey;
        }
        await fetch(`/api/settings/providers/${provider.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        if (!apiKey) {
          toast({ type: "error", description: "API key is required" });
          setSaving(false);
          return;
        }
        const res = await fetch("/api/settings/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, baseUrl, apiKey, format }),
        });
        if (!res.ok) {
          const data = await res.json();
          toast({
            type: "error",
            description: data.error?.formErrors?.[0] ?? "Failed to create",
          });
          setSaving(false);
          return;
        }
      }
      toast({
        type: "success",
        description: isEditing ? "Provider updated" : "Provider created",
      });
      onSaved();
    } catch {
      toast({ type: "error", description: "Failed to save provider" });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddModel() {
    if (!provider || !newModelId || !newModelName) {
      return;
    }
    try {
      await fetch(`/api/settings/providers/${provider.id}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: newModelId,
          displayName: newModelName,
        }),
      });
      setNewModelId("");
      setNewModelName("");
      await mutateModels();
    } catch {
      toast({ type: "error", description: "Failed to add model" });
    }
  }

  async function handleDeleteModel(modelId: string) {
    if (!provider) {
      return;
    }
    try {
      await fetch(
        `/api/settings/providers/${provider.id}/models?modelId=${modelId}`,
        { method: "DELETE" }
      );
      await mutateModels();
    } catch {
      toast({ type: "error", description: "Failed to delete model" });
    }
  }

  async function handleToggleModel(modelId: string, isEnabled: boolean) {
    if (!provider) {
      return;
    }
    try {
      await fetch(
        `/api/settings/providers/${provider.id}/models?modelId=${modelId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isEnabled }),
        }
      );
      await mutateModels();
    } catch {
      toast({ type: "error", description: "Failed to toggle model" });
    }
  }

  return (
    <div className="max-w-xl space-y-8">
      <button
        className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        onClick={onCancel}
        type="button"
      >
        <ArrowLeft className="size-4" />
        Back to providers
      </button>

      <h2 className="font-semibold text-lg">
        {isEditing ? "Edit Provider" : "New Provider"}
      </h2>

      <section className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="provider-name">
            Name
          </label>
          <input
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-ring"
            id="provider-name"
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. OpenRouter"
            value={name}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="base-url">
            Base URL
          </label>
          <input
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-ring"
            id="base-url"
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            value={baseUrl}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="api-key">
            API Key
          </label>
          <input
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-ring"
            id="api-key"
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              isEditing ? "Leave empty to keep current key" : "sk-..."
            }
            type="password"
            value={apiKey}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="format">
            Format
          </label>
          <select
            className="w-full cursor-pointer rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none"
            id="format"
            onChange={(e) =>
              setFormat(e.target.value as "openai" | "anthropic" | "alibaba")
            }
            value={format}
          >
            <option value="openai">OpenAI Compatible</option>
            <option value="anthropic">Anthropic Compatible</option>
            <option value="alibaba">Alibaba (DashScope)</option>
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onCancel} size="sm" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={saving || !name || !baseUrl}
            onClick={handleSave}
            size="sm"
          >
            {saving ? "Saving..." : isEditing ? "Update" : "Create"}
          </Button>
        </div>
      </section>

      {isEditing && (
        <section className="space-y-5">
          <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
            Models
          </h3>

          {models && models.length > 0 ? (
            <div className="space-y-1">
              {models.map((model) => (
                <div
                  className="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-accent"
                  key={model.id}
                >
                  <div className="flex items-center gap-3">
                    <input
                      checked={model.isEnabled}
                      className="rounded"
                      onChange={() =>
                        handleToggleModel(model.id, !model.isEnabled)
                      }
                      type="checkbox"
                    />
                    <div>
                      <p className="text-sm font-medium">{model.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {model.modelId}
                      </p>
                    </div>
                  </div>
                  <button
                    className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleDeleteModel(model.id)}
                    type="button"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No models added yet.
            </p>
          )}

          <div className="flex items-end gap-2 pt-2">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium" htmlFor="new-model-id">
                Model ID
              </label>
              <input
                className="w-full rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm outline-none"
                id="new-model-id"
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="e.g. gpt-4o"
                value={newModelId}
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium" htmlFor="new-model-name">
                Display Name
              </label>
              <input
                className="w-full rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm outline-none"
                id="new-model-name"
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="e.g. GPT-4o"
                value={newModelName}
              />
            </div>
            <Button
              disabled={!newModelId || !newModelName}
              onClick={handleAddModel}
              size="sm"
              variant="outline"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
