export interface Speech {
  synthesize(text: string): Promise<Uint8Array>
}
