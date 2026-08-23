export type PlaybookRevision = {
  id: number;
  playbookKey: string;
  version: number;
  status: "draft" | "published" | "archived";
};

export function resolvePublishedPlaybook(revisions: PlaybookRevision[], playbookKey: string) {
  const published = revisions.filter(revision => revision.playbookKey === playbookKey && revision.status === "published");
  if (published.length !== 1) {
    throw new Error(published.length ? "PLAYBOOK_PUBLICATION_AMBIGUOUS" : "PLAYBOOK_NOT_PUBLISHED");
  }
  return published[0];
}

export function nextPlaybookVersion(revisions: Pick<PlaybookRevision, "version">[]) {
  return Math.max(0, ...revisions.map(revision => revision.version)) + 1;
}
