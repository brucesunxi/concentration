// Expo SQLite exposes a native absolute filesystem path. Expo FileSystem's File
// constructor needs a file URI for the existence check on Android and iOS.
export function nativeDatabaseDirectoryUri(directory: string): string {
  if (directory.startsWith('file:///')) return directory;
  if (directory.startsWith('/')) return `file://${directory}`;
  throw new Error('Native database directory is unavailable');
}
