export interface ProgressBarOptions {
  /** Optional label to display before the progress bar */
  label?: string;
  /** Width of the progress bar in characters (default: 20) */
  width?: number;
}

export class ProgressBar {
  private total: number;
  private current = 0;
  private width: number;
  private label: string;

  constructor(total: number, options?: ProgressBarOptions) {
    this.total = total;
    this.width = options?.width ?? 20;
    this.label = options?.label ?? '';
  }

  setLabel(label: string): void {
    this.label = label;
  }

  update(current: number): void {
    this.current = current;
    this.render();
  }

  increment(): void {
    this.current++;
    this.render();
  }

  private render(): void {
    const percent = this.total > 0 ? this.current / this.total : 0;
    const filled = Math.round(this.width * percent);
    const empty = this.width - filled;
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
    const labelPart = this.label ? `${this.label} ` : '';
    // Clear line and write progress
    process.stdout.write(`\r\x1b[K${labelPart}[${bar}] ${this.current}/${this.total}`);
  }

  done(): void {
    console.log();
  }
}
