// Loaded only for a pre-v2 practice; these original illustrations must not be
// replaced by current home art or downloaded as part of the new first screen.
import characters from '../../../src/assets/characters-sheet.png';
import objects from '../../../src/assets/objects-sheet.png';

export async function prepareLegacyArtwork(signal: AbortSignal) {
  const assets = { characters, objects };
  for (const src of Object.values(assets)) {
    signal.throwIfAborted();
    const image = new Image(); image.src = src; await image.decode();
  }
  signal.throwIfAborted(); return assets;
}
