export interface StorySyncSpec {
  storyId: string
  syncUrl?: string
  syncSecret?: string
}

export interface ProjectRunSpec<THooks = unknown> {
  projectDir?: string
  repoSourceDir?: string
  repoCloneUrl?: string
  sandboxRepoRoot?: string
  workspaceRoot?: string
  gitRoot?: string
  sourceLabel?: string
  bootstrapScript?: string
  githubToken?: string
  storySync?: StorySyncSpec
  hooks?: THooks
}
