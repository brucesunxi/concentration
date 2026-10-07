/** Keep the entry download budget separate from the files needed by later pages. */
export function webGraphFiles(graph, entryKey) {
  const initial = new Set(['index.html']), seenInitial = new Set();
  function entry(key) {
    const value = graph[key];
    if (!value) throw new Error(`Missing static dependency: ${key}`);
    return value;
  }
  function visitInitial(key) {
    if (seenInitial.has(key)) return;
    seenInitial.add(key);
    const value = entry(key);
    for (const path of [value.file, ...value.css ?? [], ...value.assets ?? []]) initial.add(path);
    for (const dependency of value.imports ?? []) visitInitial(dependency);
  }
  visitInitial(entryKey);
  const offline = new Set(initial), seenCode = new Set();
  function visitCode(key) {
    if (seenCode.has(key)) return;
    seenCode.add(key);
    const value = entry(key);
    if (/\.(?:js|css)$/.test(value.file)) offline.add(value.file);
    for (const path of value.css ?? []) offline.add(path);
    for (const dependency of [...value.imports ?? [], ...value.dynamicImports ?? []]) visitCode(dependency);
  }
  visitCode(entryKey);
  return { initial, offline };
}
