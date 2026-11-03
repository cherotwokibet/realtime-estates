/** One generation per visible account request. No payload or credential persistence. */
export class CustomerViewGate {
  private version = 0;
  private controller: AbortController | null = null;
  begin() {
    this.invalidate();
    this.controller = new AbortController();
    return { version: this.version, signal: this.controller.signal };
  }
  current(version: number) {
    return this.version === version && this.controller?.signal.aborted === false;
  }
  invalidate() {
    this.version++;
    this.controller?.abort();
    this.controller = null;
  }
}
