export interface ISnapshotMetadataLike {
  snapshots: Record<string, unknown>;
}

export interface ISnapshotClearAdapter<TSnapshotData, TMetadata extends ISnapshotMetadataLike> {
  loadSnapshotData(): Promise<TSnapshotData>;
  loadMetadata(): Promise<TMetadata>;
  saveSnapshotData(data: TSnapshotData): Promise<void>;
  saveMetadata(metadata: TMetadata): Promise<void>;
  emptySnapshotData(): TSnapshotData;
}

export async function clearSearchSnapshotsWithRollback<TSnapshotData, TMetadata extends ISnapshotMetadataLike>(
  adapter: ISnapshotClearAdapter<TSnapshotData, TMetadata>,
): Promise<number> {
  const [snapshotData, metadata] = await Promise.all([adapter.loadSnapshotData(), adapter.loadMetadata()]);
  const count = Object.keys(metadata.snapshots).length;

  try {
    await adapter.saveSnapshotData(adapter.emptySnapshotData());
    await adapter.saveMetadata({ ...metadata, snapshots: {} });
  } catch (error) {
    await Promise.allSettled([adapter.saveSnapshotData(snapshotData), adapter.saveMetadata(metadata)]);
    throw error;
  }

  return count;
}
