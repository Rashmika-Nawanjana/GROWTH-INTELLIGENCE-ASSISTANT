export type WorkspaceChunkSection =
  | 'facts'
  | 'interpretation'
  | 'domain'
  | 'notes'
  | 'sources'
  | 'evidence';

export interface WorkspaceChunkDraft {
  section: WorkspaceChunkSection;
  chunkIndex: number;
  content: string;
}

export interface RetrievedWorkspaceChunk {
  id: string;
  workspaceItemId: string;
  section: WorkspaceChunkSection;
  content: string;
  similarity: number;
  itemTitle: string;
  artifactType: string;
}

export interface WorkspaceRetrieveResult {
  itemHits: RetrievedWorkspaceChunk[];
  boardHits: RetrievedWorkspaceChunk[];
  itemContextBlock: string;
  boardContextBlock: string;
}
