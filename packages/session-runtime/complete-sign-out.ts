/** A local storage failure must not skip server-side revocation of the captured token. */
export async function completeSignOut(operations: {
  eraseCredential: () => Promise<void>;
  invalidateOffline: () => Promise<void>;
  revokeRemote: () => Promise<void>;
}): Promise<void> {
  // Run the independent cleanups together: a blocked or failed database must
  // not delay the attempt to revoke the server token or erase secure storage.
  const results = await Promise.allSettled([
    Promise.resolve().then(operations.eraseCredential),
    Promise.resolve().then(operations.invalidateOffline),
    Promise.resolve().then(operations.revokeRemote),
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
