import { File, Directory, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';
import { StorageAccessFramework, writeAsStringAsync, deleteAsync } from 'expo-file-system/legacy';
import { requireCurrent, serializeChildExport } from '../../../packages/session-runtime/profile-actions.ts';
import type { ExportDelivery } from '../../../packages/session-runtime/profile-actions.ts';

const active = new Set<string>();
const directory = () => new Directory(Paths.cache, 'focus-private-exports-v1');
export function cleanupExportFiles() {
  const root = directory(); if (!root.exists) return;
  for (const entry of root.list()) if (!active.has(entry.uri)) entry.delete();
}
export async function shareChildExport(data: unknown, childId: string, current: () => boolean, title: string): Promise<ExportDelivery> {
  requireCurrent(current);
  const text = serializeChildExport(data, childId);
  if (Platform.OS === 'android') {
    // Write to the user-selected document instead of deleting a FileProvider
    // URI while another app might still be reading it after a chooser closes.
    const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return 'cancelled';
    const uri = await StorageAccessFramework.createFileAsync(permission.directoryUri, `focus-records-${randomUUID()}.json`, 'application/json');
    try { await writeAsStringAsync(uri, text); }
    catch (error) {
      try { await deleteAsync(uri, { idempotent: true }); } catch { throw new Error('EXPORT_PARTIAL_FILE'); }
      throw error;
    }
    return 'saved';
  }
  if (!await Sharing.isAvailableAsync()) throw new Error('SHARING_UNAVAILABLE');
  requireCurrent(current);
  cleanupExportFiles();
  const root = directory(); root.create({ idempotent: true, intermediates: true });
  const file = new File(root, `focus-records-${randomUUID()}.json`); active.add(file.uri);
  try {
    file.write(text);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: title });
    return 'share-sheet-closed';
  } finally {
    active.delete(file.uri);
    if (file.exists) file.delete();
  }
}
