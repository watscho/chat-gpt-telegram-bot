export interface Speech {
  synthesize(text: string, signal?: AbortSignal): Promise<Uint8Array>
}
