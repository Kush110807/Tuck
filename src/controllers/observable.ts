export type ControllerListener = () => void;

/** Small C-owned observable primitive. Master may subscribe and pass fresh props to A. */
export abstract class ObservableController {
  private readonly listeners = new Set<ControllerListener>();

  subscribe(listener: ControllerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected emitChange(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
