/** Explicit one-frame capture. Every track is stopped before a frame is returned. */
export async function captureVisual(
  kind: 'camera' | 'screen',
  devices: Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia'>,
  document: Document
): Promise<string> {
  let stream: MediaStream | null = null
  try {
    stream =
      kind === 'camera'
        ? await devices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
          })
        : await devices.getDisplayMedia({ video: true, audio: false })
    const video = document.createElement('video')
    video.muted = true
    video.srcObject = stream
    await video.play()
    const width = video.videoWidth,
      height = video.videoHeight
    if (!width || !height) throw new Error('No visual frame is available.')
    const scale = Math.min(1, 1280 / Math.max(width, height)),
      canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Visual capture is unsupported.')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const frame = canvas.toDataURL('image/jpeg', 0.8)
    video.pause()
    video.srcObject = null
    if (!frame.startsWith('data:image/jpeg;base64,') || frame.length > 1500000)
      throw new Error('Visual frame exceeds the supported size.')
    return frame
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop()
  }
}
