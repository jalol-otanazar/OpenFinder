import { confirm, input, select } from '@inquirer/prompts';

/**
 * The interactive-prompt seam for the `intake` skill. Routing the conversational
 * follow-ups through an interface (rather than calling `@inquirer/prompts`
 * directly) keeps `runIntake` fully unit-testable with a scripted stub.
 */

export interface IntakeChoice {
  name: string;
  value: string;
}

export interface IntakePrompter {
  /** Free-text answer. */
  askText(question: string, opts?: { default?: string }): Promise<string>;
  /** Yes/no answer. */
  askConfirm(question: string, opts?: { default?: boolean }): Promise<boolean>;
  /** A pick from a fixed set — returns the chosen `value`. */
  askChoice(question: string, choices: IntakeChoice[]): Promise<string>;
}

/** The default prompter — `@inquirer/prompts`, as used by `finder setup`. */
export class InquirerPrompter implements IntakePrompter {
  async askText(question: string, opts?: { default?: string }): Promise<string> {
    const config: { message: string; default?: string } = { message: question };
    if (opts?.default !== undefined) config.default = opts.default;
    return (await input(config)).trim();
  }

  async askConfirm(question: string, opts?: { default?: boolean }): Promise<boolean> {
    return confirm({ message: question, default: opts?.default ?? true });
  }

  async askChoice(question: string, choices: IntakeChoice[]): Promise<string> {
    return select({
      message: question,
      choices: choices.map((c) => ({ name: c.name, value: c.value })),
    });
  }
}
