const aliasMap = new Map<string, string>();

export function setAlias(name: string, value: string) {
  aliasMap.set(name, value);
}

export function removeAlias(name: string): boolean {
  return aliasMap.delete(name);
}

export function getAlias(name: string): string | undefined {
  return aliasMap.get(name);
}

export function getAllAliases(): Map<string, string> {
  return aliasMap;
}

export function expandAliases(input: string): string {
  const seen = new Set<string>();

  let result = input;

  while (true) {
    const firstWord = result.trimStart().split(/\s+/)[0];
    if (!firstWord || seen.has(firstWord)) break;

    const expanded = aliasMap.get(firstWord);
    if (!expanded) break;

    seen.add(firstWord);
    result = result.trimStart().replace(firstWord, expanded);
  }

  return result;
}