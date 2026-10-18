export interface TestProps<S> {
  stimuli: S;
  busy: boolean;
  onSubmit: (raw: Record<string, unknown>, durationSec: number) => void;
}
