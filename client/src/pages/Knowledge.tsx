import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  BookOpenCheck,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Save,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const categoryLabels: Record<string, string> = {
  company: "Company facts",
  product: "Products and services",
  products: "Products and services",
  offering: "Products and services",
  pricing: "Pricing and finance",
  finance: "Pricing and finance",
  certification: "Certifications",
  credential: "Certifications",
  support: "Support and outcomes",
  outcome: "Support and outcomes",
  faq: "FAQs",
  contact: "Contact information",
  policy: "Policies",
  refund: "Policies",
  cancellation: "Policies",
};

function categoryFor(source: {
  title: string;
  sourceMetadata: Record<string, unknown> | null;
}) {
  const raw =
    typeof source.sourceMetadata?.category === "string"
      ? source.sourceMetadata.category
      : source.title;
  const value = raw.toLowerCase();
  const key = Object.keys(categoryLabels).find(candidate =>
    value.includes(candidate)
  );
  return key ? categoryLabels[key] : "Other trusted knowledge";
}

export default function Knowledge() {
  const sources = trpc.knowledge.list.useQuery(undefined, { retry: false });
  const management = trpc.managementElevation.status.useQuery(undefined, {
    retry: false,
  });
  const add = trpc.knowledge.add.useMutation();
  const update = trpc.knowledge.update.useMutation();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [error, setError] = useState("");

  const grouped = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof sources.data>>();
    for (const source of sources.data ?? []) {
      if (source.status !== "ready" || source.visibility !== "organisation")
        continue;
      const category = categoryFor(source);
      groups.set(category, [...(groups.get(category) ?? []), source]);
    }
    return Array.from(groups.entries());
  }, [sources.data]);

  async function addKnowledge() {
    try {
      setError("");
      await add.mutateAsync({
        title: title.trim(),
        content: content.trim(),
        sourceType: "note",
      });
      setTitle("");
      setContent("");
      setAdding(false);
      await sources.refetch();
      toast.success("Trusted company knowledge added.");
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "That knowledge could not be saved. Nothing was changed."
        )
      );
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    try {
      setError("");
      await update.mutateAsync({
        id: editingId,
        title: editTitle.trim(),
        content: editContent.trim(),
      });
      setEditingId(null);
      await sources.refetch();
      toast.success("Trusted company knowledge updated.");
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "That correction could not be saved. Nothing was changed."
        )
      );
    }
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6 text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#3F70D8]">
                Company knowledge
              </p>
              <h1 className="mt-2 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
                What Amarktai knows about your business.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#66758A]">
                Review the trusted facts used by the Assistant. Correct them
                here, add anything missing, and open the original source when
                useful.
              </p>
            </div>
            <Button onClick={() => setAdding(value => !value)}>
              {adding ? (
                <X className="mr-2 h-4 w-4" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {adding ? "Close" : "Add knowledge"}
            </Button>
          </div>
        </header>

        <ManagementElevation />

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}

        {adding ? (
          <section className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm">
            <h2 className="font-display text-2xl font-bold">
              Add a trusted fact
            </h2>
            <Input
              className="mt-4"
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="e.g. Refund policy"
              aria-label="Knowledge title"
            />
            <Textarea
              className="mt-3 min-h-32"
              value={content}
              onChange={event => setContent(event.target.value)}
              placeholder="Write the approved information the team should use."
              aria-label="Knowledge content"
            />
            <Button
              className="mt-4"
              disabled={
                !title.trim() ||
                !content.trim() ||
                !management.data?.elevated ||
                add.isPending
              }
              onClick={() => void addKnowledge()}
            >
              {add.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save trusted knowledge
            </Button>
          </section>
        ) : null}

        {sources.isLoading ? (
          <div className="grid min-h-48 place-items-center rounded-3xl border border-[#DCE4EE] bg-white text-sm text-[#66758A]">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading trusted knowledge…
          </div>
        ) : grouped.length ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {grouped.map(([category, items]) => (
              <section
                key={category}
                className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6"
              >
                <div className="flex items-center gap-3">
                  <BookOpenCheck className="h-5 w-5 text-[#3F70D8]" />
                  <h2 className="font-display text-2xl font-bold">
                    {category}
                  </h2>
                </div>
                <div className="mt-4 space-y-3">
                  {items.map(source => (
                    <article
                      key={source.id}
                      className="rounded-2xl border border-[#E2E8F0] bg-[#FAFCFF] p-4"
                    >
                      {editingId === source.id ? (
                        <>
                          <Input
                            value={editTitle}
                            onChange={event => setEditTitle(event.target.value)}
                            aria-label="Edit knowledge title"
                          />
                          <Textarea
                            className="mt-3 min-h-28"
                            value={editContent}
                            onChange={event =>
                              setEditContent(event.target.value)
                            }
                            aria-label="Edit knowledge content"
                          />
                          <div className="mt-3 flex gap-2">
                            <Button
                              size="sm"
                              disabled={
                                !editTitle.trim() ||
                                !editContent.trim() ||
                                !management.data?.elevated ||
                                update.isPending
                              }
                              onClick={() => void saveEdit()}
                            >
                              {update.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="mr-2 h-4 w-4" />
                              )}
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className="font-bold">{source.title}</h3>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#66758A]">
                                {source.content ||
                                  "No approved detail has been added yet."}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Edit ${source.title}`}
                              onClick={() => {
                                setEditingId(source.id);
                                setEditTitle(source.title);
                                setEditContent(source.content ?? "");
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                          {source.sourceUrl ? (
                            <a
                              className="mt-3 inline-flex items-center text-xs font-semibold text-[#3F70D8] hover:underline"
                              href={source.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View source{" "}
                              <ExternalLink className="ml-1 h-3 w-3" />
                            </a>
                          ) : (
                            <p className="mt-3 text-xs text-[#8290A3]">
                              Added by management
                            </p>
                          )}
                        </>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-[#C9D4E2] bg-white p-10 text-center">
            <BookOpenCheck className="mx-auto h-7 w-7 text-[#8290A3]" />
            <h2 className="mt-4 font-bold">No trusted knowledge yet</h2>
            <p className="mt-2 text-sm text-[#66758A]">
              Learn from the company website during setup or add the first
              approved fact here.
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
