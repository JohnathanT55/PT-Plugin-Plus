export type DownloadPolicySource = "site-profile" | "global-default" | "downloader-default" | "selection-required";

export type DownloadPolicyReason =
  | "site-explicit-default"
  | "site-single-binding"
  | "manual-selection"
  | "global-default"
  | "multiple-site-bindings"
  | "multiple-directories"
  | "bound-downloader-unavailable"
  | "global-downloader-unavailable"
  | "no-download-target";

export interface DownloadPolicyTarget {
  directories?: readonly string[];
  tags?: readonly string[];
  defaultDirectory?: string;
  defaultTag?: string;
  autoStart?: boolean;
}

export interface DownloadPolicyDownloader {
  available: boolean;
  defaultTarget?: DownloadPolicyTarget;
  autoStart?: boolean;
}

export interface DownloadPolicySiteProfile {
  defaultDownloaderId?: string;
  byDownloader?: Readonly<Record<string, DownloadPolicyTarget>>;
}

export interface DownloadPolicyInput {
  siteId?: string;
  requestedDownloaderId?: string;
  profile?: DownloadPolicySiteProfile;
  downloaders: Readonly<Record<string, DownloadPolicyDownloader | undefined>>;
  globalDefault?: {
    downloaderId?: string;
    target?: DownloadPolicyTarget;
  };
}

export interface DownloadPolicyResolution {
  siteId?: string;
  downloaderId?: string;
  directory: string;
  tag: string;
  directoryCandidates: string[];
  tagCandidates: string[];
  autoStart: boolean;
  source: DownloadPolicySource;
  reason: DownloadPolicyReason;
  requiresSelection: boolean;
}

interface SiteBindingCandidate {
  downloaderId: string;
  downloader?: DownloadPolicyDownloader;
  target: DownloadPolicyTarget;
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

export interface NormalizedDownloadPolicyTarget {
  directories: string[];
  tags: string[];
  defaultDirectory?: string;
  defaultTag?: string;
  autoStart?: boolean;
}

export function normalizeDownloadPolicyTarget(target?: DownloadPolicyTarget): NormalizedDownloadPolicyTarget {
  return {
    directories: unique([target?.defaultDirectory, ...(target?.directories ?? [])]),
    tags: unique([target?.defaultTag, ...(target?.tags ?? [])]),
    defaultDirectory: target?.defaultDirectory?.trim() || undefined,
    defaultTag: target?.defaultTag?.trim() || undefined,
    autoStart: target?.autoStart,
  };
}

/** A site binding exists only when a site-specific directory owns its downloader. */
export function hasSiteDirectoryBinding(target?: DownloadPolicyTarget): target is DownloadPolicyTarget {
  return normalizeDownloadPolicyTarget(target).directories.length > 0;
}

function hasTargetValue(target?: DownloadPolicyTarget): boolean {
  const normalized = normalizeDownloadPolicyTarget(target);
  return normalized.directories.length > 0 || normalized.tags.length > 0 || target?.autoStart !== undefined;
}

function selectionRequired(siteId: string | undefined, reason: DownloadPolicyReason): DownloadPolicyResolution {
  return {
    siteId,
    directory: "",
    tag: "",
    directoryCandidates: [],
    tagCandidates: [],
    autoStart: true,
    source: "selection-required",
    reason,
    requiresSelection: true,
  };
}

function resolved(
  input: DownloadPolicyInput,
  downloaderId: string,
  target: DownloadPolicyTarget,
  source: Exclude<DownloadPolicySource, "selection-required">,
  reason: DownloadPolicyReason,
): DownloadPolicyResolution {
  const downloader = input.downloaders[downloaderId];
  if (!downloader?.available) {
    return selectionRequired(
      input.siteId,
      source === "global-default" ? "global-downloader-unavailable" : "bound-downloader-unavailable",
    );
  }

  const normalized = normalizeDownloadPolicyTarget(target);
  const directory = normalized.defaultDirectory
    ? normalized.defaultDirectory
    : normalized.directories.length === 1
      ? normalized.directories[0]
      : "";
  const tag = normalized.defaultTag ? normalized.defaultTag : normalized.tags.length === 1 ? normalized.tags[0] : "";
  const hasDirectoryAmbiguity = normalized.directories.length > 1 && directory === "";

  return {
    siteId: input.siteId,
    downloaderId,
    directory,
    tag,
    directoryCandidates: normalized.directories,
    tagCandidates: normalized.tags,
    autoStart: normalized.autoStart ?? downloader.autoStart ?? true,
    source,
    reason: hasDirectoryAmbiguity ? "multiple-directories" : reason,
    // Tags are optional attributes. Multiple tag candidates do not block a
    // unique downloader/directory target unless an explicit default is set.
    requiresSelection: hasDirectoryAmbiguity,
  };
}

/**
 * Resolve the destination for a new automatic download.
 *
 * A site-specific directory and its downloader are an indivisible binding.
 * A configured binding can never silently fall through to a different global
 * downloader. The global downloader is considered only when the site owns no
 * directory binding at all.
 */
export function resolveDownloadPolicy(input: DownloadPolicyInput): DownloadPolicyResolution {
  const { siteId, profile } = input;

  // A downloader explicitly selected by the user is a one-off override. When
  // it owns a site directory, retain that directory; otherwise use its normal
  // default/root target. Menus that select an exact folder bypass this branch
  // and send the explicit tuple directly.
  if (input.requestedDownloaderId) {
    const downloaderId = input.requestedDownloaderId;
    const downloader = input.downloaders[downloaderId];
    if (!downloader?.available) return selectionRequired(siteId, "bound-downloader-unavailable");

    const siteTarget = profile?.byDownloader?.[downloaderId];
    return resolved(
      input,
      downloaderId,
      hasSiteDirectoryBinding(siteTarget) ? siteTarget : (downloader.defaultTarget ?? {}),
      hasSiteDirectoryBinding(siteTarget) ? "site-profile" : "downloader-default",
      "manual-selection",
    );
  }

  const configuredBindings: SiteBindingCandidate[] = Object.entries(profile?.byDownloader ?? {})
    .filter(([, target]) => hasSiteDirectoryBinding(target))
    .map(([downloaderId, target]) => ({
      downloaderId,
      downloader: input.downloaders[downloaderId],
      target,
    }));

  const explicitBinding = configuredBindings.find(({ downloaderId }) => downloaderId === profile?.defaultDownloaderId);
  if (explicitBinding) {
    if (!explicitBinding.downloader?.available) {
      return selectionRequired(siteId, "bound-downloader-unavailable");
    }
    return resolved(
      input,
      explicitBinding.downloaderId,
      explicitBinding.target,
      "site-profile",
      "site-explicit-default",
    );
  }

  if (configuredBindings.length === 1) {
    const [binding] = configuredBindings;
    if (!binding.downloader?.available) return selectionRequired(siteId, "bound-downloader-unavailable");
    return resolved(input, binding.downloaderId, binding.target, "site-profile", "site-single-binding");
  }

  // One usable binding must not silently win while another configured binding
  // is unavailable. The user needs to repair or explicitly choose a target.
  if (configuredBindings.length > 1) {
    return selectionRequired(siteId, "multiple-site-bindings");
  }

  // Merely selecting a downloader or tag on a site is not a binding. With no
  // site directory, use the global downloader and its configured folder; if
  // none exists, use its own default target or root directory.
  const downloaderId = input.globalDefault?.downloaderId;
  if (!downloaderId) return selectionRequired(siteId, "no-download-target");
  const downloader = input.downloaders[downloaderId];
  if (!downloader?.available) return selectionRequired(siteId, "global-downloader-unavailable");

  const target = hasTargetValue(input.globalDefault?.target)
    ? input.globalDefault!.target!
    : (downloader.defaultTarget ?? {});
  return resolved(input, downloaderId, target, "global-default", "global-default");
}
