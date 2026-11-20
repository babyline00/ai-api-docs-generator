"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import {
  BookOpen,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileJson,
  Loader2,
  PlayCircle,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  CODE_LANGUAGES,
  METHOD_COLORS,
  type CodeLanguage,
  type Endpoint,
  type ExampleRequest,
  type HttpMethod,
  type Parameter,
} from "@/lib/types";
import { generateCodeSnippet } from "@/lib/code-snippet";

// ---------------------------------------------------------------------------
// Client-side view models (the API serialises DB rows into these shapes)
// ---------------------------------------------------------------------------

interface SpecSummary {
  id: string;
  name: string;
  version: string;
  sourceType: string;
  endpointCount: number;
  createdAt: string;
}

interface EndpointView extends Endpoint {
  id: string;
  examples: ExampleRequest[];
}

interface ChangelogView {
  id: string;
  changeType: string;
  method?: string;
  path?: string;
  description: string;
  fromVersion?: string | null;
  toVersion?: string | null;
  createdAt: string;
}

interface SpecFull {
  id: string;
  name: string;
  version: string;
  sourceType: string;
  serverUrl: string | null;
  info: { title: string; version: string; description?: string };
  endpoints: EndpointView[];
  changelog: ChangelogView[];
}

interface PlayResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

interface Stats {
  specs: number;
  endpoints: number;
  changelogs: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`.trim());
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-bold tracking-wide w-16 shrink-0 ${METHOD_COLORS[method]}`}
    >
      {method}
    </span>
  );
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return "text-emerald-600";
  if (status >= 300 && status < 400) return "text-sky-600";
  if (status >= 400 && status < 500) return "text-amber-600";
  if (status >= 500) return "text-rose-600";
  return "text-muted-foreground";
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          toast.error("Clipboard unavailable");
        }
      }}
    >
      {done ? <Sparkles className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? "Copied" : label}
    </Button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="code-block scrollbar-thin max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 whitespace-pre">
      {code}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Page() {
  const [stats, setStats] = useState<Stats>({ specs: 0, endpoints: 0, changelogs: 0 });
  const [specs, setSpecs] = useState<SpecSummary[]>([]);
  const [loadingSpecs, setLoadingSpecs] = useState(true);
  const [selectedSpecId, setSelectedSpecId] = useState<string | null>(null);
  const [spec, setSpec] = useState<SpecFull | null>(null);
  const [loadingSpec, setLoadingSpec] = useState(false);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const endpoint = useMemo(
    () => spec?.endpoints.find((e) => e.id === selectedEndpointId) ?? null,
    [spec, selectedEndpointId],
  );
  const playgroundRef = useRef<PlaygroundHandle>(null);

  const refreshStats = useCallback(async () => {
    try {
      const s = await api<Stats>("/api/stats");
      setStats(s);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshSpecs = useCallback(async () => {
    setLoadingSpecs(true);
    try {
      const data = await api<{ specs: SpecSummary[] }>("/api/specs");
      setSpecs(data.specs);
      if (!selectedSpecId && data.specs.length) {
        setSelectedSpecId(data.specs[0].id);
      }
    } catch (e) {
      toast.error("Failed to load specs", { description: (e as Error).message });
    } finally {
      setLoadingSpecs(false);
    }
  }, [selectedSpecId]);

  const loadSpec = useCallback(async (id: string | null) => {
    if (!id) {
      setSpec(null);
      setSelectedEndpointId(null);
      return;
    }
    setLoadingSpec(true);
    try {
      const data = await api<{ spec: SpecFull }>(`/api/specs/${id}`);
      setSpec(data.spec);
      const first = data.spec.endpoints[0]?.id ?? null;
      setSelectedEndpointId(first);
    } catch (e) {
      toast.error("Failed to load spec", { description: (e as Error).message });
      setSpec(null);
    } finally {
      setLoadingSpec(false);
    }
  }, []);

  useEffect(() => {
    refreshSpecs();
    refreshStats();
  }, [refreshSpecs, refreshStats]);

  useEffect(() => {
    loadSpec(selectedSpecId);
  }, [selectedSpecId, loadSpec]);

  async function handleDeleteSpec(id: string) {
    if (!confirm("Delete this spec and all its endpoints?")) return;
    try {
      await api(`/api/specs/${id}`, { method: "DELETE" });
      toast.success("Spec deleted");
      if (selectedSpecId === id) setSelectedSpecId(null);
      refreshSpecs();
      refreshStats();
    } catch (e) {
      toast.error("Delete failed", { description: (e as Error).message });
    }
  }

  async function handleImport(payload: { rawSpec: string; sourceType: string; name: string }) {
    try {
      const res = await api<{ spec: SpecSummary }>("/api/specs/import", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast.success("Imported", { description: `${res.spec.name} v${res.spec.version}` });
      setImportOpen(false);
      await refreshSpecs();
      setSelectedSpecId(res.spec.id);
      refreshStats();
    } catch (e) {
      toast.error("Import failed", { description: (e as Error).message });
    }
  }

  // Group endpoints by tag for the left sidebar
  const grouped = useMemo(() => {
    const map = new Map<string, EndpointView[]>();
    for (const e of spec?.endpoints ?? []) {
      const tags = e.tags?.length ? e.tags : ["Untagged"];
      for (const t of tags) {
        if (!map.has(t)) map.set(t, []);
        map.get(t)!.push(e);
      }
    }
    return Array.from(map.entries());
  }, [spec]);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center justify-between px-4 gap-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BookOpen className="size-4" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold">AI API Docs Generator</div>
              <div className="text-[11px] text-muted-foreground">
                {stats.specs} specs · {stats.endpoints} endpoints · {stats.changelogs} changelog entries
              </div>
            </div>
          </div>
          <ImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            onSubmit={handleImport}
          />
        </div>
      </header>

      {/* 3-column body */}
      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)] xl:grid-cols-[320px_minmax(0,1fr)_460px]">
        {/* Left column */}
        <aside className="border-r bg-muted/30 flex flex-col min-h-0">
          <div className="px-3 py-3 border-b">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">API Specs</h2>
              <span className="text-xs text-muted-foreground">{specs.length}</span>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {loadingSpecs && (
                <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading specs…
                </div>
              )}
              {!loadingSpecs && specs.length === 0 && (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No specs yet. Click <span className="font-medium">Import spec</span> to add one.
                </div>
              )}
              {specs.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSpecId(s.id)}
                  className={`group w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    selectedSpecId === s.id
                      ? "border-primary bg-background"
                      : "border-transparent hover:bg-background/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSpec(s.id);
                      }}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Delete spec"
                    >
                      <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {s.sourceType}
                    </Badge>
                    <span>v{s.version}</span>
                    <span>·</span>
                    <span>{s.endpointCount} ep</span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>

          {/* Endpoint list grouped by tag (under selected spec) */}
          {spec && (
            <div className="border-t max-h-[50vh] flex flex-col min-h-0">
              <div className="px-3 py-2 border-b text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Endpoints
              </div>
              <ScrollArea className="flex-1">
                <Accordion type="multiple" className="px-2">
                  {grouped.map(([tag, eps]) => (
                    <AccordionItem key={tag} value={tag}>
                      <AccordionTrigger className="py-2 text-sm">
                        <span className="flex items-center gap-2">
                          <span className="truncate">{tag}</span>
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                            {eps.length}
                          </Badge>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <ul className="space-y-0.5">
                          {eps.map((e) => (
                            <li key={e.id}>
                              <button
                                onClick={() => setSelectedEndpointId(e.id)}
                                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                                  selectedEndpointId === e.id
                                    ? "bg-primary/10"
                                    : "hover:bg-background/60"
                                }`}
                              >
                                <MethodBadge method={e.method} />
                                <span className="truncate text-xs font-mono">{e.path}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </ScrollArea>
            </div>
          )}
        </aside>

        {/* Center column */}
        <section className="min-h-0 overflow-y-auto scrollbar-thin">
          {loadingSpec && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          {!loadingSpec && !spec && (
            <EmptyState />
          )}
          {!loadingSpec && spec && !endpoint && (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              Select an endpoint from the left to view its documentation.
            </div>
          )}
          {!loadingSpec && spec && endpoint && (
            <EndpointDetail
              endpoint={endpoint}
              serverUrl={spec.serverUrl}
              specId={spec.id}
              onOpenPlayground={() => {
                playgroundRef.current?.load(endpoint, spec.serverUrl);
              }}
            />
          )}
        </section>

        {/* Right column — playground */}
        <aside className="border-l bg-muted/30 min-h-0 overflow-y-auto scrollbar-thin">
          <Playground spec={spec} ref={playgroundRef} />
        </aside>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <FileJson className="size-7" />
      </div>
      <h3 className="text-lg font-semibold">No spec selected</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        Import an OpenAPI 3.x (JSON or YAML) spec or a Postman Collection v2.1
        to generate interactive docs, AI examples, 6-language code snippets,
        and a live try-it playground.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import dialog
// ---------------------------------------------------------------------------

function ImportDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (p: { rawSpec: string; sourceType: string; name: string }) => void;
}) {
  const [rawSpec, setRawSpec] = useState("");
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState("auto");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function readFile(file: File) {
    const text = await file.text();
    setRawSpec(text);
    if (!name) setName(file.name.replace(/\.(json|yaml|yml)$/i, ""));
  }

  function submit() {
    if (!rawSpec.trim()) {
      toast.error("Paste or upload a spec first");
      return;
    }
    setBusy(true);
    try {
      onSubmit({ rawSpec, sourceType, name: name || "Imported spec" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          Import spec
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import API spec</DialogTitle>
          <DialogDescription>
            Paste an OpenAPI 3.x (JSON or YAML) document or a Postman Collection
            v2.1, or upload a file. Examples are generated by an LLM on import.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="imp-name">Name</Label>
              <Input
                id="imp-name"
                placeholder="User Service API"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imp-type">Source type</Label>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger id="imp-type" className="w-full">
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  <SelectItem value="openapi">OpenAPI 3.x</SelectItem>
                  <SelectItem value="postman">Postman v2.1</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="imp-raw">Raw spec</Label>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-3.5" />
                Upload file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.yaml,.yml,application/json,text/yaml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) readFile(f);
                }}
              />
            </div>
            <Textarea
              id="imp-raw"
              placeholder='{ "openapi": "3.0.0", ... }'
              className="min-h-48 font-mono text-xs"
              value={rawSpec}
              onChange={(e) => setRawSpec(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Import & generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Endpoint detail (center column)
// ---------------------------------------------------------------------------

function EndpointDetail({
  endpoint,
  serverUrl,
  specId,
  onOpenPlayground,
}: {
  endpoint: EndpointView;
  serverUrl: string | null;
  specId: string;
  onOpenPlayground: () => void;
}) {
  const [lang, setLang] = useState<CodeLanguage>("curl");
  const [busy, setBusy] = useState(false);

  const example = endpoint.examples?.[0] ?? {
    label: "Default example",
    params: {},
    headers: {},
  };

  const snippet = useMemo(
    () => generateCodeSnippet(endpoint, example, lang, { serverUrl: serverUrl ?? undefined }),
    [endpoint, example, lang, serverUrl],
  );

  async function regenerate() {
    setBusy(true);
    try {
      const res = await api<{ examples: ExampleRequest[] }>(
        `/api/endpoints/${endpoint.id}/regenerate-examples`,
        { method: "POST" },
      );
      toast.success(`Regenerated ${res.examples.length} example(s)`);
    } catch (e) {
      toast.error("Regenerate failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const pathParams = endpoint.parameters.filter((p) => p.in === "path");
  const queryParams = endpoint.parameters.filter((p) => p.in === "query");
  const headerParams = endpoint.parameters.filter((p) => p.in === "header");
  const hasBody = Boolean(endpoint.requestBody && Object.keys(endpoint.requestBody.content ?? {}).length);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Title */}
      <div>
        <div className="flex items-center gap-2">
          <MethodBadge method={endpoint.method} />
          <code className="text-lg font-semibold font-mono break-all">{endpoint.path}</code>
        </div>
        {endpoint.summary && (
          <p className="mt-2 text-base font-medium">{endpoint.summary}</p>
        )}
        {endpoint.description && (
          <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
            {endpoint.description}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" className="gap-1.5" onClick={onOpenPlayground}>
            <PlayCircle className="size-4" />
            Open in playground
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={regenerate} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Regenerate examples
          </Button>
          {endpoint.tags?.map((t) => (
            <Badge key={t} variant="outline" className="text-[11px]">{t}</Badge>
          ))}
        </div>
      </div>

      <Separator />

      {/* Parameters */}
      <ParameterTable title="Path parameters" params={pathParams} />
      <ParameterTable title="Query parameters" params={queryParams} />
      <ParameterTable title="Headers" params={headerParams} />

      {/* Request body */}
      {hasBody && endpoint.requestBody && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Request body</CardTitle>
            <CardDescription>
              {endpoint.requestBody.required ? "Required" : "Optional"} ·{" "}
              {Object.keys(endpoint.requestBody.content ?? {}).join(", ") || "any"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const ct = endpoint.requestBody.content?.["application/json"] ??
                Object.values(endpoint.requestBody.content ?? {})[0];
              return (
                <div className="space-y-2">
                  {ct?.schema && <SchemaTree schema={ct.schema} />}
                  {ct?.example != null && (
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">Example</div>
                      <CodeBlock code={JSON.stringify(ct.example, null, 2)} />
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Responses */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Responses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(endpoint.responses).length === 0 && (
            <p className="text-xs text-muted-foreground">No responses documented.</p>
          )}
          {Object.entries(endpoint.responses).map(([code, r]) => (
            <div key={code}>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${statusColor(Number(code))}`}>{code}</span>
                <span className="text-xs text-muted-foreground">{r.description ?? ""}</span>
              </div>
              {r.content?.["application/json"]?.schema && (
                <div className="mt-1.5">
                  <SchemaTree schema={r.content["application/json"].schema} />
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Example */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm">Example request</CardTitle>
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="text-[11px]">{example.label ?? "Default"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.keys(example.params ?? {}).length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Params</div>
              <CodeBlock code={JSON.stringify(example.params, null, 2)} />
            </div>
          )}
          {Object.keys(example.headers ?? {}).length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Headers</div>
              <CodeBlock code={JSON.stringify(example.headers, null, 2)} />
            </div>
          )}
          {example.body != null && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Body</div>
              <CodeBlock code={JSON.stringify(example.body, null, 2)} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Code snippets */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm">Code snippet</CardTitle>
          <CopyButton text={snippet} />
        </CardHeader>
        <CardContent>
          <Tabs value={lang} onValueChange={(v) => setLang(v as CodeLanguage)}>
            <TabsList className="flex-wrap">
              {CODE_LANGUAGES.map((l) => (
                <TabsTrigger key={l.id} value={l.id} className="text-xs">
                  {l.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={lang} className="mt-3">
              <CodeBlock code={snippet} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function ParameterTable({ title, params }: { title: string; params: Parameter[] }) {
  if (!params.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-1.5 pr-3 font-medium">Name</th>
                <th className="py-1.5 pr-3 font-medium">Type</th>
                <th className="py-1.5 pr-3 font-medium">Required</th>
                <th className="py-1.5 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={`${p.in}:${p.name}`} className="border-b last:border-0">
                  <td className="py-1.5 pr-3 font-mono text-xs">{p.name}</td>
                  <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                    {p.schema?.type ?? "string"}
                    {p.schema?.format ? ` (${p.schema.format})` : ""}
                  </td>
                  <td className="py-1.5 pr-3">
                    {p.required ? (
                      <Badge variant="destructive" className="text-[10px]">required</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">optional</span>
                    )}
                  </td>
                  <td className="py-1.5 text-xs text-muted-foreground">{p.description ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SchemaTree({ schema, depth = 0 }: { schema: any; depth?: number }) {
  if (!schema || depth > 4) return null;
  const type = schema.type ?? (schema.properties ? "object" : schema.$ref ? "ref" : "any");
  if (type === "object" && schema.properties) {
    return (
      <div className="rounded-md border bg-muted/30 p-2 text-xs">
        <div className="mb-1 font-mono text-muted-foreground">object</div>
        <ul className="space-y-1">
          {Object.entries(schema.properties).map(([k, v]) => {
            const req = schema.required?.includes(k);
            return (
              <li key={k} className="flex items-start gap-2">
                <code className="font-mono">{k}</code>
                {req && <Badge variant="destructive" className="px-1 py-0 text-[9px]">req</Badge>}
                <span className="text-muted-foreground">
                  {(v as any)?.type ?? "any"}
                  {(v as any)?.format ? ` · ${(v as any).format}` : ""}
                </span>
                {(v as any)?.type === "object" && (
                  <div className="flex-1">
                    <SchemaTree schema={v} depth={depth + 1} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  if (type === "array" && schema.items) {
    return (
      <div className="rounded-md border bg-muted/30 p-2 text-xs">
        <div className="mb-1 font-mono text-muted-foreground">array of:</div>
        <SchemaTree schema={schema.items} depth={depth + 1} />
      </div>
    );
  }
  return (
    <div className="text-xs text-muted-foreground">
      <code className="font-mono">{type}</code>
      {schema.format ? ` · ${schema.format}` : ""}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Playground (right column)
// ---------------------------------------------------------------------------

interface PlaygroundHandle {
  load: (endpoint: EndpointView, serverUrl: string | null) => void;
}

const Playground = (() => {
  const Inner = (
    {
      spec,
    }: { spec: SpecFull | null },
    ref: Ref<PlaygroundHandle>,
  ) => {
    const [endpoint, setEndpoint] = useState<EndpointView | null>(null);
    const [serverUrl, setServerUrl] = useState<string | null>(spec?.serverUrl ?? null);
    const [params, setParams] = useState<Record<string, string>>({});
    const [headers, setHeaders] = useState<Record<string, string>>({});
    const [body, setBody] = useState<string>("");
    const [sending, setSending] = useState(false);
    const [response, setResponse] = useState<PlayResponse | null>(null);

    useImperativeHandle(ref, () => ({
      load: (ep, srv) => {
        setEndpoint(ep);
        setServerUrl(srv);
        const ex = ep.examples?.[0] ?? { params: {}, headers: {}, body: undefined };
        setParams(Object.fromEntries(Object.entries(ex.params ?? {}).map(([k, v]) => [k, String(v ?? "")])));
        setHeaders(Object.fromEntries(Object.entries(ex.headers ?? {}).map(([k, v]) => [k, String(v)])));
        setBody(ex.body != null ? JSON.stringify(ex.body, null, 2) : "");
        setResponse(null);
      },
    }));

    const jsonContent = endpoint?.requestBody?.content?.["application/json"];

    async function send() {
      if (!endpoint) return;
      setSending(true);
      setResponse(null);
      try {
        const parsedBody = body.trim() ? safeParse(body) : undefined;
        const res = await api<PlayResponse>(`/api/endpoints/${endpoint.id}/playground`, {
          method: "POST",
          body: JSON.stringify({
            params,
            body: parsedBody,
            headers,
            serverUrl,
          }),
        });
        setResponse(res);
      } catch (e) {
        setResponse({
          status: 0,
          statusText: "Error",
          headers: {},
          body: (e as Error).message,
          durationMs: 0,
        });
      } finally {
        setSending(false);
      }
    }

    if (!endpoint) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <PlayCircle className="size-6" />
          </div>
          <h3 className="text-sm font-semibold">Playground</h3>
          <p className="text-xs text-muted-foreground">
            Click <span className="font-medium">Open in playground</span> on an endpoint to load a
            request you can edit and send. The server proxies to{" "}
            <code className="font-mono">{spec?.serverUrl ?? "the spec's server URL"}</code>.
          </p>
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <MethodBadge method={endpoint.method} />
            <code className="text-xs font-mono break-all">{endpoint.path}</code>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-4 p-4">
            {/* server URL override */}
            <div className="space-y-1.5">
              <Label>Server URL</Label>
              <Input
                value={serverUrl ?? ""}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://api.example.com"
                className="text-xs font-mono"
              />
            </div>

            {/* params */}
            <ParamFields title="Path & query parameters" endpoint={endpoint} params={params} setParams={setParams} />
            <HeaderFields headers={headers} setHeaders={setHeaders} />

            {/* body */}
            {jsonContent && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Request body (JSON)</Label>
                  <CopyButton text={body} label="Copy" />
                </div>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="min-h-40 font-mono text-xs"
                  placeholder="{ }"
                />
              </div>
            )}

            <Button onClick={send} disabled={sending} className="w-full gap-1.5">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send request
            </Button>

            {response && <ResponsePanel response={response} />}
          </div>
        </ScrollArea>
      </div>
    );
  };
  // forwardRef wrapper
  return forwardRef(Inner);
})();

function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function ParamFields({
  title,
  endpoint,
  params,
  setParams,
}: {
  title: string;
  endpoint: EndpointView;
  params: Record<string, string>;
  setParams: (p: Record<string, string>) => void;
}) {
  const relevant = endpoint.parameters.filter((p) => p.in === "path" || p.in === "query");
  if (!relevant.length) return null;
  return (
    <div className="space-y-1.5">
      <Label>{title}</Label>
      <div className="space-y-2">
        {relevant.map((p) => (
          <div key={p.name} className="grid grid-cols-[1fr_1.4fr] items-center gap-2">
            <div className="flex items-center gap-1.5">
              <code className="text-xs font-mono">{p.name}</code>
              <Badge variant="outline" className="px-1 py-0 text-[9px]">{p.in}</Badge>
              {p.required && <Badge variant="destructive" className="px-1 py-0 text-[9px]">req</Badge>}
            </div>
            <Input
              value={params[p.name] ?? ""}
              onChange={(e) => setParams({ ...params, [p.name]: e.target.value })}
              placeholder={String(p.example ?? p.schema?.example ?? "")}
              className="h-8 text-xs font-mono"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function HeaderFields({
  headers,
  setHeaders,
}: {
  headers: Record<string, string>;
  setHeaders: (h: Record<string, string>) => void;
}) {
  const entries = Object.entries(headers);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>Headers</Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setHeaders({ ...headers, [`x-header-${entries.length}`]: "" })}
        >
          <Plus className="size-3" />
          Add
        </Button>
      </div>
      <div className="space-y-2">
        {entries.map(([k, v], i) => (
          <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-2">
            <Input
              value={k}
              onChange={(e) => {
                const next = { ...headers };
                delete next[k];
                next[e.target.value] = v;
                setHeaders(next);
              }}
              className="h-8 text-xs font-mono"
              placeholder="Header-Name"
            />
            <Input
              value={v}
              onChange={(e) => setHeaders({ ...headers, [k]: e.target.value })}
              className="h-8 text-xs font-mono"
              placeholder="value"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => {
                const next = { ...headers };
                delete next[k];
                setHeaders(next);
              }}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}
        {entries.length === 0 && (
          <p className="text-xs text-muted-foreground">No headers. Click Add.</p>
        )}
      </div>
    </div>
  );
}

function ResponsePanel({ response }: { response: PlayResponse }) {
  const isJson = (() => {
    try {
      JSON.parse(response.body);
      return true;
    } catch {
      return false;
    }
  })();
  const pretty = isJson ? JSON.stringify(JSON.parse(response.body), null, 2) : response.body;
  return (
    <div className="space-y-3 rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${statusColor(response.status)}`}>
            {response.status || "ERR"} {response.statusText}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" />
          {response.durationMs} ms
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">Headers</div>
        <div className="space-y-0.5">
          {Object.entries(response.headers).map(([k, v]) => (
            <div key={k} className="flex gap-2 text-xs">
              <code className="font-mono text-muted-foreground">{k}:</code>
              <code className="font-mono break-all">{v}</code>
            </div>
          ))}
          {Object.keys(response.headers).length === 0 && (
            <p className="text-xs text-muted-foreground">No headers.</p>
          )}
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Body</span>
          <CopyButton text={pretty} />
        </div>
        <CodeBlock code={pretty || "(empty)"} />
      </div>
    </div>
  );
}
