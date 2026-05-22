import * as readline from 'node:readline';

let rl: readline.Interface | null = null;

function getReadline(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rl;
}

export function prompt(message: string, defaultValue?: string): Promise<string> {
  const displayDefault = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    getReadline().question(`${message}${displayDefault}: `, (answer) => {
      resolve(answer || defaultValue || '');
    });
  });
}

export function promptPassword(message: string): Promise<string> {
  return new Promise((resolve) => {
    getReadline().question(`${message} (input visible): `, (answer) => {
      resolve(answer);
    });
  });
}

export function promptConfirm(message: string, defaultValue = false): Promise<boolean> {
  const hint = defaultValue ? '(Y/n)' : '(y/N)';
  return new Promise((resolve) => {
    getReadline().question(`${message} ${hint}: `, (answer) => {
      const normalized = answer.toLowerCase().trim();
      if (normalized === '') {
        resolve(defaultValue);
      } else {
        resolve(normalized === 'y' || normalized === 'yes');
      }
    });
  });
}

export function promptSelect<T extends string>(
  message: string,
  choices: Array<{ value: T; name: string }>,
): Promise<T> {
  return new Promise((resolve) => {
    console.log(`${message}`);
    choices.forEach((choice, i) => {
      console.log(`  ${i + 1}) ${choice.name}`);
    });

    getReadline().question('Enter number: ', (answer) => {
      const index = Number.parseInt(answer, 10) - 1;
      if (index >= 0 && index < choices.length) {
        resolve(choices[index].value);
      } else {
        resolve(choices[0].value);
      }
    });
  });
}

export function closePrompts(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}
