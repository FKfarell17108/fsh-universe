export type Command = {
  cmd: string;
  args: string[];
};

export function parseInput(input: string): Command[] {
  const commands: Command[] = [];

  let current = "";
  let args: string[] = [];
  let inDouble = false;
  let inSingle = false;
  let escape = false;

  function pushArg() {
    if (current.length > 0) {
      args.push(current);
      current = "";
    }
  }

  function pushCommand() {
    pushArg();
    if (args.length > 0) {
      commands.push({
        cmd: args[0],
        args: args.slice(1),
      });
    }
    args = [];
  }

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (char === " ") {
        pushArg();
        continue;
      }

      if (char === "|") {
        pushCommand();
        continue;
      }
    }

    current += char;
  }

  pushCommand();

  return commands;
}